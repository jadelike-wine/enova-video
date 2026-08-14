/**
 * P0-7: Ops Monitoring Service.
 *
 * Provides operational metrics for the admin ops dashboard via API endpoints.
 * This is a query-only API — it does not implement automatic alerting.
 * External monitoring systems (Prometheus, Grafana, etc.) can poll
 * /admin/ops/metrics to collect and alert on these metrics.
 *
 * Currently available metrics:
 * - Database health (up/down + latency)
 * - Redis health (up/down + latency)
 * - Generation jobs: pending, running, succeeded/failed/canceled in last 24h
 * - Task failure rate (failed / (succeeded + failed) in last 24h)
 * - Payment orders: pending, succeeded/failed in 24h, refunded, succeeded-but-unfulfilled
 * - BullMQ queue: waiting, active, delayed, failed counts
 * - Stale pending payments: SUCCEEDED + PENDING fulfillment > 1 hour
 *
 * NOT yet implemented (would require additional infrastructure):
 * - Provider error/timeout counts (needs provider call logging table)
 * - Email send failure counts (needs email log table)
 * - Credits frozen-unreleased anomalies (needs wallet anomaly detection)
 * - Object storage upload/download failures (needs storage log table)
 *
 * Alert thresholds are evaluated and returned in the `alerts` array.
 * Callers can use these for display; automatic alerting requires
 * external integration (e.g. Prometheus alertmanager).
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import IORedis from 'ioredis';

import {
  generationJobs,
  orders,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface OpsMetrics {
  timestamp: string;
  database: { status: 'up' | 'down'; latencyMs: number };
  redis: { status: 'up' | 'down'; latencyMs: number };
  generations: {
    pending: number;
    running: number;
    succeeded24h: number;
    failed24h: number;
    canceled24h: number;
    /** Failure rate: failed / (succeeded + failed) in last 24h, 0–1. */
    failureRate24h: number;
  };
  payments: {
    pending: number;
    succeeded24h: number;
    failed24h: number;
    refunded: number;
    succeededButUnfulfilled: number;
    /** SUCCEEDED orders with PENDING fulfillment older than 1 hour. */
    stalePendingFulfillment: number;
  };
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  };
  alerts: OpsAlert[];
}

export interface OpsAlert {
  level: 'warning' | 'critical';
  category: string;
  message: string;
  metric: string;
  threshold: string;
  current: string;
}

const ALERT_THRESHOLDS = {
  queueBacklog: 100,
  failedJobs24h: 20,
  taskFailureRate: 0.15, // 15% failure rate
  pendingPaymentsStale: 10,
  succeededUnfulfilled: 5,
  dbLatencyMs: 1000,
  redisLatencyMs: 500,
};

