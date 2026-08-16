import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES, type GenerationType } from '@enova/contracts';
import { pricingRules, pricingVersions, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { PricingService, type PriceQuoteInput } from '../billing/pricing.service.js';

/**
 * 系统支持的模型目录。
 *
 * 这是后端权威的模型注册表，前端 `apps/web/lib/models.ts` 应与此保持一致。
 * 定价管理页面从这里获取模型列表，再 LEFT JOIN pricing_versions，
 * 确保未配置 pricing 的模型也能显示为「未配置」。
 */
export const SYSTEM_MODELS: ReadonlyArray<{
  generationType: GenerationType;
  provider: string;
  model: string;
  displayName: string;
}> = [
  { generationType: 'IMAGE', provider: 'agnes', model: 'agnes-image-2.1-flash', displayName: 'Agnes Image 2.1 Flash' },
  { generationType: 'VIDEO', provider: 'agnes', model: 'agnes-video-v2.0', displayName: 'Agnes Video V2.0' },
];

/** 模型定价概览行：系统模型 + 最新 PUBLISHED pricing 信息（可能为 null）。 */
export interface AdminModelPricingView {
  generationType: string;
  provider: string;
  model: string;
  displayName: string;
  /** 最新 PUBLISHED 版本号；无则 null。 */
  currentVersion: number | null;
  /** 当前 Credits；无则 null。 */
  currentCredits: number | null;
  /** 当前版本 ID；无则 null。 */
  pricingVersionId: string | null;
  /** 发布时间；无则 null。 */
  publishedAt: Date | null;
  /** UI 状态：未配置 / 已发布 / 草稿 / 已归档。 */
  status: 'UNCONFIGURED' | 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
}

export interface AdminPricingRuleView {
  id: string;
  generationType: string;
  provider: string;
  model: string;
  credits: number;
  pricingJson: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPricingVersionView {
  id: string;
  pricingRuleId: string | null;
  version: number;
  generationType: string;
  provider: string;
  model: string;
  dimensionsJson: Record<string, unknown> | null;
  credits: number;
  pricingJson: Record<string, unknown> | null;
  status: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

/**
 * 定价管理（Admin P0-8）。
 * - Pricing Rules：增删改查（基础规则，不影响历史 job）。
 * - Pricing Versions：列表 / 发布 / 归档（不可变，发布后不可修改）。
 * - Preview Quote：根据当前 PUBLISHED version 预览报价。
 * 高危操作（publish/archive）由 controller 落审计。
 */
@Injectable()
export class PricingAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // ---- Pricing Rules ----

  async listRules(params: { limit?: number; offset?: number }): Promise<AdminPricingRuleView[]> {
    const limitSafe = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offsetSafe = Math.max(params.offset ?? 0, 0);
    const rows = await this.db
      .select()
      .from(pricingRules)
      .orderBy(desc(pricingRules.createdAt))
      .limit(limitSafe)
      .offset(offsetSafe);
    return rows.map((r) => ({
      id: r.id,
      generationType: r.generationType,
      provider: r.provider,
      model: r.model,
      credits: r.credits,
      pricingJson: r.pricingJson,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createRule(input: {
    generationType: GenerationType;
    provider: string;
    model: string;
    credits: number;
    pricingJson?: Record<string, unknown>;
  }): Promise<AdminPricingRuleView> {
    const [created] = await this.db
      .insert(pricingRules)
      .values({
        generationType: input.generationType,
        provider: input.provider,
        model: input.model,
        credits: input.credits,
        pricingJson: input.pricingJson ?? {},
        enabled: true,
      })
      .returning();
    return this.toRuleView(created);
  }

  async updateRule(
    id: string,
    input: { credits?: number; pricingJson?: Record<string, unknown>; enabled?: boolean },
  ): Promise<AdminPricingRuleView> {
    const rows = await this.db.select().from(pricingRules).where(eq(pricingRules.id, id)).limit(1);
    if (!rows[0]) throw domainError(ERROR_CODES.NOT_FOUND, 'Pricing rule not found', 404);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.credits !== undefined) updates.credits = input.credits;
    if (input.pricingJson !== undefined) updates.pricingJson = input.pricingJson;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    const [updated] = await this.db.update(pricingRules).set(updates).where(eq(pricingRules.id, id)).returning();
    return this.toRuleView(updated);
  }

  // ---- Pricing Versions ----

  async listVersions(params: {
    generationType?: string;
    provider?: string;
    model?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminPricingVersionView[]> {
    const limitSafe = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offsetSafe = Math.max(params.offset ?? 0, 0);
    const conds = [];
    if (params.generationType) conds.push(eq(pricingVersions.generationType, params.generationType as GenerationType));
    if (params.provider) conds.push(eq(pricingVersions.provider, params.provider));
    if (params.model) conds.push(eq(pricingVersions.model, params.model));
    if (params.status) conds.push(eq(pricingVersions.status, params.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'));
    const rows = await this.db
      .select()
      .from(pricingVersions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(pricingVersions.version))
      .limit(limitSafe)
      .offset(offsetSafe);
    return rows.map((r) => ({
      id: r.id,
      pricingRuleId: r.pricingRuleId,
      version: r.version,
      generationType: r.generationType,
      provider: r.provider,
      model: r.model,
      dimensionsJson: r.dimensionsJson,
      credits: r.credits,
      pricingJson: r.pricingJson,
      status: r.status,
      effectiveAt: r.effectiveAt,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
    }));
  }

  /** 发布新版本（不可变）。 */
  async publishVersion(input: {
    generationType: GenerationType;
    provider: string;
    model: string;
    credits: number;
    pricingJson?: Record<string, unknown>;
    dimensionsJson?: Record<string, unknown>;
  }): Promise<{ versionId: string; version: number }> {
    return this.pricing.publishVersion(input);
  }

  /** 归档版本（禁止删除）。 */
  async archiveVersion(versionId: string): Promise<void> {
    await this.pricing.archiveVersion(versionId);
  }

  /** 预览报价。 */
  async previewQuote(input: PriceQuoteInput) {
    return this.pricing.previewQuote(input);
  }

  /**
   * 模型定价概览：系统模型 LEFT JOIN 最新 PUBLISHED pricing_versions。
   * 确保未配置 pricing 的模型也展示出来（status = UNCONFIGURED）。
   */
  async listModelPricingOverview(params?: {
    generationType?: string;
  }): Promise<AdminModelPricingView[]> {
    const models = params?.generationType
      ? SYSTEM_MODELS.filter((m) => m.generationType === params.generationType)
      : SYSTEM_MODELS;

    // 查询所有 PUBLISHED 版本，按 version 降序，取每个 model 的最新一条。
    const publishedRows = await this.db
      .select()
      .from(pricingVersions)
      .where(eq(pricingVersions.status, 'PUBLISHED'))
      .orderBy(desc(pricingVersions.version));

    // 按 `${generationType}:${provider}:${model}` 分组，取 version 最大的。
    const latestMap = new Map<string, (typeof publishedRows)[number]>();
    for (const row of publishedRows) {
      const key = `${row.generationType}:${row.provider}:${row.model}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, row);
      }
    }

    return models.map((m) => {
      const key = `${m.generationType}:${m.provider}:${m.model}`;
      const latest = latestMap.get(key);
      if (!latest) {
        return {
          generationType: m.generationType,
          provider: m.provider,
          model: m.model,
          displayName: m.displayName,
          currentVersion: null,
          currentCredits: null,
          pricingVersionId: null,
          publishedAt: null,
          status: 'UNCONFIGURED' as const,
        };
      }
      return {
        generationType: m.generationType,
        provider: m.provider,
        model: m.model,
        displayName: m.displayName,
        currentVersion: latest.version,
        currentCredits: latest.credits,
        pricingVersionId: latest.id,
        publishedAt: latest.publishedAt,
        status: 'PUBLISHED' as const,
      };
    });
  }

  /** 获取 rule 当前状态（审计 before）。 */
  async getRule(id: string): Promise<AdminPricingRuleView | null> {
    const rows = await this.db.select().from(pricingRules).where(eq(pricingRules.id, id)).limit(1);
    return rows[0] ? this.toRuleView(rows[0]) : null;
  }

  private toRuleView(r: typeof pricingRules.$inferSelect): AdminPricingRuleView {
    return {
      id: r.id,
      generationType: r.generationType,
      provider: r.provider,
      model: r.model,
      credits: r.credits,
      pricingJson: r.pricingJson,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
