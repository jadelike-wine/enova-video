import { describe, expect, it } from 'vitest';
import { PricingService, type PriceQuoteInput } from './pricing.service.js';

/**
 * P0-4 回归测试：PricingVersion / PriceQuote 冽结报价。
 *  - quote job A → 管理员改价（发布新 version）→ 再次 quote job B。
 *  - 验证：job A 绑定旧的不可变 version，job B 绑定新 version。历史 job 绝不被新价格覆盖。
 */
function tableKey(table: unknown): string {
  if (typeof table === 'string') return table;
  const name = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
  return typeof name === 'string' ? name : String(table);
}

interface Version {
  id: string;
  version: number;
  credits: number;
  pricingJson: { providerCostMicrousd?: number; estimatedRevenueCents?: number; rules?: unknown } | null;
  dimensionsJson: Record<string, unknown> | null;
}

function createHarness(currentVersion: () => Version) {
  const insertedQuotes: Array<{ pricingVersionId: string; estimatedCredits: number }> = [];

  const db = {
    select: () => ({
      from: (t: unknown) => {
        const key = tableKey(t);
        const chain: any = {
          where: () => {
            if (key === 'pricing_versions') {
              chain.orderBy = () => ({ limit: () => Promise.resolve([currentVersion()]) });
            }
            return chain;
          },
          limit: () => Promise.resolve([]),
        };
        return chain;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: any) => {
        const key = tableKey(t);
        if (key === 'price_quotes') {
          insertedQuotes.push({ pricingVersionId: v.pricingVersionId, estimatedCredits: v.estimatedCredits });
        }
        return { returning: () => Promise.resolve([]) };
      },
      returning: () => Promise.resolve([]),
    }),
  };

  const svc = new PricingService(db as any);
  return { svc, insertedQuotes };
}

const input: PriceQuoteInput = { type: 'VIDEO', provider: 'agnes', model: 'video-1', dimensions: { duration: 10 } };

describe('PricingService (P0-4): frozen quote', () => {
  it('quote binds to the immutable version active at quote time; later price change does not affect earlier quote', async () => {
    let current: Version = {
      id: 'v1',
      version: 1,
      credits: 100,
      pricingJson: { providerCostMicrousd: 500_000, estimatedRevenueCents: 990 },
      dimensionsJson: null,
    };
    const h = createHarness(() => current);

    // Job A 在下单时命中 version 1。
    const quoteA = await h.svc.quote(input);
    expect(quoteA.pricingVersionId).toBe('v1');
    expect(quoteA.credits).toBe(100);
    expect(quoteA.estimatedCostMicrousd).toBe(500_000);

    // 管理员改价：发布新 version 2（credits 200, cost 900_000）。
    current = {
      id: 'v2',
      version: 2,
      credits: 200,
      pricingJson: { providerCostMicrousd: 900_000, estimatedRevenueCents: 1990 },
      dimensionsJson: null,
    };

    // Job B 命中新 version 2。
    const quoteB = await h.svc.quote(input);
    expect(quoteB.pricingVersionId).toBe('v2');
    expect(quoteB.credits).toBe(200);
    expect(quoteB.estimatedCostMicrousd).toBe(900_000);

    // Job A 的 quote 仍绑定 v1（历史价格永不漂移）。
    expect(h.insertedQuotes[0].pricingVersionId).toBe('v1');
    expect(h.insertedQuotes[0].estimatedCredits).toBe(100);
    // Job B 绑定 v2。
    expect(h.insertedQuotes[1].pricingVersionId).toBe('v2');
    expect(h.insertedQuotes[1].estimatedCredits).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Dynamic pricing tests
// ---------------------------------------------------------------------------

describe('PricingService: dynamic pricing', () => {
  it('uses dynamic rules when present (video: 10 + 150*2*1.2 = 370)', async () => {
    const version: Version = {
      id: 'v1',
      version: 1,
      credits: 0,
      pricingJson: {
        providerCostMicrousd: 0,
        estimatedRevenueCents: 0,
        rules: {
          baseCredits: 10,
          duration: { pricePerSecond: 15 },
          resolution: { '720p': 1, '1080p': 2, '4k': 5 },
          fps: { '24': 1, '30': 1.2, '60': 2 },
        },
      },
      dimensionsJson: null,
    };
    const h = createHarness(() => version);

    const quote = await h.svc.quote({
      type: 'VIDEO',
      provider: 'agnes',
      model: 'video-1',
      dimensions: { duration: 10, resolution: '1080p', fps: 30 },
    });

    expect(quote.credits).toBe(370);
    expect(quote.pricingVersionId).toBe('v1');
    expect(h.insertedQuotes[0].estimatedCredits).toBe(370);
  });

  it('uses dynamic rules for image (5 * 2 * 2 = 20)', async () => {
    const version: Version = {
      id: 'v2',
      version: 1,
      credits: 0,
      pricingJson: {
        providerCostMicrousd: 0,
        estimatedRevenueCents: 0,
        rules: {
          baseCredits: 5,
          resolution: { '512x512': 1, '1024x1024': 2, '2048x2048': 4 },
          quality: { standard: 1, hd: 2 },
        },
      },
      dimensionsJson: null,
    };
    const h = createHarness(() => version);

    const quote = await h.svc.quote({
      type: 'IMAGE',
      provider: 'agnes',
      model: 'image-1',
      dimensions: { width: 1024, height: 1024, quality: 'hd' },
    });

    expect(quote.credits).toBe(20);
    expect(h.insertedQuotes[0].estimatedCredits).toBe(20);
  });

  it('falls back to fixed credits when no dynamic rules', async () => {
    const version: Version = {
      id: 'v3',
      version: 1,
      credits: 100,
      pricingJson: { providerCostMicrousd: 0, estimatedRevenueCents: 0 },
      dimensionsJson: null,
    };
    const h = createHarness(() => version);

    const quote = await h.svc.quote({
      type: 'VIDEO',
      provider: 'agnes',
      model: 'video-1',
      dimensions: { duration: 10, resolution: '1080p' },
    });

    expect(quote.credits).toBe(100);
  });

  it('throws MISSING_PRICING_DIMENSION when required dimension is missing', async () => {
    const version: Version = {
      id: 'v4',
      version: 1,
      credits: 0,
      pricingJson: {
        providerCostMicrousd: 0,
        estimatedRevenueCents: 0,
        rules: {
          baseCredits: 10,
          duration: { pricePerSecond: 15 },
          resolution: { '720p': 1, '1080p': 2 },
        },
      },
      dimensionsJson: null,
    };
    const h = createHarness(() => version);

    await expect(
      h.svc.quote({
        type: 'VIDEO',
        provider: 'agnes',
        model: 'video-1',
        dimensions: { resolution: '1080p' },
      }),
    ).rejects.toThrow('Video duration is required');
  });
});
