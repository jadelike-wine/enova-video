import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { domainError, ERROR_CODES, GENERATION_STATUSES, type GenerationStatus } from '@enova/contracts';
import {
  creditReservations,
  generationAttempts,
  generationDispatchOutbox,
  generationJobs,
  priceQuotes,
  usageEvents,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { WalletService } from '../billing/wallet.service.js';

export interface AdminGenerationView {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  provider: string | null;
  model: string | null;
  status: string;
  attemptCount: number;
  estimatedCostMicrousd: number;
  reportedCostMicrousd: number;
  finalCostMicrousd: number;
  costStatus: string;
  providerJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AdminGenerationDetailView extends AdminGenerationView {
  quote: {
    id: string;
    pricingVersionId: string;
    estimatedCredits: number;
    estimatedCostMicrousd: number;
    inputSnapshot: Record<string, unknown> | null;
    expiresAt: Date | null;
  } | null;
  reservation: {
    id: string;
    reservedCredits: number;
    capturedCredits: number;
    releasedCredits: number;
    status: string;
    settledAt: Date | null;
  } | null;
  attempts: Array<{
    id: string;
    attemptNo: number;
    provider: string;
    model: string;
    status: string;
    providerJobId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    estimatedCostMicrousd: number;
    reportedCostMicrousd: number;
    startedAt: Date;
    endedAt: Date | null;
  }>;
  outbox: Array<{
    id: string;
    eventType: string;
    status: string;
    attempts: number;
    lastError: string | null;
    dispatchedAt: Date | null;
    createdAt: Date;
  }>;
  usageEvent: {
    id: string;
    estimatedCostMicrousd: number;
    reportedCostMicrousd: number;
    finalCostMicrousd: number;
    costStatus: string;
    creditsCharged: number;
  } | null;
}

/**
 * 生成任务管理（Admin P0-8）。
 * 列表 / 详情（含 quote/reservation/attempts/outbox/usage）/ force-fail / replay。
 */
@Injectable()
export class GenerationsAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async list(params: {
    limit?: number;
    offset?: number;
    status?: string;
    workspaceId?: string;
  }): Promise<AdminGenerationView[]> {
    const limitSafe = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offsetSafe = Math.max(params.offset ?? 0, 0);
    const conds: SQL[] = [];
    if (params.status) conds.push(eq(generationJobs.status, params.status as GenerationStatus));
    if (params.workspaceId) conds.push(eq(generationJobs.workspaceId, params.workspaceId));
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(generationJobs.createdAt))
      .limit(limitSafe)
      .offset(offsetSafe);
    return rows.map((r) => this.toView(r));
  }

  async detail(jobId: string): Promise<AdminGenerationDetailView> {
    const jobRows = await this.db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    const job = jobRows[0];
    if (!job) throw domainError(ERROR_CODES.NOT_FOUND, 'Generation job not found', 404);

    const [quoteRow, reservationRow, usageRow] = await Promise.all([
      this.db.select().from(priceQuotes).where(eq(priceQuotes.generationJobId, jobId)).limit(1),
      this.db.select().from(creditReservations).where(eq(creditReservations.generationJobId, jobId)).limit(1),
      this.db.select().from(usageEvents).where(eq(usageEvents.generationJobId, jobId)).limit(1),
    ]);
    const attemptRows = await this.db
      .select()
      .from(generationAttempts)
      .where(eq(generationAttempts.generationJobId, jobId))
      .orderBy(generationAttempts.attemptNo);
    const outboxRows = await this.db
      .select()
      .from(generationDispatchOutbox)
      .where(eq(generationDispatchOutbox.generationJobId, jobId))
      .orderBy(desc(generationDispatchOutbox.createdAt));

    return {
      ...this.toView(job),
      quote: quoteRow[0]
        ? {
            id: quoteRow[0].id,
            pricingVersionId: quoteRow[0].pricingVersionId,
            estimatedCredits: quoteRow[0].estimatedCredits,
            estimatedCostMicrousd: quoteRow[0].estimatedCostMicrousd,
            inputSnapshot: quoteRow[0].inputSnapshot,
            expiresAt: quoteRow[0].expiresAt,
          }
        : null,
      reservation: reservationRow[0]
        ? {
            id: reservationRow[0].id,
            reservedCredits: reservationRow[0].reservedCredits,
            capturedCredits: reservationRow[0].capturedCredits,
            releasedCredits: reservationRow[0].releasedCredits,
            status: reservationRow[0].status,
            settledAt: reservationRow[0].settledAt,
          }
        : null,
      attempts: attemptRows.map((a) => ({
        id: a.id,
        attemptNo: a.attemptNo,
        provider: a.provider,
        model: a.model,
        status: a.status,
        providerJobId: a.providerJobId,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        estimatedCostMicrousd: a.estimatedCostMicrousd,
        reportedCostMicrousd: a.reportedCostMicrousd,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
      })),
      outbox: outboxRows.map((o) => ({
        id: o.id,
        eventType: o.eventType,
        status: o.status,
        attempts: o.attempts,
        lastError: o.lastError,
        dispatchedAt: o.dispatchedAt,
        createdAt: o.createdAt,
      })),
      usageEvent: usageRow[0]
        ? {
            id: usageRow[0].id,
            estimatedCostMicrousd: usageRow[0].estimatedCostMicrousd,
            reportedCostMicrousd: usageRow[0].reportedCostMicrousd,
            finalCostMicrousd: usageRow[0].finalCostMicrousd,
            costStatus: usageRow[0].costStatus,
            creditsCharged: usageRow[0].creditsCharged,
          }
        : null,
    };
  }

  /**
   * 强制失败并释放 reservation（运营救援）。
   * 用于 stuck job（长时间 RUNNING 但 worker 已死）。
   * 事务内：job → FAILED；reservation → RELEASED；wallet.reserved_balance 扣减。
   * 幂等：已 FAILED/CANCELED 的 job 直接返回成功。
   */
  async forceFail(jobId: string, reason: string): Promise<{ status: string; releasedCredits: number }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(generationJobs).where(eq(generationJobs.id, jobId)).for('update').limit(1);
      const job = rows[0];
      if (!job) throw domainError(ERROR_CODES.NOT_FOUND, 'Generation job not found', 404);

      if (job.status === GENERATION_STATUSES.FAILED || job.status === GENERATION_STATUSES.CANCELED) {
        return { status: job.status, releasedCredits: 0 };
      }
      if (job.status === GENERATION_STATUSES.SUCCEEDED) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'Cannot force-fail a succeeded job', 409);
      }

      await tx
        .update(generationJobs)
        .set({
          status: GENERATION_STATUSES.FAILED,
          errorCode: 'ADMIN_FORCE_FAIL',
          errorMessage: reason,
          completedAt: new Date(),
        })
        .where(eq(generationJobs.id, jobId));

      // 释放 reservation（若存在且未释放）。
      // P0 修复：复用 WalletGateway.releaseInTx，保证释放的剩余额度回补到 balance（资金守恒），
      // 并写入 GENERATION_RELEASE ledger（幂等 + 可审计）。原实现只扣 reservedBalance 不回补
      // balance，导致强制失败时用户 credits 被永久销毁。
      let releasedCredits = 0;
      const resRows = await tx
        .select()
        .from(creditReservations)
        .where(eq(creditReservations.generationJobId, jobId))
        .for('update')
        .limit(1);
      const reservation = resRows[0];
      if (reservation && reservation.status !== 'RELEASED') {
        const remaining = reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits;
        await this.wallet.releaseInTx(tx, job.workspaceId, jobId, `release:admin:${jobId}`);
        releasedCredits = Math.max(0, remaining);
      }

      return { status: GENERATION_STATUSES.FAILED, releasedCredits };
    });
  }

  /**
   * 重置 outbox 为 PENDING，触发 dispatcher 重新投递（运营救援）。
   * 仅对 QUEUED/RUNNING 状态的 job 有效。
   */
  async replayOutbox(jobId: string): Promise<{ reset: number }> {
    const jobRows = await this.db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    const job = jobRows[0];
    if (!job) throw domainError(ERROR_CODES.NOT_FOUND, 'Generation job not found', 404);
    if (job.status !== GENERATION_STATUSES.QUEUED && job.status !== GENERATION_STATUSES.RUNNING) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Cannot replay outbox for job in status ${job.status}`, 409);
    }

    const result = await this.db
      .update(generationDispatchOutbox)
      .set({ status: 'PENDING', attempts: 0, lastError: null, availableAt: new Date(), dispatchedAt: null })
      .where(
        and(
          eq(generationDispatchOutbox.generationJobId, jobId),
          inArray(generationDispatchOutbox.status, ['DISPATCHED', 'SUPERSEDED']),
        ),
      )
      .returning({ id: generationDispatchOutbox.id });

    return { reset: result.length };
  }

  /** 获取 job 当前状态（供审计 before 使用）。 */
  async getStatus(jobId: string): Promise<string | null> {
    const rows = await this.db
      .select({ status: generationJobs.status })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);
    return rows[0]?.status ?? null;
  }

  private toView(r: typeof generationJobs.$inferSelect): AdminGenerationView {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      type: r.type,
      provider: r.provider,
      model: r.model,
      status: r.status,
      attemptCount: r.attemptCount,
      estimatedCostMicrousd: r.estimatedCostMicrousd,
      reportedCostMicrousd: r.reportedCostMicrousd,
      finalCostMicrousd: r.finalCostMicrousd,
      costStatus: r.costStatus,
      providerJobId: r.providerJobId,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }
}