@Injectable()
export class OpsMonitoringService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async getMetrics(redis?: IORedis): Promise<OpsMetrics> {
    const timestamp = new Date().toISOString();
    const now = Date.now();
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    // Database health
    const dbStart = Date.now();
    let dbStatus: 'up' | 'down' = 'up';
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'down';
    }
    const dbLatencyMs = Date.now() - dbStart;

    // Redis health
    const redisStart = Date.now();
    let redisStatus: 'up' | 'down' = 'up';
    if (redis) {
      try {
        await redis.ping();
      } catch {
        redisStatus = 'down';
      }
    } else {
      redisStatus = 'down';
    }
    const redisLatencyMs = Date.now() - redisStart;

    // Generation metrics
    const genPending = await this.count(generationJobs, eq(generationJobs.status, 'PENDING'));
    const genRunning = await this.count(generationJobs, eq(generationJobs.status, 'RUNNING'));
    const genSucceeded24h = await this.count(generationJobs, and(eq(generationJobs.status, 'SUCCEEDED'), gte(generationJobs.createdAt, yesterday)));
    const genFailed24h = await this.count(generationJobs, and(eq(generationJobs.status, 'FAILED'), gte(generationJobs.createdAt, yesterday)));
    const genCanceled24h = await this.count(generationJobs, and(eq(generationJobs.status, 'CANCELED'), gte(generationJobs.createdAt, yesterday)));

    // Task failure rate: failed / (succeeded + failed) in last 24h
    const totalCompleted = genSucceeded24h + genFailed24h;
    const failureRate24h = totalCompleted > 0 ? genFailed24h / totalCompleted : 0;

    // Payment metrics
    const payPending = await this.count(orders, eq(orders.status, 'PENDING'));
    const paySucceeded24h = await this.count(orders, and(eq(orders.status, 'SUCCEEDED'), gte(orders.createdAt, yesterday)));
    const payFailed24h = await this.count(orders, and(eq(orders.status, 'FAILED'), gte(orders.createdAt, yesterday)));
    const payRefunded = await this.count(orders, eq(orders.status, 'REFUNDED'));
    const succeededUnfulfilled = await this.count(orders, and(eq(orders.status, 'SUCCEEDED'), eq(orders.fulfillmentStatus, 'FAILED')));

    // Stale pending fulfillment: SUCCEEDED + PENDING fulfillment older than 1 hour
    const stalePendingFulfillment = await this.count(
      orders,
      and(
        eq(orders.status, 'SUCCEEDED'),
        eq(orders.fulfillmentStatus, 'PENDING'),
        lt(orders.updatedAt, oneHourAgo),
      ),
    );

    // Queue metrics (from Redis/BullMQ)
    let queueMetrics = { waiting: 0, active: 0, delayed: 0, failed: 0 };
    if (redis && redisStatus === 'up') {
      try {
        const prefix = process.env.BULLMQ_PREFIX || 'enova';
        const queueName = 'generation';
        const waiting = await redis.llen(`${prefix}:${queueName}:wait`);
        const active = await redis.llen(`${prefix}:${queueName}:active`);
        const delayed = await redis.zcard(`${prefix}:${queueName}:delayed`);
        const failed = await redis.zcard(`${prefix}:${queueName}:failed`);
        queueMetrics = { waiting, active, delayed, failed };
      } catch {
        // Queue metrics best-effort
      }
    }

    // Build alerts
    const alerts = this.buildAlerts({
      dbLatencyMs,
      redisLatencyMs,
      dbStatus,
      redisStatus,
      queueBacklog: queueMetrics.waiting + queueMetrics.delayed,
      failedJobs24h: genFailed24h,
      failureRate24h,
      stalePendingFulfillment,
      succeededUnfulfilled,
    });

    return {
      timestamp,
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      redis: { status: redisStatus, latencyMs: redisLatencyMs },
      generations: {
        pending: genPending,
        running: genRunning,
        succeeded24h: genSucceeded24h,
        failed24h: genFailed24h,
        canceled24h: genCanceled24h,
        failureRate24h: Math.round(failureRate24h * 1000) / 1000, // 3 decimal places
      },
      payments: {
        pending: payPending,
        succeeded24h: paySucceeded24h,
        failed24h: payFailed24h,
        refunded: payRefunded,
        succeededButUnfulfilled: succeededUnfulfilled,
        stalePendingFulfillment,
      },
      queue: queueMetrics,
      alerts,
    };
  }

  private buildAlerts(data: {
    dbLatencyMs: number;
    redisLatencyMs: number;
    dbStatus: string;
    redisStatus: string;
    queueBacklog: number;
    failedJobs24h: number;
    failureRate24h: number;
    stalePendingFulfillment: number;
    succeededUnfulfilled: number;
  }): OpsAlert[] {
    const alerts: OpsAlert[] = [];

    if (data.dbStatus === 'down') {
      alerts.push({
        level: 'critical', category: 'database', message: 'Database is down',
        metric: 'db.status', threshold: 'up', current: 'down',
      });
    } else if (data.dbLatencyMs > ALERT_THRESHOLDS.dbLatencyMs) {
      alerts.push({
        level: 'warning', category: 'database', message: 'Database latency high',
        metric: 'db.latencyMs', threshold: `${ALERT_THRESHOLDS.dbLatencyMs}ms`, current: `${data.dbLatencyMs}ms`,
      });
    }

    if (data.redisStatus === 'down') {
      alerts.push({
        level: 'critical', category: 'redis', message: 'Redis is down',
        metric: 'redis.status', threshold: 'up', current: 'down',
      });
    } else if (data.redisLatencyMs > ALERT_THRESHOLDS.redisLatencyMs) {
      alerts.push({
        level: 'warning', category: 'redis', message: 'Redis latency high',
        metric: 'redis.latencyMs', threshold: `${ALERT_THRESHOLDS.redisLatencyMs}ms`, current: `${data.redisLatencyMs}ms`,
      });
    }

    if (data.queueBacklog > ALERT_THRESHOLDS.queueBacklog) {
      alerts.push({
        level: 'warning', category: 'queue', message: 'Queue backlog high',
        metric: 'queue.backlog', threshold: `${ALERT_THRESHOLDS.queueBacklog}`, current: `${data.queueBacklog}`,
      });
    }

    if (data.failedJobs24h > ALERT_THRESHOLDS.failedJobs24h) {
      alerts.push({
        level: 'warning', category: 'generations', message: 'High job failure count in 24h',
        metric: 'generations.failed24h', threshold: `${ALERT_THRESHOLDS.failedJobs24h}`, current: `${data.failedJobs24h}`,
      });
    }

    if (data.failureRate24h > ALERT_THRESHOLDS.taskFailureRate) {
      alerts.push({
        level: 'warning', category: 'generations', message: 'Task failure rate exceeds threshold',
        metric: 'generations.failureRate24h', threshold: `${(ALERT_THRESHOLDS.taskFailureRate * 100).toFixed(0)}%`, current: `${(data.failureRate24h * 100).toFixed(1)}%`,
      });
    }

    if (data.stalePendingFulfillment > ALERT_THRESHOLDS.pendingPaymentsStale) {
      alerts.push({
        level: 'warning', category: 'payments', message: 'Stale pending fulfillment orders',
        metric: 'payments.stalePendingFulfillment', threshold: `${ALERT_THRESHOLDS.pendingPaymentsStale}`, current: `${data.stalePendingFulfillment}`,
      });
    }

    if (data.succeededUnfulfilled > ALERT_THRESHOLDS.succeededUnfulfilled) {
      alerts.push({
        level: 'critical', category: 'payments', message: 'Payments succeeded but fulfillment failed',
        metric: 'payments.succeededUnfulfilled', threshold: `${ALERT_THRESHOLDS.succeededUnfulfilled}`, current: `${data.succeededUnfulfilled}`,
      });
    }

    return alerts;
  }

  private async count(table: typeof generationJobs | typeof orders, condition: unknown): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row] = await this.db.select({ n: count() }).from(table as any).where(condition as any);
    return row?.n ?? 0;
  }
}
