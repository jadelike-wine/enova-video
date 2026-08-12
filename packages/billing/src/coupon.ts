import { and, count, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { coupons, couponRedemptions, type Database } from '@enova/db';
import { type Tx } from './wallet.js';

/** 优惠码类型：PERCENT=按百分比折扣；FLAT=固定金额折扣（分）。 */
export type CouponType = 'PERCENT' | 'FLAT';

/** 下单时冻结的优惠码快照（历史成交解释依据，禁止后续改码影响历史订单）。 */
export interface CouponSnapshot {
  code: string;
  type: CouponType;
  value: number;
  currency: string | null;
  discountAmountCents: number;
  originalAmountCents: number;
  finalAmountCents: number;
}

/**
 * P1-8: Promo / Coupon 基础领域服务。
 *
 * 设计约束（不破坏 Billing）：
 * - 优惠码规则独立存储（coupons），不散落在业务代码。
 * - 下单时冻结 coupon snapshot + discount/original/final amount，管理员改码不影响历史订单。
 * - 并发安全：同一事务内 `SELECT ... FOR UPDATE` 锁 coupon 行 + 统计已用次数，
 *   防止两个并发请求同时穿透 maxRedemptions / perUserLimit。
 * - 重复兑换：coupon_redemptions 对 orderId 唯一，同一订单不会重复命中。
 * - 拒绝 zero/negative 最终金额（COUPON_INVALID_FOR_ORDER）。
 *
 * 注意：本服务只负责"校验 + 冻结 + 记录兑换"，不负责支付金额的入账。
 * 支付与收入确认仍由 PaymentService 以 finalAmountCents 为准执行。
 */
export class CouponService {
  constructor(private readonly db: Database | Tx) {}

  /** 纯计算：按优惠码类型计算折扣金额与最终应付（分）。 */
  static computeDiscount(coupon: { type: string; value: number; currency: string | null }, amountCents: number): {
    discountAmountCents: number;
    finalAmountCents: number;
  } {
    let discount =
      coupon.type === 'PERCENT'
        ? Math.floor((amountCents * Math.min(Math.max(coupon.value, 0), 100)) / 100)
        : coupon.type === 'FLAT'
          ? Math.min(coupon.value, amountCents)
          : 0;
    if (discount < 0) discount = 0;
    const finalAmountCents = amountCents - discount;
    return { discountAmountCents: discount, finalAmountCents };
  }

  /**
   * 事务内校验并冻结一个优惠码，返回快照与折扣结果（不写支付）。
   *
   * 调用方应：
   * 1. 用本方法的结果填充订单的 couponCode / originalAmountCents / discountAmountCents /
   *    finalAmountCents / couponSnapshotJson；
   * 2. 用 finalAmountCents 作为实际支付金额调渠道下单。
   *
   * 幂等/并发：
   * - `SELECT ... FOR UPDATE` 锁 coupon 行，串行化同码并发兑换。
   * - 统计 maxRedemptions / perUserLimit，超限抛明确业务错误。
   * - 兑换记录 coupon_redemptions 在本方法内写入（orderId 唯一防重复）。
   */
  async apply(
    code: string,
    params: { amountCents: number; currency: string; userId: string; orderId: string },
  ): Promise<CouponSnapshot> {
    const { amountCents, currency, userId, orderId } = params;
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const locked = await tx.select().from(coupons).where(eq(coupons.code, code)).for('update');
      const coupon = locked[0];
      if (!coupon) throw domainError(ERROR_CODES.COUPON_NOT_FOUND, `Coupon not found: ${code}`, 404);
      if (!coupon.enabled) throw domainError(ERROR_CODES.COUPON_DISABLED, `Coupon is disabled: ${code}`, 400);
      if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
        throw domainError(ERROR_CODES.COUPON_EXPIRED, `Coupon not yet active: ${code}`, 400);
      }
      if (coupon.endsAt && now.getTime() > coupon.endsAt.getTime()) {
        throw domainError(ERROR_CODES.COUPON_EXPIRED, `Coupon has expired: ${code}`, 400);
      }
      if (coupon.currency && coupon.currency !== currency) {
        throw domainError(ERROR_CODES.COUPON_INVALID_FOR_ORDER, `Coupon currency mismatch: ${code}`, 400, {
          couponCurrency: coupon.currency,
          orderCurrency: currency,
        });
      }

      // 并发安全：coupon 行已 FOR UPDATE 串行化，此处统计不会穿透。
      if (coupon.maxRedemptions > 0) {
        const usedRows = await tx.select({ n: count() }).from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
        const used = Number(usedRows[0]?.n ?? 0);
        if (used >= coupon.maxRedemptions) {
          throw domainError(ERROR_CODES.COUPON_USAGE_LIMIT_REACHED, `Coupon redemption limit reached: ${code}`, 400, {
            used,
            max: coupon.maxRedemptions,
          });
        }
      }
      if (coupon.perUserLimit > 0) {
        const userRows = await tx
          .select({ n: count() })
          .from(couponRedemptions)
          .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.userId, userId)));
        const usedByUser = Number(userRows[0]?.n ?? 0);
        if (usedByUser >= coupon.perUserLimit) {
          throw domainError(ERROR_CODES.COUPON_USER_LIMIT_REACHED, `Coupon per-user limit reached: ${code}`, 400, {
            used: usedByUser,
            max: coupon.perUserLimit,
          });
        }
      }

      const { discountAmountCents, finalAmountCents } = CouponService.computeDiscount(coupon, amountCents);
      if (finalAmountCents <= 0) {
        throw domainError(ERROR_CODES.COUPON_INVALID_FOR_ORDER, 'Coupon discount results in non-positive amount', 400, {
          finalAmountCents,
        });
      }

      // 记录兑换（orderId 唯一，防同订单重复命中）。重复插入由唯一约束兜底。
      try {
        await tx.insert(couponRedemptions).values({
          couponId: coupon.id,
          orderId,
          userId,
          discountAmountCents,
        });
      } catch {
        throw domainError(ERROR_CODES.COUPON_INVALID_FOR_ORDER, 'Coupon already redeemed for this order', 409);
      }

      const snapshot: CouponSnapshot = {
        code: coupon.code,
        type: coupon.type as CouponType,
        value: coupon.value,
        currency: coupon.currency,
        discountAmountCents,
        originalAmountCents: amountCents,
        finalAmountCents,
      };
      return snapshot;
    });
  }
}