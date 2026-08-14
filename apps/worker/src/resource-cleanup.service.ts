/**
 * Resource Cleanup Service.
 *
 * Periodically cleans up:
 * 1. Expired assets — older than the workspace's plan storageRetentionDays.
 * 2. Orphaned assets — linked to FAILED or CANCELED generation jobs.
 *
 * Design:
 * - Uses a Redis distributed lock (SET NX EX) with a **random token** (not PID)
 *   so multiple worker instances don't run cleanup simultaneously.
 * - Lock is released in a `finally` block to ensure cleanup even on error.
 * - Lock TTL is renewed periodically to handle long-running cleanup cycles.
 * - Retention days come from the active subscription's plan. If the
 *   subscription query fails, the cleanup cycle **skips** that workspace
 *   (does NOT fall back to a default) to avoid accidentally deleting assets.
 * - Delete order: storage object first, then DB record. If storage
 *   delete fails (non-NotFound), the DB record is kept for retry.
 * - Storage instance is obtained via a getter function so that dynamically
 *   updated S3 configuration is used.
 *
 * Follows the worker's plain-class DI pattern (no NestJS decorators).
 */

import { randomUUID } from 'node:crypto';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import {
  assets,
  generationJobs,
  plans,
  subscriptions,
  type Database,
} from '@enova/db';
import type { ObjectStorage } from '@enova/provider';
import { WorkerLogger } from './logger.js';

export interface CleanupResult {
  expiredAssetsDeleted: number;
  orphanedAssetsDeleted: number;
  errors: number;
  durationMs: number;
  lockAcquired: boolean;
}

/** Storage getter — allows dynamic storage updates without restarting worker. */
export type StorageGetter = () => ObjectStorage;

export interface ResourceCleanupDeps {
  db: Database;
  /** Use a getter so cleanup always uses the latest storage instance. */
  storage: ObjectStorage | StorageGetter;
  redis: IORedis;
  logger: WorkerLogger;
  /** Lock key in Redis. */
  lockKey?: string;
  /** Lock TTL in seconds. */
  lockTtlSec?: number;
  /** Interval between cleanup cycles in milliseconds. */
  intervalMs?: number;
}

/** Conservative default retention for workspaces without a subscription. */
const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 100;
const DEFAULT_LOCK_KEY = 'enova:cleanup:lock';
const DEFAULT_LOCK_TTL_SEC = 600; // 10 minutes
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const LOCK_RENEWAL_INTERVAL_MS = 60 * 1000; // Renew lock every 60s

export class ResourceCleanupService {
  private readonly deps: ResourceCleanupDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lockRenewTimer: ReturnType<typeof setInterval> | null = null;
  private currentLockToken: string | null = null;

  constructor(deps: ResourceCleanupDeps) {
    this.deps = deps;
  }

  /** Get the current storage instance (supports dynamic updates). */
  private getStorage(): ObjectStorage {
    const { storage } = this.deps;
    if (typeof storage === 'function') {
      return (storage as StorageGetter)();
    }
    return storage;
  }

  /** Start periodic cleanup. Called once during worker startup. */
  start(): void {
    const intervalMs = this.deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.deps.logger.info('resource cleanup scheduled', { intervalMs });

    // Run first cycle immediately on startup, then periodically.
    this.runCleanup().catch((err) => {
      this.deps.logger.error('resource cleanup initial cycle failed', {}, err);
    });

    this.timer = setInterval(() => {
      this.runCleanup().catch((err) => {
        this.deps.logger.error('resource cleanup cycle failed', {}, err);
      });
    }, intervalMs);
  }

