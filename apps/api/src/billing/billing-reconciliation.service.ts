import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WalletService } from './wallet.service.js';

/**
 * Billing Reconciliation（P0 红队：Invariant B drift 检测）。
 *
 * 目标：确保 wallet.reserved_balance == SUM(reservation remaining) 永远成立。
 * 所有 reserve/capture/release 都经 WalletGateway 事务化执行，理论不变量应恒成立；
 * 本服务作为运行时安全网，周期性核对并 produce structured 结果（log/metric），
 * 一旦发生 drift 立刻可观测，而不是等用户发现余额异常。
 *
 * 明确策略：
 * - 只 DETECT + LOG + METRIC，绝不自动修账（避免修复逻辑掩盖真实 bug）。
 * - 修复由显式调用 WalletGateway.repairReservationInvariant 完成（需原因 + requestId + 审计）。
 */
@Injectable()
export class BillingReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingReconciliationService.name);
  private readonly intervalMs = 60_000;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(WalletService) private readonly wallet: WalletService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.run().catch((err) => {
        this.logger.error('billing reconciliation failed', err instanceof Error ? err.message : String(err));
      });
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 执行一次核对：返回发现的 drift 数量；有 drift 时打 structured error。 */
  async run(): Promise<{ checked: number; drift: number }> {
    const mismatches = await this.wallet.checkReservationInvariant();
    if (mismatches.length > 0) {
      // structured 错误：含 drift 明细，供告警/日志聚合。绝不静默吞掉。
      this.logger.error(
        `wallet <-> reservation invariant drift detected: ${mismatches.length} wallet(s)`,
        JSON.stringify(mismatches),
      );
    }
    return { checked: mismatches.length, drift: mismatches.length };
  }
}