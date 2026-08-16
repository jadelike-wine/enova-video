/**
 * 动态定价计算引擎。
 *
 * 领域规则：
 * - 纯函数，无 NestJS / DB 依赖，可被 API 和 Worker 复用。
 * - 规则优先级：dynamic pricing rules > fixed credits pricing > no pricing error。
 * - 计算过程生成 CalculationBreakdown，写入 price_quotes.calculation_snapshot 供审计。
 *
 * 图片公式：
 *   credits = baseCredits * resolutionMultiplier * qualityMultiplier
 *
 * 视频公式：
 *   credits = baseCredits + (duration * pricePerSecond) * resolutionMultiplier * qualityMultiplier * fpsMultiplier
 *
 * 所有乘数缺失时默认为 1；baseCredits 缺失时默认为 0。
 */

import { domainError, ERROR_CODES } from '@enova/contracts';
import { resolveVideoDurationFromInput } from '@enova/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 动态定价规则 JSON 结构（存储在 pricing_versions.dimensions_json 或 pricing_json.rules 中）。 */
export interface DynamicPricingRules {
  /** 基础 Credits。 */
  baseCredits: number;
  /** 视频时长定价：每秒 Credits。 */
  duration?: {
    pricePerSecond: number;
  };
  /** 分辨率倍率表。key = 分辨率标识（如 "720p", "1080p", "4k", "512x512"）。 */
  resolution?: Record<string, number>;
  /** 质量倍率表。key = 质量标识（如 "standard", "high", "hd"）。 */
  quality?: Record<string, number>;
  /** FPS 倍率表。key = FPS 值的字符串形式（如 "24", "30", "60"）。 */
  fps?: Record<string, number>;
}

/** 计算结果 + 审计快照。 */
export interface PricingCalculationResult {
  /** 最终 Credits（整数，向上取整保证不亏本）。 */
  credits: number;
  /** 审计快照：每一步的计算明细。 */
  breakdown: CalculationBreakdown;
}