  /** Stop periodic cleanup. Called during shutdown. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.lockRenewTimer) {
      clearInterval(this.lockRenewTimer);
      this.lockRenewTimer = null;
    }
  }

  /**
   * Try to acquire a Redis distributed lock using a random token.
   * Returns the token if lock acquired, null if another instance holds it.
   */
  private async acquireLock(): Promise<string | null> {
    const key = this.deps.lockKey ?? DEFAULT_LOCK_KEY;
    const ttl = this.deps.lockTtlSec ?? DEFAULT_LOCK_TTL_SEC;
    const token = randomUUID();
    const result = await this.deps.redis.set(key, token, 'EX', ttl, 'NX');
    if (result === 'OK') {
      this.currentLockToken = token;
      this.startLockRenewal();
      return token;
    }
    return null;
  }

  /** Periodically renew the lock to prevent expiry during long cleanup. */
  private startLockRenewal(): void {
    const key = this.deps.lockKey ?? DEFAULT_LOCK_KEY;
    const ttl = this.deps.lockTtlSec ?? DEFAULT_LOCK_TTL_SEC;
    const token = this.currentLockToken;
    if (!token) return;

    this.lockRenewTimer = setInterval(async () => {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        await this.deps.redis.eval(script, 1, key, token, String(ttl));
      } catch (err) {
        this.deps.logger.error('lock renewal failed', {}, err);
      }
    }, LOCK_RENEWAL_INTERVAL_MS);
  }

  /** Release the lock (only if we hold it, verified by token). */
  private async releaseLock(): Promise<void> {
    const key = this.deps.lockKey ?? DEFAULT_LOCK_KEY;
    const token = this.currentLockToken;
    if (!token) return;

    if (this.lockRenewTimer) {
      clearInterval(this.lockRenewTimer);
      this.lockRenewTimer = null;
    }

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.deps.redis.eval(script, 1, key, token);
    this.currentLockToken = null;
  }

  /**
   * Run full cleanup cycle. Acquires distributed lock, runs cleanup, releases lock.
   * Lock is always released in finally block.
   */
  async runCleanup(): Promise<CleanupResult> {
    const start = Date.now();

    let token: string | null;
    try {
      token = await this.acquireLock();
    } catch (err) {
      this.deps.logger.error('cleanup lock acquire failed', {}, err);
      return {
        expiredAssetsDeleted: 0,
        orphanedAssetsDeleted: 0,
        errors: 0,
        durationMs: Date.now() - start,
        lockAcquired: false,
      };
    }

    if (!token) {
      this.deps.logger.info('cleanup skipped: another instance holds the lock');
      return {
        expiredAssetsDeleted: 0,
        orphanedAssetsDeleted: 0,
        errors: 0,
        durationMs: Date.now() - start,
        lockAcquired: false,
      };
    }

    this.deps.logger.info('starting resource cleanup cycle...');

    let errors = 0;
    let expiredAssetsDeleted = 0;
    let orphanedAssetsDeleted = 0;

    try {
      expiredAssetsDeleted = await this.cleanupExpiredAssets();
      orphanedAssetsDeleted = await this.cleanupOrphanedAssets();
      errors += this.cleanupErrors;
    } catch (err) {
      errors++;
      this.deps.logger.error('cleanup cycle error', {}, err);
    } finally {
      // Always release lock, even on error.
      await this.releaseLock().catch((err) => {
        this.deps.logger.error('lock release failed', {}, err);
      });
    }

    const durationMs = Date.now() - start;
    this.deps.logger.info('resource cleanup complete', {
      expiredAssetsDeleted,
      orphanedAssetsDeleted,
      errors,
      durationMs,
    });

    return {
      expiredAssetsDeleted,
      orphanedAssetsDeleted,
      errors,
      durationMs,
      lockAcquired: true,
    };
  }

  private cleanupErrors = 0;

  async cleanupExpiredAssets(): Promise<number> {
    this.cleanupErrors = 0;
    const storage = this.getStorage();

    // Step 1: Get distinct workspace IDs that have assets with object keys.
    const workspaceRows = await this.deps.db
      .select({ workspaceId: assets.workspaceId })
      .from(assets)
      .where(sql`${assets.objectKey} IS NOT NULL`)
      .groupBy(assets.workspaceId)
      .limit(BATCH_SIZE);

    let deleted = 0;

    for (const { workspaceId } of workspaceRows) {
      // Step 2: Get retention days — if query fails, skip this workspace.
      const retentionDays = await this.getRetentionDays(workspaceId);
      if (retentionDays === null) {
        this.deps.logger.warn('retention query failed, skipping workspace', { workspaceId });
        continue;
      }

      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      // Step 3: Find expired assets for this workspace.
      const rows = await this.deps.db
        .select({ id: assets.id, objectKey: assets.objectKey })
        .from(assets)
        .where(
          and(
            eq(assets.workspaceId, workspaceId),
            lt(assets.createdAt, cutoff),
            sql`${assets.objectKey} IS NOT NULL`,
          ),
        )
        .limit(BATCH_SIZE);

      for (const row of rows) {
        if (!row.objectKey) continue;
        const success = await this.safeDeleteAsset(storage, row.id, row.objectKey);
        if (success) {
          deleted++;
        } else {
          this.cleanupErrors++;
        }
      }
    }

    return deleted;
  }

  async cleanupOrphanedAssets(): Promise<number> {
    const storage = this.getStorage();
    const rows = await this.deps.db
      .select({
        assetId: assets.id,
        objectKey: assets.objectKey,
        jobStatus: generationJobs.status,
      })
      .from(assets)
      .innerJoin(generationJobs, eq(assets.generationJobId, generationJobs.id))
      .where(
        and(
          or(
            eq(generationJobs.status, 'FAILED'),
            eq(generationJobs.status, 'CANCELED'),
          ),
          sql`${assets.objectKey} IS NOT NULL`,
        ),
      )
      .limit(BATCH_SIZE);

    let deleted = 0;

    for (const row of rows) {
      if (!row.objectKey) continue;
      const success = await this.safeDeleteAsset(storage, row.assetId, row.objectKey);
      if (success) {
        deleted++;
      } else {
        this.cleanupErrors++;
      }
    }

    return deleted;
  }

  /**
   * Get the retention days for a workspace.
   * Returns null if the query fails — caller should skip, not use default.
   * Returns DEFAULT_RETENTION_DAYS if no subscription exists (conservative).
   */
  private async getRetentionDays(workspaceId: string): Promise<number | null> {
    try {
      const rows = await this.deps.db
        .select({ retentionDays: plans.storageRetentionDays })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(
          and(
            eq(subscriptions.workspaceId, workspaceId),
            eq(subscriptions.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (rows.length > 0 && rows[0].retentionDays > 0) {
        return rows[0].retentionDays;
      }
      // No active subscription → use conservative default.
      return DEFAULT_RETENTION_DAYS;
    } catch {
      // Query failed → return null to signal "skip this workspace".
      return null;
    }
  }

  /**
   * Safely delete an asset: storage object first, then DB record.
   * Returns true on success, false on failure.
   */
  private async safeDeleteAsset(storage: ObjectStorage, assetId: string, objectKey: string): Promise<boolean> {
    try {
      await storage.deleteObject(objectKey);
    } catch (err) {
      this.deps.logger.error('storage delete failed, keeping DB record for retry', {
        assetId,
        objectKey: this.maskKey(objectKey),
      }, err);
      return false;
    }

    try {
      await this.deps.db.delete(assets).where(eq(assets.id, assetId));
      return true;
    } catch (err) {
      this.deps.logger.error('DB delete failed after storage delete', {
        assetId,
        objectKey: this.maskKey(objectKey),
      }, err);
      return false;
    }
  }

  private maskKey(key: string): string {
    if (key.length <= 20) return '***';
    return `${key.slice(0, 10)}...${key.slice(-4)}`;
  }

  getErrorCount(): number {
    return this.cleanupErrors;
  }
}
