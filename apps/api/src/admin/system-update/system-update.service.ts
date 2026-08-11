import { Inject, Injectable } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { ENV, type Env } from '../../config/config.module.js';
import { GitHubReleaseClient } from './github-client.service.js';
import { RedisStore } from './redis-store.service.js';
import { DeployExecutor } from './deploy-executor.service.js';
import { compareVersions, normalizeVersion } from './semver.js';
import type { OperationView, RollbackVersionView, UpdateInfoView } from './types.js';

interface CacheBody {
  latest: string;
  release_info?: UpdateInfoView['release_info'];
  timestamp: number;
}

const GLOBAL_LOCK_KEY = 'sysop';

/**
 * 系统更新/回滚（Admin，参考 sub2api 工程化治理层）。
 * - 检查：GitHub Releases + Redis 缓存（容错回退缓存）
 * - 执行：全局操作锁(Redis) + 后台脚本（deploy-tool 容器，与请求解耦）
 * - 回滚：回退到上一个版本，或显式切换到列表中的某个历史版本
 */
@Injectable()
export class SystemUpdateService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GitHubReleaseClient) private readonly github: GitHubReleaseClient,
    @Inject(RedisStore) private readonly store: RedisStore,
    @Inject(DeployExecutor) private readonly executor: DeployExecutor,
  ) {}

  /** 检查是否有更新（force 跳过缓存）。容错：任何异常回退缓存或返回降级信息。 */
  async checkStatus(force = false): Promise<UpdateInfoView> {
    const current = this.env.APP_VERSION;
    if (!this.env.UPDATE_ENABLED) {
      return { enabled: false, current_version: current, latest_version: current, has_update: false, cached: false };
    }

    if (!force) {
      const cached = await this.readCache();
      if (cached) return this.fromCache(cached);
    }

    const release = await this.github.fetchLatestRelease();
    if (!release) {
      const cached = await this.readCache();
      if (cached) return { ...this.fromCache(cached), warning: 'Using cached data: github fetch failed' };
      return {
        enabled: true,
        current_version: current,
        latest_version: current,
        has_update: false,
        warning: 'Unable to fetch latest release',
        cached: false,
      };
    }

    const info: UpdateInfoView = {
      enabled: true,
      current_version: current,
      latest_version: release.tag_name,
      has_update: compareVersions(normalizeVersion(current), normalizeVersion(release.tag_name)) < 0,
      release_info: {
        name: release.name,
        body: release.body,
        published_at: release.published_at,
        html_url: release.html_url,
      },
      cached: false,
    };
    await this.saveCache(info).catch(() => undefined);
    return info;
  }

  /** 列出可回滚/可切换的历史稳定版本（严格早于当前版本，最新在前）。 */
  async listRollbackVersions(): Promise<RollbackVersionView[]> {
    this.requireEnabled();
    const releases = await this.github.fetchRecentReleases(this.env.UPDATE_MAX_ROLLBACK_VERSIONS * 5 + 5);
    const current = normalizeVersion(this.env.APP_VERSION);
    const older = releases
      .filter((r) => compareVersions(r.tag_name, current) < 0)
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
    return older.slice(0, this.env.UPDATE_MAX_ROLLBACK_VERSIONS).map((r) => ({
      version: r.tag_name,
      published_at: r.published_at,
      html_url: r.html_url,
    }));
  }

  /** 启动一次后台更新（到最新或指定版本）。 */
  async startUpdate(operationId: string, version?: string): Promise<OperationView> {
    this.requireEnabled();
    const target = version ? normalizeVersion(version) : undefined;
    if (target && !/^\d+\.\d+\.\d+(\.\d+)?$/.test(target)) {
      throw domainError(ERROR_CODES.UPDATE_INVALID_VERSION, `Invalid version: ${version}`, 400);
    }
    await this.acquireLock(operationId);
    const op: OperationView = {
      operation_id: operationId,
      status: 'running',
      action: 'update',
      target,
      started_at: new Date().toISOString(),
    };
    await this.store.createOperation(op);
    this.executor.run(op, target ? ['update.sh', target] : ['update.sh'], () => this.releaseLock(operationId));
    return op;
  }

  /** 启动一次后台回滚：省略 version 回退到上一个；指定 version 则显式降级。 */
  async startRollback(operationId: string, version?: string): Promise<OperationView> {
    this.requireEnabled();
    const target = version ? normalizeVersion(version) : undefined;
    if (target && !/^\d+\.\d+\.\d+(\.\d+)?$/.test(target)) {
      throw domainError(ERROR_CODES.UPDATE_INVALID_VERSION, `Invalid version: ${version}`, 400);
    }
    await this.acquireLock(operationId);
    const op: OperationView = {
      operation_id: operationId,
      status: 'running',
      action: 'rollback',
      target,
      started_at: new Date().toISOString(),
    };
    await this.store.createOperation(op);
    // 指定版本降级走 update.sh（明文允许 downgrade）；否则回退到上一个版本。
    this.executor.run(op, target ? ['update.sh', target] : ['rollback.sh', '--code-only'], () =>
      this.releaseLock(operationId),
    );
    return op;
  }

  async getOperation(operationId: string): Promise<OperationView> {
    const op = await this.store.getOperation(operationId);
    if (!op) throw domainError(ERROR_CODES.UPDATE_OPERATION_NOT_FOUND, 'Operation not found', 404);
    return op;
  }

  private requireEnabled(): void {
    if (!this.env.UPDATE_ENABLED) {
      throw domainError(ERROR_CODES.UPDATE_NOT_ENABLED, 'System update is not enabled', 403);
    }
  }

  private async acquireLock(operationId: string): Promise<void> {
    const ok = await this.store.acquireLock(GLOBAL_LOCK_KEY, operationId, this.env.UPDATE_EXEC_TIMEOUT_MS);
    if (!ok) {
      throw domainError(ERROR_CODES.UPDATE_IN_PROGRESS, 'Another update/rollback is in progress', 409);
    }
  }

  private releaseLock(operationId: string): Promise<void> {
    return this.store.releaseLock(GLOBAL_LOCK_KEY, operationId);
  }

  private async readCache(): Promise<CacheBody | null> {
    const raw = await this.store.getCache();
    if (!raw) return null;
    try {
      const body = JSON.parse(raw) as CacheBody;
      if (Date.now() - body.timestamp > this.env.UPDATE_CHECK_CACHE_TTL_MS) return null;
      return body;
    } catch {
      return null;
    }
  }

  private async saveCache(info: UpdateInfoView): Promise<void> {
    const body: CacheBody = {
      latest: info.latest_version,
      release_info: info.release_info,
      timestamp: Date.now(),
    };
    await this.store.setCache(JSON.stringify(body), this.env.UPDATE_CHECK_CACHE_TTL_MS);
  }

  private fromCache(cached: CacheBody): UpdateInfoView {
    const current = this.env.APP_VERSION;
    return {
      enabled: true,
      current_version: current,
      latest_version: cached.latest,
      has_update: compareVersions(normalizeVersion(current), normalizeVersion(cached.latest)) < 0,
      release_info: cached.release_info,
      cached: true,
    };
  }
}