/** 审计快照：每一步的计算明细。 */
export interface CalculationBreakdown {
  /** 基础 Credits。 */
  baseCredits: number;
  /** 视频时长费用（duration * pricePerSecond）。 */
  durationCost?: number;
  /** 使用的时长值（秒）。 */
  duration?: number;
  /** 每秒单价。 */
  pricePerSecond?: number;
  /** 分辨率倍率。 */
  resolutionMultiplier?: number;
  /** 匹配的分辨率 key。 */
  resolutionKey?: string;
  /** 质量倍率。 */
  qualityMultiplier?: number;
  /** 匹配的质量 key。 */
  qualityKey?: string;
  /** FPS 倍率。 */
  fpsMultiplier?: number;
  /** 匹配的 FPS key。 */
  fpsKey?: string;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从 pricing_version 的 JSON 列中提取动态定价规则。
 *
 * 查找顺序：
 * 1. pricingJson.rules（推荐存储位置）
 * 2. dimensionsJson.rules（兼容旧格式）
 * 3. pricingJson 本身（如果直接就是 rules 格式）
 *
 * 返回 null 表示没有动态规则，应回退到固定 credits。
 */
export function extractDynamicRules(
  pricingJson: Record<string, unknown> | null,
  dimensionsJson: Record<string, unknown> | null,
): DynamicPricingRules | null {
  // 尝试 pricingJson.rules
  const fromPricingJson = tryExtractRules(pricingJson);
  if (fromPricingJson) return fromPricingJson;

  // 尝试 dimensionsJson.rules
  const fromDimensionsJson = tryExtractRules(dimensionsJson);
  if (fromDimensionsJson) return fromDimensionsJson;

  // 尝试 pricingJson 本身是否就是 rules 格式
  if (pricingJson && hasRulesShape(pricingJson)) {
    return normalizeRules(pricingJson as unknown as DynamicPricingRules);
  }

  return null;
}

function tryExtractRules(json: Record<string, unknown> | null): DynamicPricingRules | null {
  if (!json) return null;
  const rules = json.rules;
  if (rules && typeof rules === 'object' && hasRulesShape(rules as Record<string, unknown>)) {
    return normalizeRules(rules as unknown as DynamicPricingRules);
  }
  return null;
}

function hasRulesShape(obj: Record<string, unknown>): boolean {
  // 至少要有 baseCredits 字段才认为是动态规则
  return 'baseCredits' in obj || 'base_credits' in obj;
}

function normalizeRules(raw: DynamicPricingRules | Record<string, unknown>): DynamicPricingRules {
  const r = raw as Record<string, unknown>;
  const baseCredits = Number(r.baseCredits ?? r.base_credits ?? 0);
  const rules: DynamicPricingRules = {
    baseCredits: Number.isFinite(baseCredits) ? baseCredits : 0,
  };
  if (r.duration && typeof r.duration === 'object') {
    const d = r.duration as Record<string, unknown>;
    const pps = Number(d.pricePerSecond ?? d.price_per_second ?? 0);
    if (Number.isFinite(pps) && pps > 0) {
      rules.duration = { pricePerSecond: pps };
    }
  }
  if (r.resolution && typeof r.resolution === 'object') {
    rules.resolution = normalizeMultiplierMap(r.resolution as Record<string, unknown>);
  }
  if (r.quality && typeof r.quality === 'object') {
    rules.quality = normalizeMultiplierMap(r.quality as Record<string, unknown>);
  }
  if (r.fps && typeof r.fps === 'object') {
    rules.fps = normalizeMultiplierMap(r.fps as Record<string, unknown>);
  }
  return rules;
}

function normalizeMultiplierMap(raw: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      result[key] = num;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 图片定价计算
// ---------------------------------------------------------------------------

export interface ImagePricingInput {
  width?: number;
  height?: number;
  /** 分辨率标识（如 "512x512"），优先使用；否则从 width/height 推导。 */
  resolution?: string;
  /** 质量标识（如 "standard", "hd", "high"）。 */
  quality?: string;
}

/**
 * 计算图片动态价格。
 *
 * 公式：credits = ceil(baseCredits * resolutionMultiplier * qualityMultiplier)
 *
 * 分辨率匹配优先级：
 * 1. 显式 resolution 参数
 * 2. `${width}x${height}` 组合
 * 3. 通配匹配（如 "1024x*" 或 "*x1024"）
 */
export function calculateImagePrice(
  rules: DynamicPricingRules,
  input: ImagePricingInput,
): PricingCalculationResult {
  const baseCredits = rules.baseCredits ?? 0;

  // ---- Resolution multiplier ----
  let resolutionKey: string | undefined;
  let resolutionMultiplier = 1;

  if (rules.resolution) {
    // 优先使用显式 resolution 参数
    if (input.resolution) {
      const match = lookupMultiplier(rules.resolution, input.resolution);
      if (match !== null) {
        resolutionKey = input.resolution;
        resolutionMultiplier = match;
      }
    }

    // 其次从 width x height 推导
    if (!resolutionKey && input.width != null && input.height != null) {
      const dimensionKey = `${input.width}x${input.height}`;
      const exactMatch = lookupMultiplier(rules.resolution, dimensionKey);
      if (exactMatch !== null) {
        resolutionKey = dimensionKey;
        resolutionMultiplier = exactMatch;
      } else {
        // 尝试通配匹配
        const wildcardMatch = lookupWildcardMatch(rules.resolution, input.width, input.height);
        if (wildcardMatch) {
          resolutionKey = wildcardMatch.key;
          resolutionMultiplier = wildcardMatch.multiplier;
        }
      }
    }

    // 如果规则有 resolution 但无法匹配，且请求也包含尺寸参数 → 报错
    if (!resolutionKey && (input.resolution || (input.width != null && input.height != null))) {
      throw domainError(
        ERROR_CODES.PRICING_NOT_FOUND,
        `No resolution pricing rule found for ${input.resolution ?? `${input.width}x${input.height}`}`,
        422,
        { dimension: 'resolution', value: input.resolution ?? `${input.width}x${input.height}` },
      );
    }

    // 如果规则有 resolution 表但请求未传任何尺寸参数 → 缺少参数错误
    if (!resolutionKey && !(input.resolution || (input.width != null && input.height != null))) {
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Image resolution is required for pricing calculation. Provide width+height or resolution.',
        422,
        { dimension: 'resolution' },
      );
    }
  }

  // ---- Quality multiplier ----
  let qualityKey: string | undefined;
  let qualityMultiplier = 1;

  if (rules.quality) {
    if (input.quality) {
      const match = lookupMultiplier(rules.quality, input.quality);
      if (match !== null) {
        qualityKey = input.quality;
        qualityMultiplier = match;
      } else {
        throw domainError(
          ERROR_CODES.PRICING_NOT_FOUND,
          `No quality pricing rule found for "${input.quality}"`,
          422,
          { dimension: 'quality', value: input.quality },
        );
      }
    }
    // 如果有 quality 规则但请求未传 quality，不报错，默认乘数 1
    // （某些场景下 quality 是可选的，不传 = standard）
  }

  // ---- Calculate ----
  const rawCredits = baseCredits * resolutionMultiplier * qualityMultiplier;
  const credits = Math.ceil(rawCredits);

  const breakdown: CalculationBreakdown = {
    baseCredits,
    resolutionMultiplier,
    resolutionKey,
    qualityMultiplier,
    qualityKey,
  };

  return { credits, breakdown };
}

// ---------------------------------------------------------------------------
// 视频定价计算
// ---------------------------------------------------------------------------

export interface VideoPricingInput {
  /** 视频时长（秒）。如果未传，尝试从 numFrames/frameRate 推导。 */
  duration?: number;
  /** 帧数（Agnes 原生参数）。 */
  numFrames?: number;
  /** 帧率（Agnes 原生参数）。 */
  frameRate?: number;
  /** 分辨率标识（如 "720p", "1080p", "4k"）。 */
  resolution?: string;
  /** FPS 值（如 24, 30, 60）。 */
  fps?: number;
  /** 质量标识。 */
  quality?: string;
}

/**
 * 计算视频动态价格。
 *
 * 公式：credits = ceil(baseCredits + (duration * pricePerSecond) * resolutionMultiplier * qualityMultiplier * fpsMultiplier)
 *
 * 参数校验：
 * - 如果规则包含 duration.pricePerSecond，请求必须提供 duration 或 numFrames+frameRate。
 * - 如果规则包含 resolution 表，请求必须提供 resolution 参数。
 * - 如果规则包含 fps 表，请求必须提供 fps 参数。
 * - 如果规则包含 quality 表且请求提供了 quality，则匹配；未提供时默认乘数 1。
 */
export function calculateVideoPrice(
  rules: DynamicPricingRules,
  input: VideoPricingInput,
): PricingCalculationResult {
  const baseCredits = rules.baseCredits ?? 0;

  // ---- Duration ----
  let duration: number | undefined;
  let pricePerSecond: number | undefined;
  let durationCost = 0;

  if (rules.duration?.pricePerSecond) {
    pricePerSecond = rules.duration.pricePerSecond;

    // 优先使用显式 duration
    if (input.duration != null) {
      duration = Number(input.duration);
    } else if (input.numFrames != null && input.frameRate != null) {
      // 从 numFrames + frameRate 推导
      const derived = resolveVideoDurationFromInput({
        numFrames: input.numFrames,
        frameRate: input.frameRate,
      });
      if (derived !== null) duration = derived;
    }

    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Video duration is required for pricing calculation. Provide duration or numFrames+frameRate.',
        422,
        { dimension: 'duration' },
      );
    }

