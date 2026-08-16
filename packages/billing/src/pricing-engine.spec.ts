import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES } from '@enova/contracts';
import {
  calculateImagePrice,
  calculateVideoPrice,
  extractDynamicRules,
  extractPricingDimensions,
  type DynamicPricingRules,
} from './pricing-engine';

// ---------------------------------------------------------------------------
// Image dynamic pricing tests
// ---------------------------------------------------------------------------

describe('Image dynamic pricing', () => {
  const rules: DynamicPricingRules = {
    baseCredits: 5,
    resolution: {
      '512x512': 1,
      '1024x1024': 2,
      '2048x2048': 4,
    },
    quality: {
      standard: 1,
      hd: 2,
    },
  };

  it('512x512 standard = 5 * 1 * 1 = 5', () => {
    const result = calculateImagePrice(rules, { width: 512, height: 512, quality: 'standard' });
    expect(result.credits).toBe(5);
    expect(result.breakdown.baseCredits).toBe(5);
    expect(result.breakdown.resolutionMultiplier).toBe(1);
    expect(result.breakdown.resolutionKey).toBe('512x512');
    expect(result.breakdown.qualityMultiplier).toBe(1);
    expect(result.breakdown.qualityKey).toBe('standard');
  });

  it('1024x1024 hd = 5 * 2 * 2 = 20', () => {
    const result = calculateImagePrice(rules, { width: 1024, height: 1024, quality: 'hd' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.resolutionMultiplier).toBe(2);
    expect(result.breakdown.qualityMultiplier).toBe(2);
  });

  it('2048x2048 hd = 5 * 4 * 2 = 40', () => {
    const result = calculateImagePrice(rules, { width: 2048, height: 2048, quality: 'hd' });
    expect(result.credits).toBe(40);
  });

  it('prices increase with size: 5 < 20 < 40', () => {
    const small = calculateImagePrice(rules, { width: 512, height: 512, quality: 'hd' });
    const medium = calculateImagePrice(rules, { width: 1024, height: 1024, quality: 'hd' });
    const large = calculateImagePrice(rules, { width: 2048, height: 2048, quality: 'hd' });
    expect(small.credits).toBeLessThan(medium.credits);
    expect(medium.credits).toBeLessThan(large.credits);
  });

  it('uses explicit resolution string when provided', () => {
    const result = calculateImagePrice(rules, { resolution: '1024x1024', quality: 'standard' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.resolutionKey).toBe('1024x1024');
  });

  it('throws MISSING_PRICING_DIMENSION when resolution rules exist but no dimensions provided', () => {
    expect(() => calculateImagePrice(rules, {})).toThrow(DomainError);
    try {
      calculateImagePrice(rules, {});
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.MISSING_PRICING_DIMENSION);
    }
  });

  it('quality is optional (defaults to multiplier 1)', () => {
    const result = calculateImagePrice(rules, { width: 512, height: 512 });
    expect(result.credits).toBe(5);
    expect(result.breakdown.qualityMultiplier).toBe(1);
    expect(result.breakdown.qualityKey).toBeUndefined();
  });

  it('without quality rules, quality input is ignored', () => {
    const rulesNoQuality: DynamicPricingRules = {
      baseCredits: 10,
      resolution: { '512x512': 1, '1024x1024': 2 },
    };
    const result = calculateImagePrice(rulesNoQuality, { width: 1024, height: 1024, quality: 'hd' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.qualityMultiplier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Video dynamic pricing tests
// ---------------------------------------------------------------------------

describe('Video dynamic pricing', () => {
  const rules: DynamicPricingRules = {
    baseCredits: 10,
    duration: { pricePerSecond: 15 },
    resolution: {
      '720p': 1,
      '1080p': 2,
      '4k': 5,
    },
    fps: {
      '24': 1,
      '30': 1.2,
      '60': 2,
    },
  };

  it('5s 720p 24fps = 10 + (5*15)*1*1 = 85', () => {
    const result = calculateVideoPrice(rules, {
      duration: 5,
      resolution: '720p',
      fps: 24,
    });
    expect(result.credits).toBe(85);
    expect(result.breakdown.baseCredits).toBe(10);
    expect(result.breakdown.durationCost).toBe(75);
    expect(result.breakdown.resolutionMultiplier).toBe(1);
    expect(result.breakdown.fpsMultiplier).toBe(1);
  });

  it('10s 1080p 30fps = 10 + (10*15)*2*1.2 = 370', () => {
    const result = calculateVideoPrice(rules, {
      duration: 10,
      resolution: '1080p',
      fps: 30,
    });
    // 10 + 150 * 2 * 1.2 = 10 + 360 = 370
    expect(result.credits).toBe(370);
    expect(result.breakdown.durationCost).toBe(150);
    expect(result.breakdown.resolutionMultiplier).toBe(2);
    expect(result.breakdown.fpsMultiplier).toBe(1.2);
  });

  it('20s 4k 30fps = 10 + (20*15)*5*1.2 = 1810', () => {
    const result = calculateVideoPrice(rules, {
      duration: 20,
      resolution: '4k',
      fps: 30,
    });
    // 10 + 300 * 5 * 1.2 = 10 + 1800 = 1810
    expect(result.credits).toBe(1810);
  });

  it('prices increase: 5s/720p < 10s/1080p < 20s/4k', () => {
    const r1 = calculateVideoPrice(rules, { duration: 5, resolution: '720p', fps: 30 });
    const r2 = calculateVideoPrice(rules, { duration: 10, resolution: '1080p', fps: 30 });
    const r3 = calculateVideoPrice(rules, { duration: 20, resolution: '4k', fps: 30 });
    expect(r1.credits).toBeLessThan(r2.credits);
    expect(r2.credits).toBeLessThan(r3.credits);
  });

  it('derives duration from numFrames + frameRate', () => {
    // 121 frames / 24 fps ≈ 5.04s
    const result = calculateVideoPrice(rules, {
      numFrames: 120,
      frameRate: 24,
      resolution: '720p',
      fps: 24,
    });
    // 10 + (5 * 15) * 1 * 1 = 85
    expect(result.credits).toBe(85);
    expect(result.breakdown.duration).toBeCloseTo(5, 1);
  });

  it('throws MISSING_PRICING_DIMENSION when duration not provided but required', () => {
    expect(() =>
      calculateVideoPrice(rules, { resolution: '720p', fps: 24 }),
    ).toThrow(DomainError);
    try {
      calculateVideoPrice(rules, { resolution: '720p', fps: 24 });
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.MISSING_PRICING_DIMENSION);
      expect((err.details as { dimension: string }).dimension).toBe('duration');
    }
  });

  it('throws MISSING_PRICING_DIMENSION when resolution not provided but required', () => {
    expect(() =>
      calculateVideoPrice(rules, { duration: 10, fps: 30 }),
    ).toThrow(DomainError);
    try {
      calculateVideoPrice(rules, { duration: 10, fps: 30 });
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.MISSING_PRICING_DIMENSION);
      expect((err.details as { dimension: string }).dimension).toBe('resolution');
    }
  });

  it('fps is optional (defaults to multiplier 1)', () => {
    const result = calculateVideoPrice(rules, {
      duration: 10,
      resolution: '1080p',
    });
    // 10 + 150 * 2 = 310
    expect(result.credits).toBe(310);
    expect(result.breakdown.fpsMultiplier).toBe(1);
  });

  it('with quality multiplier', () => {
    const rulesWithQuality: DynamicPricingRules = {
      ...rules,
      quality: { standard: 1, high: 2 },
    };
    const result = calculateVideoPrice(rulesWithQuality, {
      duration: 10,
      resolution: '1080p',
      fps: 30,
      quality: 'high',
    });
    // 10 + 150 * 2 * 2 * 1.2 = 10 + 720 = 730
    expect(result.credits).toBe(730);
    expect(result.breakdown.qualityMultiplier).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractDynamicRules tests
// ---------------------------------------------------------------------------

describe('extractDynamicRules', () => {
  it('extracts rules from pricingJson.rules', () => {
    const pricingJson = {
      rules: {
        baseCredits: 10,
        duration: { pricePerSecond: 15 },
      },
    };
    const rules = extractDynamicRules(pricingJson, null);
    expect(rules).not.toBeNull();
    expect(rules!.baseCredits).toBe(10);
    expect(rules!.duration?.pricePerSecond).toBe(15);
  });

  it('returns null when no dynamic rules present', () => {
    const pricingJson = {
      providerCostMicrousd: 500_000,
      estimatedRevenueCents: 990,
    };
    const rules = extractDynamicRules(pricingJson, null);
    expect(rules).toBeNull();
  });

  it('handles null inputs', () => {
    expect(extractDynamicRules(null, null)).toBeNull();
  });

  it('extracts from pricingJson directly if it has rules shape', () => {
    const pricingJson = {
      baseCredits: 5,
      resolution: { '512x512': 1 },
    };
    const rules = extractDynamicRules(pricingJson, null);
    expect(rules).not.toBeNull();
    expect(rules!.baseCredits).toBe(5);
    expect(rules!.resolution?.['512x512']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractPricingDimensions tests
// ---------------------------------------------------------------------------

describe('extractPricingDimensions', () => {
  it('extracts image dimensions', () => {
    const input = { width: 1024, height: 1024, quality: 'hd' };
    const dims = extractPricingDimensions('IMAGE', input);
    expect(dims).toEqual({
      width: 1024,
      height: 1024,
      resolution: undefined,
      quality: 'hd',
    });
  });

  it('extracts video dimensions', () => {
    const input = { numFrames: 120, frameRate: 24, resolution: '720p', quality: 'high' };
    const dims = extractPricingDimensions('VIDEO', input);
    expect(dims).toEqual({
      duration: undefined,
      numFrames: 120,
      frameRate: 24,
      resolution: '720p',
      fps: 24,
      quality: 'high',
    });
  });

  it('extracts explicit duration', () => {
    const input = { duration: 10, resolution: '1080p' };
    const dims = extractPricingDimensions('VIDEO', input);
    expect((dims as { duration: number }).duration).toBe(10);
  });
});
