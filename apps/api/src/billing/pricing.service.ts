import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES, type GenerationType } from '@enova/contracts';
import {
  priceQuotes,
  pricingRules,
  pricingVersions,
  type Database,
} from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface PricingQuote {
  /** PriceQuote 行 ID（用于关联 generation job）。 */
  quoteId: string;
  /** 不可变 PricingVersion ID。 */
  pricingVersionId: string;
  credits: number;
  /** 估算供应商成本（微美元，1 USD = 1_000_000）。 */
  estimatedCostMicrousd: number;
  /** 估算收入（分，人民币）。 */
  estimatedRevenueCents: number;
}

export interface PriceQuoteInput {
  type: GenerationType;
  provider: string;
  model: string;
  /** 定价维度（duration/resolution/quality 等），用于未来精细化定价。 */
  dimensions?: Record<string, unknown>;
}

/**
 * 定价服务（P0-3）。
 *
 * 核心不变量：
 * - PricingVersion 发布后不可变（status=PUBLISHED 后禁止修改）。
 * - 每次报价创建独立的 PriceQuote 行，关联不可变 PricingVersion。
 * - GenerationJob 关联 PriceQuote，保证历史价格永远可追溯。
 * - 管理员修改价格 → 发布新版本，不修改旧版本。
 *
 * 向后兼容：如果某 type/provider/model 没有 PUBLISHED 的 pricing_version，
 * 退化到从 pricing_rules 读取（兼容旧数据），并自动创建一个 PUBLISHED version。
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * 报价：解析当前生效的 PricingVersion，创建不可变 PriceQuote。
   * 只读路径——绝不隐式创建 / publish PricingVersion。
   * 若缺少 PUBLISHED version，必须由管理员显式发布（quote 抛错，不自动创建）。
   */
  async quote(input: PriceQuoteInput): Promise<PricingQuote> {
    const version = await this.resolveActiveVersion(input.type, input.provider, input.model);
    const quoteId = crypto.randomUUID();

    const pricingJson = (version.pricingJson ?? {}) as { providerCostMicrousd?: number; estimatedRevenueCents?: number };
    const estimatedCostMicrousd = typeof pricingJson.providerCostMicrousd === 'number' ? pricingJson.providerCostMicrousd : 0;
    const estimatedRevenueCents = typeof pricingJson.estimatedRevenueCents === 'number' ? pricingJson.estimatedRevenueCents : 0;

    await this.db.insert(priceQuotes).values({
      id: quoteId,
      pricingVersionId: version.id,
      inputSnapshot: { ...input.dimensions, type: input.type, provider: input.provider, model: input.model },
      estimatedCredits: version.credits,
      estimatedRevenueCents,
      estimatedCostMicrousd,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
    });

    return {
      quoteId,
      pricingVersionId: version.id,
      credits: version.credits,
      estimatedCostMicrousd,
      estimatedRevenueCents,
    };
  }

  /**
   * 解析当前生效的 PUBLISHED PricingVersion（只读）。
   * 无 PUBLISHED version 时抛错——绝不隐式创建 / publish。
   * 定价配置的创建与发布只能通过 Admin 显式操作完成。
   */
  private async resolveActiveVersion(type: GenerationType, provider: string, model: string) {
    const published = await this.db
      .select()
      .from(pricingVersions)
      .where(
        and(
          eq(pricingVersions.generationType, type),
          eq(pricingVersions.provider, provider),
          eq(pricingVersions.model, model),
          eq(pricingVersions.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(pricingVersions.version))
      .limit(1);

    if (published.length > 0) return published[0];

    throw domainError(
      ERROR_CODES.PRICING_NOT_FOUND,
      `No published pricing for ${type}/${provider}/${model}. Admin must publish a pricing version before generation can be quoted.`,
      422,
    );
  }

  /**
   * 显式回填：从 legacy pricing_rules 创建首个 PUBLISHED PricingVersion（仅调用方显式触发，
   * 例如启动迁移 / 管理后台发布，绝不在报价只读路径上自动调用）。
   * 幂等：已存在 PUBLISHED version 时直接返回已存在版本。
   */
  async bootstrapVersionFromRule(type: GenerationType, provider: string, model: string): Promise<{ versionId: string; created: boolean }> {
    const existing = await this.db
      .select()
      .from(pricingVersions)
      .where(
        and(
          eq(pricingVersions.generationType, type),
          eq(pricingVersions.provider, provider),
          eq(pricingVersions.model, model),
          eq(pricingVersions.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(pricingVersions.version))
      .limit(1);
    if (existing.length > 0) return { versionId: existing[0].id, created: false };

    const ruleRows = await this.db
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.generationType, type),
          eq(pricingRules.provider, provider),
          eq(pricingRules.model, model),
          eq(pricingRules.enabled, true),
        ),
      )
      .limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw domainError(ERROR_CODES.PRICING_NOT_FOUND, `No pricing rule for ${type}/${provider}/${model}`, 422);
    }

    const versionId = crypto.randomUUID();
    try {
      const [created] = await this.db
        .insert(pricingVersions)
        .values({
          id: versionId,
          pricingRuleId: rule.id,
          version: 1,
          generationType: type,
          provider,
          model,
          dimensionsJson: {},
          credits: rule.credits,
          pricingJson: rule.pricingJson ?? {},
          status: 'PUBLISHED',
          effectiveAt: new Date(),
          publishedAt: new Date(),
        })
        .returning();
      return { versionId: created.id, created: true };
    } catch {
      // 并发创建：重读已存在的。
      const re = await this.db
        .select()
        .from(pricingVersions)
        .where(
          and(
            eq(pricingVersions.generationType, type),
            eq(pricingVersions.provider, provider),
            eq(pricingVersions.model, model),
            eq(pricingVersions.status, 'PUBLISHED'),
          ),
        )
        .orderBy(desc(pricingVersions.version))
        .limit(1);
      if (re.length > 0) return { versionId: re[0].id, created: false };
      throw domainError(ERROR_CODES.PRICING_NOT_FOUND, 'Failed to bootstrap pricing version', 422);
    }
  }

  // ---- Admin: Pricing Version 管理 ----

  /** 发布新 pricing version（不可变，发布后不可修改）。 */
  async publishVersion(input: {
    generationType: GenerationType;
    provider: string;
    model: string;
    credits: number;
    pricingJson?: Record<string, unknown>;
    dimensionsJson?: Record<string, unknown>;
  }): Promise<{ versionId: string; version: number }> {
    // 查找当前最大版本号。
    const existing = await this.db
      .select({ version: pricingVersions.version })
      .from(pricingVersions)
      .where(
        and(
          eq(pricingVersions.generationType, input.generationType),
          eq(pricingVersions.provider, input.provider),
          eq(pricingVersions.model, input.model),
        ),
      )
      .orderBy(desc(pricingVersions.version))
      .limit(1);
    const nextVersion = (existing[0]?.version ?? 0) + 1;
    const versionId = crypto.randomUUID();

    const [created] = await this.db
      .insert(pricingVersions)
      .values({
        id: versionId,
        version: nextVersion,
        generationType: input.generationType,
        provider: input.provider,
        model: input.model,
        dimensionsJson: input.dimensionsJson ?? {},
        credits: input.credits,
        pricingJson: input.pricingJson ?? {},
        status: 'PUBLISHED',
        effectiveAt: new Date(),
        publishedAt: new Date(),
      })
      .returning();

    return { versionId: created.id, version: created.version };
  }

  /** 归档旧版本（禁止删除已发布的版本数据，只能归档）。 */
  async archiveVersion(versionId: string): Promise<void> {
    await this.db
      .update(pricingVersions)
      .set({ status: 'ARCHIVED' })
      .where(and(eq(pricingVersions.id, versionId), eq(pricingVersions.status, 'PUBLISHED')));
  }

  /** 预览报价（不创建 PriceQuote 行，仅计算）。 */
  async previewQuote(input: PriceQuoteInput): Promise<{
    credits: number;
    estimatedCostMicrousd: number;
    estimatedRevenueCents: number;
    pricingVersionId: string | null;
  }> {
    const published = await this.db
      .select()
      .from(pricingVersions)
      .where(
        and(
          eq(pricingVersions.generationType, input.type),
          eq(pricingVersions.provider, input.provider),
          eq(pricingVersions.model, input.model),
          eq(pricingVersions.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(pricingVersions.version))
      .limit(1);

    if (published.length > 0) {
      const v = published[0];
      const pj = (v.pricingJson ?? {}) as { providerCostMicrousd?: number; estimatedRevenueCents?: number };
      return {
        credits: v.credits,
        estimatedCostMicrousd: typeof pj.providerCostMicrousd === 'number' ? pj.providerCostMicrousd : 0,
        estimatedRevenueCents: typeof pj.estimatedRevenueCents === 'number' ? pj.estimatedRevenueCents : 0,
        pricingVersionId: v.id,
      };
    }

    // 兜底：从 pricing_rules 预览。
    const ruleRows = await this.db
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.generationType, input.type),
          eq(pricingRules.provider, input.provider),
          eq(pricingRules.model, input.model),
          eq(pricingRules.enabled, true),
        ),
      )
      .limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw domainError(ERROR_CODES.PRICING_NOT_FOUND, `No pricing for ${input.type}/${input.provider}/${input.model}`, 422);
    }
    const pj = (rule.pricingJson ?? {}) as { providerCostMicrousd?: number; estimatedRevenueCents?: number };
    return {
      credits: rule.credits,
      estimatedCostMicrousd: typeof pj.providerCostMicrousd === 'number' ? pj.providerCostMicrousd : 0,
      estimatedRevenueCents: typeof pj.estimatedRevenueCents === 'number' ? pj.estimatedRevenueCents : 0,
      pricingVersionId: null,
    };
  }
}
