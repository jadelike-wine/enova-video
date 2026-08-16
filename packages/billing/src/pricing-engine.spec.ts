import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES } from '@enova/contracts';
import {
  AGNES_IMAGE_DIMENSIONS,
  AGNES_DEFAULT_RATIO,
  calculateImagePrice,
  calculateVideoPrice,
  extractDynamicRules,
  extractPricingDimensions,
  getAgnesCanonicalResolution,
  reverseLookupAgnesResolution,
  type DynamicPricingRules,
  type VideoPricingInput,
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
// Agnes Image size-based dynamic pricing tests
// ---------------------------------------------------------------------------

describe('Agnes Image size-based pricing', () => {
  const agnesRules: DynamicPricingRules = {
    baseCredits: 5,
    size: {
      '1K': 1,
      '2K': 2,
      '3K': 3,
      '4K': 4,
    },
  };

  it('1K = 5 * 1 = 5 credits', () => {
    const result = calculateImagePrice(agnesRules, { size: '1K' });
    expect(result.credits).toBe(5);
    expect(result.breakdown.sizeMultiplier).toBe(1);
    expect(result.breakdown.sizeKey).toBe('1K');
    expect(result.breakdown.matchedDimension).toBe('size');
    expect(result.breakdown.matchedKey).toBe('1K');
  });

  it('2K = 5 * 2 = 10 credits', () => {
    const result = calculateImagePrice(agnesRules, { size: '2K' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.sizeMultiplier).toBe(2);
  });

  it('3K = 5 * 3 = 15 credits', () => {
    const result = calculateImagePrice(agnesRules, { size: '3K' });
    expect(result.credits).toBe(15);
    expect(result.breakdown.sizeMultiplier).toBe(3);
  });

  it('4K = 5 * 4 = 20 credits', () => {
    const result = calculateImagePrice(agnesRules, { size: '4K' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.sizeMultiplier).toBe(4);
  });

  it('case insensitive: 2k matches 2K', () => {
    const result = calculateImagePrice(agnesRules, { size: '2k' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.sizeKey).toBe('2K');
    expect(result.breakdown.normalizedSize).toBe('2K');
  });

  it('case insensitive: 4k matches 4K', () => {
    const result = calculateImagePrice(agnesRules, { size: '4k' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.sizeKey).toBe('4K');
  });

  it('ratio does not affect price: 2K+16:9 and 2K+9:16 have same credits', () => {
    const r1 = calculateImagePrice(agnesRules, { size: '2K', ratio: '16:9' });
    const r2 = calculateImagePrice(agnesRules, { size: '2K', ratio: '9:16' });
    expect(r1.credits).toBe(r2.credits);
    expect(r1.credits).toBe(10);
  });

  it('ratio produces different canonicalResolution', () => {
    const r1 = calculateImagePrice(agnesRules, { size: '2K', ratio: '16:9' });
    const r2 = calculateImagePrice(agnesRules, { size: '2K', ratio: '9:16' });
    expect(r1.breakdown.canonicalResolution).toBe('2624x1472');
    expect(r2.breakdown.canonicalResolution).toBe('1472x2624');
  });

  it('default ratio is 1:1 when not provided', () => {
    const result = calculateImagePrice(agnesRules, { size: '2K' });
    expect(result.breakdown.requestedRatio).toBeUndefined();
    expect(result.breakdown.normalizedRatio).toBe('1:1');
    expect(result.breakdown.canonicalResolution).toBe('2048x2048');
  });

  it('Agnes does not require quality (no quality rules, no quality input)', () => {
    const result = calculateImagePrice(agnesRules, { size: '2K' });
    expect(result.breakdown.qualityMultiplier).toBe(1);
    expect(result.breakdown.qualityKey).toBeUndefined();
  });

  it('Agnes does not require quality (quality input provided but no quality rules)', () => {
    const result = calculateImagePrice(agnesRules, { size: '2K', quality: 'hd' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.qualityMultiplier).toBe(1);
  });

  it('canonical resolution reverse lookup: 2624x1472 → 2K + 16:9', () => {
    const result = calculateImagePrice(agnesRules, { size: '2624x1472' });
    // size '2624x1472' is not in size rules, but it's a canonical Agnes resolution
    // reverse lookup should find it → 2K
    expect(result.credits).toBe(10);
    expect(result.breakdown.sizeKey).toBe('2K');
    expect(result.breakdown.canonicalResolution).toBe('2624x1472');
  });

  it('canonical resolution reverse lookup via resolution field', () => {
    const result = calculateImagePrice(agnesRules, { resolution: '2624x1472' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.sizeKey).toBe('2K');
    expect(result.breakdown.canonicalResolution).toBe('2624x1472');
  });

  it('canonical resolution reverse lookup via width+height', () => {
    const result = calculateImagePrice(agnesRules, { width: 2624, height: 1472 });
    expect(result.credits).toBe(10);
    expect(result.breakdown.sizeKey).toBe('2K');
  });

  it('throws PRICING_NOT_FOUND for unsupported size (8K)', () => {
    expect(() => calculateImagePrice(agnesRules, { size: '8K' })).toThrow(DomainError);
    try {
      calculateImagePrice(agnesRules, { size: '8K' });
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.PRICING_NOT_FOUND);
      expect((err.details as { dimension: string }).dimension).toBe('size');
    }
  });

  it('throws MISSING_PRICING_DIMENSION when size required but not provided', () => {
    expect(() => calculateImagePrice(agnesRules, {})).toThrow(DomainError);
    try {
      calculateImagePrice(agnesRules, {});
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.MISSING_PRICING_DIMENSION);
      expect((err.details as { dimension: string }).dimension).toBe('size');
    }
  });

  it('audit snapshot has correct fields', () => {
    const result = calculateImagePrice(agnesRules, { size: '2K', ratio: '16:9' });
    const b = result.breakdown;
    expect(b.baseCredits).toBe(5);
    expect(b.requestedSize).toBe('2K');
    expect(b.requestedRatio).toBe('16:9');
    expect(b.normalizedSize).toBe('2K');
    expect(b.normalizedRatio).toBe('16:9');
    expect(b.canonicalResolution).toBe('2624x1472');
    expect(b.sizeMultiplier).toBe(2);
    expect(b.qualityMultiplier).toBe(1);
    expect(b.matchedDimension).toBe('size');
    expect(b.matchedKey).toBe('2K');
    expect(result.credits).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Agnes canonical resolution mapping tests
// ---------------------------------------------------------------------------

describe('AGNES_IMAGE_DIMENSIONS mapping', () => {
  it('has all 4 sizes', () => {
    expect(Object.keys(AGNES_IMAGE_DIMENSIONS)).toEqual(['1K', '2K', '3K', '4K']);
  });

  it('has all 8 ratios per size', () => {
    for (const size of Object.keys(AGNES_IMAGE_DIMENSIONS)) {
      expect(Object.keys(AGNES_IMAGE_DIMENSIONS[size]).length).toBe(8);
    }
  });

  it('1K 1:1 = 1024x1024', () => {
    expect(AGNES_IMAGE_DIMENSIONS['1K']['1:1']).toBe('1024x1024');
  });

  it('2K 16:9 = 2624x1472', () => {
    expect(AGNES_IMAGE_DIMENSIONS['2K']['16:9']).toBe('2624x1472');
  });

  it('4K 21:9 = 6272x2688', () => {
    expect(AGNES_IMAGE_DIMENSIONS['4K']['21:9']).toBe('6272x2688');
  });
});

describe('reverseLookupAgnesResolution', () => {
  it('finds 2624x1472 → 2K + 16:9', () => {
    const result = reverseLookupAgnesResolution('2624x1472');
    expect(result).toEqual({ size: '2K', ratio: '16:9', canonicalResolution: '2624x1472' });
  });

  it('case insensitive: 2624x1472 and 2624X1472 match', () => {
    const result = reverseLookupAgnesResolution('2624X1472');
    expect(result).not.toBeNull();
    expect(result!.size).toBe('2K');
  });

  it('returns null for non-canonical resolution (1920x1080)', () => {
    expect(reverseLookupAgnesResolution('1920x1080')).toBeNull();
  });

  it('returns null for non-canonical resolution (2560x1440)', () => {
    expect(reverseLookupAgnesResolution('2560x1440')).toBeNull();
  });

  it('returns null for non-canonical resolution (1024x768)', () => {
    expect(reverseLookupAgnesResolution('1024x768')).toBeNull();
  });
});

describe('getAgnesCanonicalResolution', () => {
  it('2K + 16:9 → 2624x1472', () => {
    expect(getAgnesCanonicalResolution('2K', '16:9')).toBe('2624x1472');
  });

  it('1K + 1:1 → 1024x1024', () => {
    expect(getAgnesCanonicalResolution('1K', '1:1')).toBe('1024x1024');
  });

  it('returns null for invalid size', () => {
    expect(getAgnesCanonicalResolution('8K', '1:1')).toBeNull();
  });

  it('returns null for invalid ratio', () => {
    expect(getAgnesCanonicalResolution('2K', '5:3')).toBeNull();
  });

  it('default ratio is 1:1', () => {
    expect(AGNES_DEFAULT_RATIO).toBe('1:1');
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: resolution-based pricing still works
// ---------------------------------------------------------------------------

describe('Backward compatibility: resolution-based image pricing', () => {
  const legacyRules: DynamicPricingRules = {
    baseCredits: 5,
    resolution: {
      '1024x1024': 2,
      '1024x*': 1.5,
    },
    quality: {
      standard: 1,
      hd: 2,
    },
  };

  it('exact resolution match still works', () => {
    const result = calculateImagePrice(legacyRules, { resolution: '1024x1024', quality: 'standard' });
    expect(result.credits).toBe(10);
    expect(result.breakdown.matchedDimension).toBe('resolution');
  });

  it('width x height exact match still works', () => {
    const result = calculateImagePrice(legacyRules, { width: 1024, height: 1024, quality: 'hd' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.matchedDimension).toBe('width_height');
  });

  it('wildcard resolution match still works', () => {
    const result = calculateImagePrice(legacyRules, { width: 1024, height: 768 });
    expect(result.credits).toBe(8); // 5 * 1.5 * 1 = 7.5 → ceil = 8
    expect(result.breakdown.resolutionKey).toBe('1024x*');
  });

  it('quality pricing still works for non-Agnes models', () => {
    const result = calculateImagePrice(legacyRules, { resolution: '1024x1024', quality: 'hd' });
    expect(result.credits).toBe(20);
    expect(result.breakdown.qualityMultiplier).toBe(2);
    expect(result.breakdown.qualityKey).toBe('hd');
  });
});

// ---------------------------------------------------------------------------
// Size + resolution coexistence tests
// ---------------------------------------------------------------------------

describe('Size + resolution coexistence', () => {
  it('size rule takes priority over resolution rule when size is provided', () => {
    const rules: DynamicPricingRules = {
      baseCredits: 5,
      size: { '1K': 1, '2K': 2 },
      resolution: { '1024x1024': 3 }, // different multiplier to distinguish
    };
    const result = calculateImagePrice(rules, { size: '2K', resolution: '1024x1024' });
    expect(result.credits).toBe(10); // 5 * 2 = 10, not 5 * 3 = 15
    expect(result.breakdown.matchedDimension).toBe('size');
  });

  it('falls back to resolution when size rule exists but size not provided and resolution is canonical', () => {
    const rules: DynamicPricingRules = {
      baseCredits: 5,
      size: { '2K': 2 },
      resolution: { '1024x1024': 3 },
    };
    // resolution 2624x1472 is canonical for 2K + 16:9, should use size rule
    const result = calculateImagePrice(rules, { resolution: '2624x1472' });
    expect(result.credits).toBe(10); // 5 * 2 = 10
    expect(result.breakdown.matchedDimension).toBe('size');
  });

  it('falls back to resolution rule when size rule exists but size not derivable', () => {
    const rules: DynamicPricingRules = {
      baseCredits: 5,
      size: { '2K': 2 },
      resolution: { '1024x1024': 3 },
    };
    // 1024x1024 is NOT a canonical Agnes resolution, so size reverse lookup fails
    // but resolution rule matches
    const result = calculateImagePrice(rules, { resolution: '1024x1024' });
    expect(result.credits).toBe(15); // 5 * 3 = 15
    expect(result.breakdown.matchedDimension).toBe('resolution');
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
// Agnes Video V2.0 pricing tests
// ---------------------------------------------------------------------------

describe('Agnes Video V2.0 pricing', () => {
  // Agnes 推荐定价规则：仅 baseCredits + duration.pricePerSecond
  // 不包含 quality / fps / resolution（因为暂无可靠的 resolution preset mapping）
  const agnesRules: DynamicPricingRules = {
    baseCredits: 0,
    duration: { pricePerSecond: 5 },
  };

  // ---- Duration 精确计算 ----

  it('121 / 24 = 5.0416666667 seconds (not rounded to 5)', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 121,
      frameRate: 24,
    });
    // 0 + (5.0416666667 * 5) = 25.208333... → ceil = 26
    expect(result.credits).toBe(26);
    expect(result.breakdown.duration).toBeCloseTo(5.0416666667, 6);
    expect(result.breakdown.duration).not.toBe(5);
  });

  it('81 / 24 = 3.375 seconds', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 81,
      frameRate: 24,
    });
    // 0 + (3.375 * 5) = 16.875 → ceil = 17
    expect(result.credits).toBe(17);
    expect(result.breakdown.duration).toBeCloseTo(3.375, 3);
  });

  it('241 / 24 = 10.0416666667 seconds', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 241,
      frameRate: 24,
    });
    // 0 + (10.0416666667 * 5) = 50.208333... → ceil = 51
    expect(result.credits).toBe(51);
    expect(result.breakdown.duration).toBeCloseTo(10.0416666667, 6);
  });

  it('441 / 24 = 18.375 seconds', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 441,
      frameRate: 24,
    });
    // 0 + (18.375 * 5) = 91.875 → ceil = 92
    expect(result.credits).toBe(92);
    expect(result.breakdown.duration).toBeCloseTo(18.375, 3);
  });

  it('final Math.ceil only on credits, not on duration', () => {
    // 193 / 24 = 8.0416666667
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 193,
      frameRate: 24,
    });
    // 0 + (8.0416666667 * 5) = 40.208333... → ceil = 41
    expect(result.credits).toBe(41);
    // duration 应保持完整浮点精度
    expect(result.breakdown.duration).toBeCloseTo(8.0416666667, 6);
  });

  // ---- snake_case → canonical input ----

  it('snake_case num_frames/frame_rate via extractPricingDimensions', () => {
    const dims = extractPricingDimensions('VIDEO', {
      num_frames: 121,
      frame_rate: 24,
    });
    const input = dims as VideoPricingInput;
    expect(input.numFrames).toBe(121);
    expect(input.frameRate).toBe(24);
    expect(input.fps).toBe(24); // frame_rate → fps 自动映射
  });

  it('camelCase numFrames/frameRate still works via extractPricingDimensions', () => {
    const dims = extractPricingDimensions('VIDEO', {
      numFrames: 121,
      frameRate: 24,
    });
    const input = dims as VideoPricingInput;
    expect(input.numFrames).toBe(121);
    expect(input.frameRate).toBe(24);
    expect(input.fps).toBe(24);
  });

  it('width/height extracted via extractPricingDimensions', () => {
    const dims = extractPricingDimensions('VIDEO', {
      num_frames: 121,
      frame_rate: 24,
      width: 1152,
      height: 768,
    });
    const input = dims as VideoPricingInput;
    expect(input.width).toBe(1152);
    expect(input.height).toBe(768);
  });

  // ---- Agnes 不传 quality ----

  it('Agnes without quality does not fail, multiplier = 1', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 121,
      frameRate: 24,
    });
    expect(result.breakdown.qualityMultiplier).toBe(1);
    expect(result.breakdown.qualityKey).toBeUndefined();
  });

  // ---- Agnes 不配置 fps pricing ----

  it('Agnes without fps rules: 24/30/60 do not get extra fps charge', () => {
    const r24 = calculateVideoPrice(agnesRules, { numFrames: 121, frameRate: 24 });
    const r30 = calculateVideoPrice(agnesRules, { numFrames: 121, frameRate: 30 });
    const r60 = calculateVideoPrice(agnesRules, { numFrames: 121, frameRate: 60 });
    // fpsMultiplier should be 1 for all
    expect(r24.breakdown.fpsMultiplier).toBe(1);
    expect(r30.breakdown.fpsMultiplier).toBe(1);
    expect(r60.breakdown.fpsMultiplier).toBe(1);
    // duration naturally changes with frameRate
    // 121/24 = 5.04, 121/30 = 4.03, 121/60 = 2.02
    expect(r24.breakdown.duration).toBeCloseTo(5.0417, 3);
    expect(r30.breakdown.duration).toBeCloseTo(4.0333, 3);
    expect(r60.breakdown.duration).toBeCloseTo(2.0167, 3);
    // credits should differ because duration differs
    expect(r24.credits).not.toBe(r30.credits);
    expect(r30.credits).not.toBe(r60.credits);
  });

  // ---- Agnes with resolution rules (480p) ----

  it('Agnes with resolution rules supports 480p', () => {
    const rulesWithResolution: DynamicPricingRules = {
      baseCredits: 0,
      duration: { pricePerSecond: 5 },
      resolution: { '480p': 1, '720p': 1.5, '1080p': 2 },
    };
    const result = calculateVideoPrice(rulesWithResolution, {
      numFrames: 121,
      frameRate: 24,
      resolution: '480p',
    });
    // 0 + (5.0416666667 * 5) * 1 = 25.208333... → ceil = 26
    expect(result.credits).toBe(26);
    expect(result.breakdown.resolutionMultiplier).toBe(1);
    expect(result.breakdown.resolutionKey).toBe('480p');
  });

  it('Agnes with resolution rules: 720p costs more than 480p', () => {
    const rulesWithResolution: DynamicPricingRules = {
      baseCredits: 0,
      duration: { pricePerSecond: 5 },
      resolution: { '480p': 1, '720p': 1.5, '1080p': 2 },
    };
    const r480 = calculateVideoPrice(rulesWithResolution, {
      numFrames: 121,
      frameRate: 24,
      resolution: '480p',
    });
    const r720 = calculateVideoPrice(rulesWithResolution, {
      numFrames: 121,
      frameRate: 24,
      resolution: '720p',
    });
    expect(r720.credits).toBeGreaterThan(r480.credits);
  });

  // ---- Agnes 默认不包含 4k ----

  it('Agnes default pricing presets do not contain 4k', () => {
    // Agnes 推荐定价 JSON 不包含 resolution，这里验证即使有 resolution 也不应包含 4k
    // 该测试验证的是 Agnes 不应默认生成 4k 规则
    const agnesRulesWithResolution: DynamicPricingRules = {
      baseCredits: 0,
      duration: { pricePerSecond: 5 },
      resolution: { '480p': 1, '720p': 1.5, '1080p': 2 },
    };
    expect(agnesRulesWithResolution.resolution).not.toHaveProperty('4k');
    expect(agnesRulesWithResolution.resolution).not.toHaveProperty('4K');
  });

  // ---- 缺少 duration 来源 ----

  it('throws MISSING_PRICING_DIMENSION when no duration source and pricePerSecond is set', () => {
    expect(() =>
      calculateVideoPrice(agnesRules, { width: 1152, height: 768 }),
    ).toThrow(DomainError);
    try {
      calculateVideoPrice(agnesRules, { width: 1152, height: 768 });
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe(ERROR_CODES.MISSING_PRICING_DIMENSION);
      expect((err.details as { dimension: string }).dimension).toBe('duration');
      expect(err.message).toContain('num_frames');
      expect(err.message).toContain('frame_rate');
    }
  });

  it('throws MISSING_PRICING_DIMENSION when only numFrames provided (missing frameRate)', () => {
    expect(() =>
      calculateVideoPrice(agnesRules, { numFrames: 121 }),
    ).toThrow(DomainError);
  });

  it('throws MISSING_PRICING_DIMENSION when only frameRate provided (missing numFrames)', () => {
    expect(() =>
      calculateVideoPrice(agnesRules, { frameRate: 24 }),
    ).toThrow(DomainError);
  });

  // ---- 审计快照 ----

  it('calculation snapshot records requested numFrames/frameRate', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 121,
      frameRate: 24,
      width: 1152,
      height: 768,
    });
    expect(result.breakdown.requestedNumFrames).toBe(121);
    expect(result.breakdown.requestedFrameRate).toBe(24);
    expect(result.breakdown.requestedWidth).toBe(1152);
    expect(result.breakdown.requestedHeight).toBe(768);
  });

  it('calculation snapshot does not include requestedNumFrames when not provided', () => {
    const result = calculateVideoPrice(agnesRules, { duration: 5 });
    expect(result.breakdown.requestedNumFrames).toBeUndefined();
    expect(result.breakdown.requestedFrameRate).toBeUndefined();
  });

  // ---- Agnes 推荐定价公式 ----

  it('Agnes recommended formula: credits = ceil(baseCredits + durationSeconds * pricePerSecond)', () => {
    // baseCredits=0, pricePerSecond=5, 121/24=5.0416666667
    // credits = ceil(0 + 5.0416666667 * 5) = ceil(25.208333...) = 26
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 121,
      frameRate: 24,
    });
    expect(result.credits).toBe(26);
    expect(result.breakdown.baseCredits).toBe(0);
    expect(result.breakdown.pricePerSecond).toBe(5);
    expect(result.breakdown.qualityMultiplier).toBe(1);
    expect(result.breakdown.fpsMultiplier).toBe(1);
    expect(result.breakdown.resolutionMultiplier).toBe(1);
  });

  // ---- explicit duration fallback ----

  it('explicit duration still works as fallback', () => {
    const result = calculateVideoPrice(agnesRules, { duration: 10 });
    // 0 + 10 * 5 = 50
    expect(result.credits).toBe(50);
    expect(result.breakdown.duration).toBe(10);
  });

  // ---- numFrames/frameRate preferred over duration ----

  it('numFrames/frameRate preferred over explicit duration', () => {
    const result = calculateVideoPrice(agnesRules, {
      numFrames: 121,
      frameRate: 24,
      duration: 99, // should be ignored
    });
    // 121/24 = 5.0416666667, not 99
    expect(result.breakdown.duration).toBeCloseTo(5.0416666667, 6);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: legacy video pricing still works
// ---------------------------------------------------------------------------

describe('Backward compatibility: legacy video pricing', () => {
  const legacyRules: DynamicPricingRules = {
    baseCredits: 10,
    duration: { pricePerSecond: 15 },
    resolution: { '720p': 1, '1080p': 2, '4k': 5 },
    quality: { standard: 1, high: 2 },
    fps: { '24': 1, '30': 1.2, '60': 2 },
  };

  it('legacy resolution/quality/fps rules still work', () => {
    const result = calculateVideoPrice(legacyRules, {
      duration: 10,
      resolution: '4k',
      fps: 60,
      quality: 'high',
    });
    // 10 + (10 * 15) * 5 * 2 * 2 = 10 + 3000 = 3010
    expect(result.credits).toBe(3010);
    expect(result.breakdown.resolutionKey).toBe('4k');
    expect(result.breakdown.qualityKey).toBe('high');
    expect(result.breakdown.fpsKey).toBe('60');
  });

  it('legacy explicit duration input works as fallback', () => {
    const result = calculateVideoPrice(legacyRules, {
      duration: 10,
      resolution: '1080p',
      fps: 30,
    });
    // 10 + (10 * 15) * 2 * 1 * 1.2 = 10 + 360 = 370
    expect(result.credits).toBe(370);
  });

  it('legacy wildcard resolution still works for video', () => {
    const rulesWithWildcard: DynamicPricingRules = {
      baseCredits: 5,
      duration: { pricePerSecond: 10 },
      resolution: { '1280x*': 1.5 },
    };
    const result = calculateVideoPrice(rulesWithWildcard, {
      duration: 5,
      resolution: '1280x720',
    });
    // 5 + (5 * 10) * 1.5 = 5 + 75 = 80
    expect(result.credits).toBe(80);
    expect(result.breakdown.resolutionKey).toBe('1280x*');
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
    const input = { width: 1024, height: 1024, quality: 'hd', size: '2K', ratio: '16:9' };
    const dims = extractPricingDimensions('IMAGE', input);
    expect(dims).toEqual({
      size: '2K',
      ratio: '16:9',
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
      width: undefined,
      height: undefined,
    });
  });

  it('extracts video dimensions with snake_case and width/height', () => {
    const input = { num_frames: 121, frame_rate: 24, width: 1152, height: 768 };
    const dims = extractPricingDimensions('VIDEO', input);
    const v = dims as VideoPricingInput;
    expect(v.numFrames).toBe(121);
    expect(v.frameRate).toBe(24);
    expect(v.fps).toBe(24);
    expect(v.width).toBe(1152);
    expect(v.height).toBe(768);
  });

  it('extracts explicit duration', () => {
    const input = { duration: 10, resolution: '1080p' };
    const dims = extractPricingDimensions('VIDEO', input);
    expect((dims as { duration: number }).duration).toBe(10);
  });
});
