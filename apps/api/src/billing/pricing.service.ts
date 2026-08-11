import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { domainError, ERROR_CODES, type GenerationType } from '@enova/contracts';
import { pricingRules, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';

export interface PricingQuote {
  credits: number;
}

/**
 * 定价服务：从 PricingRule 解析某 type/provider/model 的价格。
 * 价格计算集中在此，禁止把 `if (model === 'x') cost = 80` 散落在 Controller/Service。
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 查询某个生成配置的定价（必须 enabled）。 */
  async quote(type: GenerationType, provider: string, model: string): Promise<PricingQuote> {
    const rows = await this.db
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
    const rule = rows[0];
    if (!rule) {
      throw domainError(ERROR_CODES.PRICING_NOT_FOUND, `No pricing for ${type}/${provider}/${model}`, 422);
    }
    return { credits: rule.credits };
  }
}