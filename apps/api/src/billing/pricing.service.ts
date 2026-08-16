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
import {
  calculateImagePrice,
  calculateVideoPrice,
  extractDynamicRules,
  extractPricingDimensions,
  type CalculationBreakdown,
  type DynamicPricingRules,
} from '@enova/billing';

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
  /** 定价维度（duration/resolution/quality/width/height/fps/numFrames/frameRate 等）。 */
  dimensions?: Record<string, unknown>;
}

/**
 * 定价服务（P0-3 + 动态定价升级）。
 *
 * 核心不变量：
 * - PricingVersion 发布后不可变（status=PUBLISHED 后禁止修改）。
 * - 每次报价创建独立的 PriceQuote 行，关联不可变 PricingVersion。
 * - GenerationJob 关联 PriceQuote，保证历史价格永远可追溯。
 * - 管理员修改价格 → 发布新版本，不修改旧版本。
 *
 * 动态定价：
 * - 规则优先级：dynamic pricing rules > fixed credits pricing > no pricing error。
 * - 动态规则存储在 pricing_versions.pricing_json.rules 中。
 * - 如果存在动态规则，按 input 参数计算 credits；否则使用固定 version.credits。
 * - 计算过程保存到 price_quotes.calculation_snapshot 供审计。
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * 报价：解析当前生效的 PricingVersion，创建不可变 PriceQuote。
   * 只读路径——绝不隐式创建 / publish PricingVersion。
   * 若缺少 PUBLISHED version，必须由管理员显式发布（quote 抛错，不自动创建）。
   *
   * 动态定价：如果 version 中包含动态规则，则按 input.dimensions 计算 credits。
   */
  async quote(input: PriceQuoteInput): Promise<PricingQuote> {
    const version = await this.resolveActiveVersion(input.type, input.provider, input.model);
    const quoteId = crypto.randomUUID();

    const pricingJson = (version.pricingJson ?? {}) as {
      providerCostMicrousd?: number;
      estimatedRevenueCents?: number;
      rules?: unknown;
    };
    const estimatedCostMicrousd = typeof pricingJson.providerCostMicrousd === 'number' ? pricingJson.providerCostMicrousd : 0;
    const estimatedRevenueCents = typeof pricingJson.estimatedRevenueCents === 'number' ? pricingJson.estimatedRevenueCents : 0;

    // ---- 动态定价计算 ----
    // 规则优先级：dynamic pricing rules > fixed credits pricing
    const dynamicRules = extractDynamicRules(version.pricingJson, version.dimensionsJson);
    let credits = version.credits;
    let calculationSnapshot: Record<string, unknown> | undefined;

    if (dynamicRules) {
      const result = this.calculateDynamicPrice(input.type, dynamicRules, input.dimensions ?? {});
      credits = result.credits;
      calculationSnapshot = result.breakdown as unknown as Record<string, unknown>;
    }

    await this.db.insert(priceQuotes).values({
      id: quoteId,
      pricingVersionId: version.id,
      inputSnapshot: { ...input.dimensions, type: input.type, provider: input.provider, model: input.model },
      estimatedCredits: credits,
      estimatedRevenueCents,
      estimatedCostMicrousd,
      calculationSnapshot,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
    });

    return {
      quoteId,
      pricingVersionId: version.id,
      credits,
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
    breakdown?: CalculationBreakdown;
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
      const estimatedCostMicrousd = typeof pj.providerCostMicrousd === 'number' ? pj.providerCostMicrousd : 0;
      const estimatedRevenueCents = typeof pj.estimatedRevenueCents === 'number' ? pj.estimatedRevenueCents : 0;

      // 动态定价计算
      const dynamicRules = extractDynamicRules(v.pricingJson, v.dimensionsJson);
      if (dynamicRules) {
        const result = this.calculateDynamicPrice(input.type, dynamicRules, input.dimensions ?? {});
        return {
          credits: result.credits,
          estimatedCostMicrousd,
          estimatedRevenueCents,
          pricingVersionId: v.id,
          breakdown: result.breakdown,
        };
      }

      return {
        credits: v.credits,
        estimatedCostMicrousd,
        estimatedRevenueCents,
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

    // 也检查 rule 是否有动态规则
    const dynamicRules = extractDynamicRules(rule.pricingJson, null);
    if (dynamicRules) {
      const result = this.calculateDynamicPrice(input.type, dynamicRules, input.dimensions ?? {});
      return {
        credits: result.credits,
        estimatedCostMicrousd: typeof pj.providerCostMicrousd === 'number' ? pj.providerCostMicrousd : 0,
        estimatedRevenueCents: typeof pj.estimatedRevenueCents === 'number' ? pj.estimatedRevenueCents : 0,
        pricingVersionId: null,
        breakdown: result.breakdown,
      };
    }

    return {
      credits: rule.credits,
      estimatedCostMicrousd: typeof pj.providerCostMicrousd === 'number' ? pj.providerCostMicrousd : 0,
      estimatedRevenueCents: typeof pj.estimatedRevenueCents === 'number' ? pj.estimatedRevenueCents : 0,
      pricingVersionId: null,
    };
  }

  // ---- 内部：动态定价计算 ----

  /**
   * 根据 GenerationType 分派到对应的定价计算函数。
   * 如果 type 不支持动态定价，回退到固定 credits。
   */
  private calculateDynamicPrice(
    type: GenerationType,
    rules: DynamicPricingRules,
    dimensions: Record<string, unknown>,
  ): { credits: number; breakdown: CalculationBreakdown } {
    if (type === 'IMAGE') {
      const input = extractPricingDimensions(type, dimensions) as Parameters<typeof calculateImagePrice>[1];
      return calculateImagePrice(rules, input);
    }

    if (type === 'VIDEO') {
      const input = extractPricingDimensions(type, dimensions) as Parameters<typeof calculateVideoPrice>[1];
      return calculateVideoPrice(rules, input);
    }

    // 不支持动态定价的类型：回退到 baseCredits
    return {
      credits: rules.baseCredits,
      breakdown: { baseCredits: rules.baseCredits },
    };
  }
}