    durationCost = duration * pricePerSecond;
  }

  // ---- Resolution multiplier ----
  let resolutionKey: string | undefined;
  let resolutionMultiplier = 1;

  if (rules.resolution) {
    if (input.resolution) {
      const match = lookupMultiplier(rules.resolution, input.resolution);
      if (match !== null) {
        resolutionKey = input.resolution;
        resolutionMultiplier = match;
      } else {
        throw domainError(
          ERROR_CODES.PRICING_NOT_FOUND,
          `No resolution pricing rule found for "${input.resolution}"`,
          422,
          { dimension: 'resolution', value: input.resolution },
        );
      }
    } else {
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Video resolution is required for pricing calculation.',
        422,
        { dimension: 'resolution' },
      );
    }
  }

  // ---- FPS multiplier ----
  let fpsKey: string | undefined;
  let fpsMultiplier = 1;

  if (rules.fps) {
    if (input.fps != null) {
      const fpsStr = String(input.fps);
      const match = lookupMultiplier(rules.fps, fpsStr);
      if (match !== null) {
        fpsKey = fpsStr;
        fpsMultiplier = match;
      } else {
        throw domainError(
          ERROR_CODES.PRICING_NOT_FOUND,
          `No FPS pricing rule found for "${fpsStr}"`,
          422,
          { dimension: 'fps', value: fpsStr },
        );
      }
    }
    // 如果有 fps 规则但请求未传 fps，不报错，默认乘数 1
    // （某些 provider 默认帧率不额外收费）
  }

  // ---- Quality multiplier ----
  let qualityKey: string | undefined;
  let qualityMultiplier = 1;

  if (rules.quality) {
    if (input.quality) {
      const match = lookupMultiplier(rules.quality, input.quality);
      if (match !== null) {
        qualityKey = input.quality;
        qualityMultiplier = match;
      } else {
        throw domainError(
          ERROR_CODES.PRICING_NOT_FOUND,
          `No quality pricing rule found for "${input.quality}"`,
          422,
          { dimension: 'quality', value: input.quality },
        );
      }
    }
  }

  // ---- Calculate ----
  const rawCredits = baseCredits + durationCost * resolutionMultiplier * qualityMultiplier * fpsMultiplier;
  const credits = Math.ceil(rawCredits);

  const breakdown: CalculationBreakdown = {
    baseCredits,
    durationCost: Number.isFinite(durationCost) ? durationCost : undefined,
    duration,
    pricePerSecond,
    resolutionMultiplier,
    resolutionKey,
    qualityMultiplier,
    qualityKey,
    fpsMultiplier,
    fpsKey,
  };

  return { credits, breakdown };
}

// ---------------------------------------------------------------------------
// 通用辅助
// ---------------------------------------------------------------------------

/**
 * 从倍率表中查找匹配的乘数。
 * 支持 case-insensitive 匹配。
 */
function lookupMultiplier(map: Record<string, number>, key: string): number | null {
  // 精确匹配
  if (key in map) return map[key];
  // Case-insensitive 匹配
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lowerKey) return v;
  }
  return null;
}

/**
 * 通配匹配分辨率表。
 * 支持类似 "1024x*" 或 "*x1024" 的通配 key。
 */
function lookupWildcardMatch(
  map: Record<string, number>,
  width: number,
  height: number,
): { key: string; multiplier: number } | null {
  for (const [key, multiplier] of Object.entries(map)) {
    if (key.includes('*')) {
      const parts = key.split('x');
      if (parts.length === 2) {
        const wMatch = parts[0] === '*' || Number(parts[0]) === width;
        const hMatch = parts[1] === '*' || Number(parts[1]) === height;
        if (wMatch && hMatch) {
          return { key, multiplier };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主入口：根据 GenerationType 分派
// ---------------------------------------------------------------------------

/**
 * 从 input dimensions 中提取定价参数。
 * 兼容前端传入的各种字段名。
 */
export function extractPricingDimensions(
  type: string,
  dimensions: Record<string, unknown>,
): ImagePricingInput | VideoPricingInput {
  if (type === 'IMAGE') {
    return {
      width: extractNumber(dimensions.width),
      height: extractNumber(dimensions.height),
      resolution: extractString(dimensions.resolution),
      quality: extractString(dimensions.quality),
    };
  }

  if (type === 'VIDEO') {
    return {
      duration: extractNumber(dimensions.duration),
      numFrames: extractNumber(dimensions.numFrames),
      frameRate: extractNumber(dimensions.frameRate),
      resolution: extractString(dimensions.resolution),
      fps: extractNumber(dimensions.fps) ?? extractNumber(dimensions.frameRate),
      quality: extractString(dimensions.quality),
    };
  }

  // 其他类型暂不支持动态定价
  return {};
}

function extractNumber(val: unknown): number | undefined {
  if (val == null) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function extractString(val: unknown): string | undefined {
  if (val == null) return undefined;
  const s = String(val).trim();
  return s.length > 0 ? s : undefined;
}
