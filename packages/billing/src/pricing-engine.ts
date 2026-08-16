/**
 * 动态定价计算引擎。
 *
 * 领域规则：
 * - 纯函数，无 NestJS / DB 依赖，可被 API 和 Worker 复用。
 * - 规则优先级：dynamic pricing rules > fixed credits pricing > no pricing error。
 * - 计算过程生成 CalculationBreakdown，写入 price_quotes.calculation_snapshot 供审计。
 *
 * 图片公式（统一）：
 *   credits = ceil(baseCredits * dimensionMultiplier * qualityMultiplier)
 *
 *   其中 dimensionMultiplier 按以下优先级取值：
 *   1. size rule → sizeMultiplier（Agnes 原生 1K/2K/3K/4K）
 *   2. resolution rule → resolutionMultiplier（历史精确尺寸）
 *   3. width × height → resolutionMultiplier（含通配匹配）
 *
 *   Agnes 不使用 quality 参数，qualityMultiplier 默认为 1。
 *
 * 视频公式：
 *   credits = baseCredits + (duration * pricePerSecond) * resolutionMultiplier * qualityMultiplier * fpsMultiplier
 *
 * 所有乘数缺失时默认为 1；baseCredits 缺失时默认为 0。
 */

import { domainError, ERROR_CODES } from '@enova/contracts';
import { resolveVideoDurationFromInput } from '@enova/contracts';

// ---------------------------------------------------------------------------
// Agnes Image canonical resolution mapping
// ---------------------------------------------------------------------------

/**
 * Agnes Image 2.1 Flash 原生输出尺寸映射表。
 *
 * 集中维护 size × ratio → canonical resolution 的映射，避免数字散落在业务代码中。
 * 与协议文档 `agnes-image-2.1-flash.md` 的「输出尺寸参考」表完全一致。
 *
 * 用途：
 * - 审计快照中的 canonicalResolution 字段
 * - 从精确分辨率反向识别 size + ratio
 * - 显示和规格校验
 */
export const AGNES_IMAGE_DIMENSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:4': '864x1152',
    '4:3': '1152x864',
    '16:9': '1312x736',
    '9:16': '736x1312',
    '2:3': '832x1248',
    '3:2': '1248x832',
    '21:9': '1568x672',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '4:3': '2304x1728',
    '16:9': '2624x1472',
    '9:16': '1472x2624',
    '2:3': '1664x2496',
    '3:2': '2496x1664',
    '21:9': '3136x1344',
  },
  '3K': {
    '1:1': '3072x3072',
    '3:4': '2592x3456',
    '4:3': '3456x2592',
    '16:9': '3936x2208',
    '9:16': '2208x3936',
    '2:3': '2496x3744',
    '3:2': '3744x2496',
    '21:9': '4704x2016',
  },
  '4K': {
    '1:1': '4096x4096',
    '3:4': '3456x4608',
    '4:3': '4608x3456',
    '16:9': '5248x2944',
    '9:16': '2944x5248',
    '2:3': '3328x4992',
    '3:2': '4992x3328',
    '21:9': '6272x2688',
  },
};

/** Agnes 支持的 size 档位列表。 */
export const AGNES_IMAGE_SIZES = Object.keys(AGNES_IMAGE_DIMENSIONS); // ['1K', '2K', '3K', '4K']

/** Agnes 支持的 ratio 列表。 */
export const AGNES_IMAGE_RATIOS = Object.keys(AGNES_IMAGE_DIMENSIONS['1K']); // ['1:1', '3:4', ...]

/** Agnes ratio 默认值。 */
export const AGNES_DEFAULT_RATIO = '1:1';

/**
 * 从精确分辨率（如 "2624x1472"）反向识别 Agnes canonical size + ratio。
 *
 * 仅匹配 AGNES_IMAGE_DIMENSIONS 中登记的原生尺寸。
 * 非原生尺寸（如 1920x1080、2560x1440）返回 null，不猜测 Agnes 的服务端映射。
 */
export function reverseLookupAgnesResolution(
  resolution: string,
): { size: string; ratio: string; canonicalResolution: string } | null {
  const normalized = resolution.toLowerCase().replace(/\s/g, '');
  for (const [size, ratioMap] of Object.entries(AGNES_IMAGE_DIMENSIONS)) {
    for (const [ratio, canonical] of Object.entries(ratioMap)) {
      if (canonical.toLowerCase() === normalized) {
        return { size, ratio, canonicalResolution: canonical };
      }
    }
  }
  return null;
}

/**
 * 获取 Agnes canonical resolution（用于审计快照）。
 * 如果 size + ratio 组合不在映射表中，返回 null。
 */
export function getAgnesCanonicalResolution(size: string, ratio: string): string | null {
  const ratioMap = AGNES_IMAGE_DIMENSIONS[size];
  if (!ratioMap) return null;
  // 大小写不敏感匹配 ratio
  for (const [r, canonical] of Object.entries(ratioMap)) {
    if (r.toLowerCase() === ratio.toLowerCase()) return canonical;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Video resolution tier normalization
// ---------------------------------------------------------------------------

/**
 * Agnes Video V2.0 标准分辨率档位。
 *
 * 模型支持三个标准档位：480p、720p、1080p（见 agnes-video-v2.0.md）。
 * 这些档位以「最大边」为基准，不区分横屏和竖屏：
 *   - 1280x720（横屏）和 720x1280（竖屏）都是 720p。
 *
 * 阈值以 max(width, height) 为准，与 Agnes 服务端 size_mapping 的 resolution 字段一致。
 */
export interface VideoResolutionTier {
  /** 档位标识，如 "480p"、"720p"、"1080p"。 */
  tier: string;
  /** 最大边（像素）的上限（含）。 */
  maxDimension: number;
}

/**
 * Agnes Video V2.0 分辨率档位表。
 *
 * 使用 max(width, height) 作为匹配维度，覆盖横屏和竖屏。
 * 阈值参考 Agnes 服务端映射逻辑和通用视频分辨率标准：
 *   - 480p: max ≤ 854（如 854x480、640x480）
 *   - 720p: max ≤ 1280（如 1280x720、720x1280）
 *   - 1080p: max ≤ 1920（如 1920x1080、1080x1920）
 */
export const VIDEO_RESOLUTION_TIERS: readonly VideoResolutionTier[] = [
  { tier: '480p', maxDimension: 854 },
  { tier: '720p', maxDimension: 1280 },
  { tier: '1080p', maxDimension: 1920 },
];

/**
 * 将视频 width/height 归一化为分辨率档位标识（如 "720p"）。
 *
 * 使用 max(width, height) 作为匹配维度，同时支持横屏和竖屏：
 *   - 1280x720 → "720p"
 *   - 720x1280 → "720p"
 *   - 1920x1080 → "1080p"
 *   - 1080x1920 → "1080p"
 *   - 854x480 → "480p"
 *
 * 超出所有已知档位时返回 `${width}x${height}`（保留原始精确尺寸，不猜测 tier）。
 *
 * @param width 视频宽度（像素）
 * @param height 视频高度（像素）
 * @returns 归一化后的分辨率标识
 */
export function normalizeVideoResolutionTier(width: number, height: number): string {
  const maxDimension = Math.max(width, height);
  for (const { tier, maxDimension: maxDim } of VIDEO_RESOLUTION_TIERS) {
    if (maxDimension <= maxDim) {
      return tier;
    }
  }
  // 超出所有已知档位，返回精确尺寸（可能匹配 resolution rule 中的精确 key 或通配 key）
  return `${width}x${height}`;
}

/**
 * 尝试从分辨率字符串（如 "1280x720"）解析出 width/height。
 * 仅匹配 "WxH" 格式（大小写不敏感），其他格式返回 null。
 */
function parseResolutionString(resolution: string): { width: number; height: number } | null {
  const parts = resolution.toLowerCase().split('x');
  if (parts.length !== 2) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { width: w, height: h };
}

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
  /**
   * Agnes 图片尺寸档位倍率表。key = 尺寸档位（如 "1K", "2K", "3K", "4K"）。
   * 这是 Agnes Image 2.1 Flash 的首选定价维度。
   * 同一 size 档位下不同 ratio 使用相同倍率。
   */
  size?: Record<string, number>;
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

  // ---- Agnes size 维度（首选） ----
  /** Agnes size 倍率。 */
  sizeMultiplier?: number;
  /** 匹配的 size key。 */
  sizeKey?: string;
  /** 请求中的原始 size 值。 */
  requestedSize?: string;
  /** 请求中的原始 ratio 值。 */
  requestedRatio?: string;
  /** 规范化后的 size（大写形式）。 */
  normalizedSize?: string;
  /** 规范化后的 ratio。 */
  normalizedRatio?: string;
  /** Agnes canonical resolution（如 "2624x1472"），从 size + ratio 推导。 */
  canonicalResolution?: string;

  // ---- resolution 维度（向后兼容） ----
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

  // ---- 视频审计：原始请求参数 ----
  /** 请求的 numFrames（Agnes 原生参数）。 */
  requestedNumFrames?: number;
  /** 请求的 frameRate（Agnes 原生参数）。 */
  requestedFrameRate?: number;
  /** 请求的视频宽度。 */
  requestedWidth?: number;
  /** 请求的视频高度。 */
  requestedHeight?: number;

  // ---- 审计：匹配方式 ----
  /** 标识该笔报价通过哪种维度规则完成匹配：'size' | 'resolution' | 'width_height'。 */
  matchedDimension?: 'size' | 'resolution' | 'width_height';
  /** 匹配到的规则 key。 */
  matchedKey?: string;
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
  if (r.size && typeof r.size === 'object') {
    rules.size = normalizeMultiplierMap(r.size as Record<string, unknown>);
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
  /**
   * Agnes 尺寸档位（如 "1K", "2K", "3K", "4K"）。
   * 这是 Agnes Image 2.1 Flash 的首选定价参数。
   * 大小写不敏感：2k 与 2K 均可匹配。
   */
  size?: string;
  /**
   * Agnes 宽高比（如 "1:1", "16:9", "9:16"）。
   * 不作为价格倍率，仅用于审计和 canonical resolution 推导。
   * 未传时默认 "1:1"。
   */
  ratio?: string;
  /** 分辨率标识（如 "512x512"），向后兼容。 */
  resolution?: string;
  /** 图片宽度（像素），向后兼容。 */
  width?: number;
  /** 图片高度（像素），向后兼容。 */
  height?: number;
  /** 质量标识（如 "standard", "hd", "high"）。Agnes 不使用此参数。 */
  quality?: string;
}

/**
 * 计算图片动态价格。
 *
 * 统一公式：credits = ceil(baseCredits * dimensionMultiplier * qualityMultiplier)
 *
 * 尺寸倍率匹配优先级：
 * 1. size rule → input.size（Agnes 原生档位 1K/2K/3K/4K）
 *    - 同时支持从 canonical resolution 反向识别 size
 * 2. resolution rule → input.resolution（历史精确尺寸标识）
 * 3. resolution rule → input.width × input.height（含通配匹配）
 *
 * 如果规则配置了 size 表但请求未提供 size 且无法从 resolution 反向推导，则报 MISSING_PRICING_DIMENSION。
 * Agnes 不使用 quality 参数；qualityMultiplier 默认为 1，不影响计算。
 */
export function calculateImagePrice(
  rules: DynamicPricingRules,
  input: ImagePricingInput,
): PricingCalculationResult {
  const baseCredits = rules.baseCredits ?? 0;

  // ---- Agnes ratio 规范化（默认 1:1） ----
  const requestedRatio = input.ratio ?? AGNES_DEFAULT_RATIO;

  // 当 input.size 不是直接档位但可能是 canonical resolution 时，
  // 反向识别失败后将其作为 resolution 传递给 resolution rule fallback。
  let effectiveResolution = input.resolution;

  // ---- 尺寸倍率匹配（优先级：size > resolution > width×height） ----
  let sizeMultiplier = 1;
  let sizeKey: string | undefined;
  let normalizedSize: string | undefined;
  let normalizedRatio: string | undefined;
  let canonicalResolution: string | undefined;
  let resolutionMultiplier = 1;
  let resolutionKey: string | undefined;
  let matchedDimension: 'size' | 'resolution' | 'width_height' | undefined;
  let matchedKey: string | undefined;

  // ===== 第一优先级：size rule =====
  if (rules.size) {
    // 尝试直接从 input.size 匹配
    if (input.size) {
      const match = lookupMultiplier(rules.size, input.size);
      if (match !== null) {
        sizeMultiplier = match;
        sizeKey = lookupExactKey(rules.size, input.size);
        normalizedSize = sizeKey;
        normalizedRatio = normalizeRatio(requestedRatio);
        canonicalResolution = getAgnesCanonicalResolution(sizeKey!, normalizedRatio) ?? undefined;
        matchedDimension = 'size';
        matchedKey = sizeKey;
      } else {
        // input.size 不是直接档位，尝试反向识别是否是 Agnes canonical resolution
        const reverse = reverseLookupAgnesResolution(input.size);
        if (reverse) {
          const reverseMatch = lookupMultiplier(rules.size, reverse.size);
          if (reverseMatch !== null) {
            sizeMultiplier = reverseMatch;
            sizeKey = reverse.size;
            normalizedSize = reverse.size;
            normalizedRatio = reverse.ratio;
            canonicalResolution = reverse.canonicalResolution;
            matchedDimension = 'size';
            matchedKey = reverse.size;
          }
        }

        // 反向识别也失败 → 检查是否还有 resolution rule 可作为 fallback
        if (!sizeKey && rules.resolution) {
          // 落入第二/第三优先级处理（把 input.size 当作 resolution 处理）
          if (!effectiveResolution) {
            effectiveResolution = input.size;
          }
        } else if (!sizeKey) {
          // size 提供了但无法匹配规则表，也无法反向识别 → PRICING_NOT_FOUND
          throw domainError(
            ERROR_CODES.PRICING_NOT_FOUND,
            `No size pricing rule found for "${input.size}"`,
            422,
            { dimension: 'size', value: input.size },
          );
        }
      }
    } else {
      // input.size 未提供，尝试从 resolution / width×height 反向识别 Agnes canonical size
      const resolutionToCheck = input.resolution ?? ((input.width != null && input.height != null) ? `${input.width}x${input.height}` : undefined);
      if (resolutionToCheck) {
        const reverse = reverseLookupAgnesResolution(resolutionToCheck);
        if (reverse) {
          // 找到 canonical resolution，用 size 定价
          const match = lookupMultiplier(rules.size, reverse.size);
          if (match !== null) {
            sizeMultiplier = match;
            sizeKey = reverse.size;
            normalizedSize = reverse.size;
            normalizedRatio = reverse.ratio;
            canonicalResolution = reverse.canonicalResolution;
            matchedDimension = 'size';
            matchedKey = reverse.size;
          }
        }
      }

      // 反向识别也失败 → 检查是否还有 resolution rule 可作为 fallback
      if (!sizeKey && rules.resolution) {
        // 落入第二/第三优先级处理
      } else if (!sizeKey) {
        // size rule 存在但无法从任何字段推导出 size
        throw domainError(
          ERROR_CODES.MISSING_PRICING_DIMENSION,
          'Image size is required for pricing calculation. Provide size (e.g. "2K") or a compatible resolution.',
          422,
          { dimension: 'size' },
        );
      }
    }
  }

  // ===== 第二/第三优先级：resolution rule（向后兼容） =====
  // 仅当 size rule 未匹配（或不存在 size rule）时执行
  if (!matchedDimension && rules.resolution) {
    // 如果没有显式 resolution，但请求提供了 size + ratio（Agnes 原生档位），
    // 先将 size + ratio 解析为 canonical resolution，用于匹配 resolution rule。
    // 这解决了 pricing rules 只配置了 resolution 表但请求使用 size+ratio 格式的场景。
    if (!effectiveResolution && input.size) {
      const canonical = getAgnesCanonicalResolution(
        AGNES_IMAGE_SIZES.find((s) => s.toLowerCase() === input.size!.toLowerCase()) ?? input.size,
        requestedRatio,
      );
      if (canonical) {
        effectiveResolution = canonical;
        // 填充审计字段，使 breakdown 记录 canonical resolution 的推导来源
        normalizedSize = AGNES_IMAGE_SIZES.find((s) => s.toLowerCase() === input.size!.toLowerCase());
        normalizedRatio = normalizeRatio(requestedRatio);
        canonicalResolution = canonical;
      }
    }

    // 优先使用显式 resolution 参数（或从 size/ratio fallback 的 effectiveResolution）
    if (effectiveResolution) {
      const match = lookupMultiplier(rules.resolution, effectiveResolution);
      if (match !== null) {
        resolutionMultiplier = match;
        resolutionKey = lookupExactKey(rules.resolution, effectiveResolution);
        matchedDimension = 'resolution';
        matchedKey = resolutionKey;
      }
    }

    // 其次从 width x height 推导
    if (!matchedDimension && input.width != null && input.height != null) {
      const dimensionKey = `${input.width}x${input.height}`;
      const exactMatch = lookupMultiplier(rules.resolution, dimensionKey);
      if (exactMatch !== null) {
        resolutionMultiplier = exactMatch;
        resolutionKey = lookupExactKey(rules.resolution, dimensionKey);
        matchedDimension = 'width_height';
        matchedKey = resolutionKey;
      } else {
        // 尝试通配匹配
        const wildcardMatch = lookupWildcardMatch(rules.resolution, input.width, input.height);
        if (wildcardMatch) {
          resolutionMultiplier = wildcardMatch.multiplier;
          resolutionKey = wildcardMatch.key;
          matchedDimension = 'width_height';
          matchedKey = wildcardMatch.key;
        }
      }
    }

    // 如果 resolution 规则存在但无法匹配，且请求也包含尺寸参数 → 报错
    if (!matchedDimension && (effectiveResolution || (input.width != null && input.height != null))) {
      throw domainError(
        ERROR_CODES.PRICING_NOT_FOUND,
        `No resolution pricing rule found for ${effectiveResolution ?? `${input.width}x${input.height}`}`,
        422,
        { dimension: 'resolution', value: effectiveResolution ?? `${input.width}x${input.height}` },
      );
    }

    // 如果规则有 resolution 表但请求未传任何可识别的尺寸参数 → 缺少参数错误
    if (!matchedDimension && !(effectiveResolution || (input.width != null && input.height != null))) {
      // 如果请求传了 size 但无法解析为 canonical resolution（如不支持的 size/ratio 组合），
      // 给出更明确的错误信息，而不是笼统的“missing resolution”。
      if (input.size) {
        throw domainError(
          ERROR_CODES.PRICING_NOT_FOUND,
          `Unsupported size or ratio: size="${input.size}" ratio="${requestedRatio}". No canonical resolution found for this combination.`,
          422,
          { dimension: 'size', value: input.size, ratio: requestedRatio },
        );
      }
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Image resolution is required for pricing calculation. Provide size+ratio, width+height, or resolution.',
        422,
        { dimension: 'resolution' },
      );
    }
  }

  // ---- Quality multiplier ----
  // Agnes 不使用 quality 参数。如果规则没有 quality 配置，qualityMultiplier 默认 1。
  // 其他支持 quality 的模型仍正常计算。
  let qualityKey: string | undefined;
  let qualityMultiplier = 1;

  if (rules.quality) {
    if (input.quality) {
      const match = lookupMultiplier(rules.quality, input.quality);
      if (match !== null) {
        qualityKey = lookupExactKey(rules.quality, input.quality);
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
  // 统一公式：baseCredits * dimensionMultiplier * qualityMultiplier
  // dimensionMultiplier 取 sizeMultiplier 或 resolutionMultiplier
  const dimensionMultiplier = matchedDimension === 'size' ? sizeMultiplier : resolutionMultiplier;
  const rawCredits = baseCredits * dimensionMultiplier * qualityMultiplier;
  const credits = Math.ceil(rawCredits);

  const breakdown: CalculationBreakdown = {
    baseCredits,
    // size 维度审计字段（仅 size 匹配时填充）
    ...(matchedDimension === 'size' && {
      sizeMultiplier,
      sizeKey,
      requestedSize: input.size,
      requestedRatio: input.ratio,
      normalizedSize,
      normalizedRatio,
      canonicalResolution,
    }),
    // resolution 维度审计字段（仅 resolution/width_height 匹配时填充）
    ...(matchedDimension !== 'size' && {
      resolutionMultiplier,
      resolutionKey,
      // 当通过 size+ratio → canonical resolution 匹配到 resolution rule 时，
      // 也记录 size 相关审计字段，使 breakdown 可追溯 canonical resolution 的推导来源
      ...(input.size && {
        requestedSize: input.size,
        requestedRatio: input.ratio,
        normalizedSize,
        normalizedRatio,
        canonicalResolution,
      }),
    }),
    qualityMultiplier,
    qualityKey,
    matchedDimension,
    matchedKey,
  };

  return { credits, breakdown };
}

// ---------------------------------------------------------------------------
// 视频定价计算
// ---------------------------------------------------------------------------

export interface VideoPricingInput {
  /** 视频时长（秒）。如果未传，尝试从 numFrames/frameRate 推导。 */
  duration?: number;
  /** 帧数（Agnes 原生参数，camelCase）。 */
  numFrames?: number;
  /** 帧率（Agnes 原生参数，camelCase）。 */
  frameRate?: number;
  /** 分辨率标识（如 "720p", "1080p", "4k"）。 */
  resolution?: string;
  /** FPS 值（如 24, 30, 60）。等同于 frameRate，用于 fps 倍率匹配。 */
  fps?: number;
  /** 质量标识。 */
  quality?: string;
  /** 视频宽度（像素）。Agnes Video V2.0 使用 width/height 而非 resolution 参数。 */
  width?: number;
  /** 视频高度（像素）。 */
  height?: number;
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

    // 优先使用 numFrames / frameRate 推导（Agnes 原生参数，精确浮点）
    // 这与 resolveVideoDurationFromInput 的优先级一致
    if (input.numFrames != null && input.frameRate != null) {
      const derived = resolveVideoDurationFromInput({
        numFrames: input.numFrames,
        frameRate: input.frameRate,
      });
      if (derived !== null) duration = derived;
    }

    // Fallback：显式 duration 字段（历史兼容或非 Agnes provider）
    if (duration == null && input.duration != null) {
      duration = Number(input.duration);
    }

    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Video duration is required for per-second pricing: num_frames and frame_rate are required for per-second pricing, or provide an explicit duration.',
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
    // 解析 effective width/height：优先从显式 resolution 字符串提取，其次从 width/height
    let effectiveWidth: number | undefined;
    let effectiveHeight: number | undefined;
    const effectiveResolution: string | undefined = input.resolution;

    if (input.resolution) {
      const parsed = parseResolutionString(input.resolution);
      if (parsed) {
        effectiveWidth = parsed.width;
        effectiveHeight = parsed.height;
      }
    }
    if (effectiveWidth == null) effectiveWidth = input.width;
    if (effectiveHeight == null) effectiveHeight = input.height;

    // 既没有显式 resolution 也没有 width/height → 无法定价
    if (!effectiveResolution && (effectiveWidth == null || effectiveHeight == null)) {
      throw domainError(
        ERROR_CODES.MISSING_PRICING_DIMENSION,
        'Video resolution is required for pricing calculation. Provide resolution or width+height.',
        422,
        { dimension: 'resolution' },
      );
    }

    const resolved = resolveVideoResolutionRule(rules.resolution, effectiveResolution, effectiveWidth, effectiveHeight);
    if (resolved.matched) {
      resolutionKey = resolved.key;
      resolutionMultiplier = resolved.multiplier;
    } else {
      throw domainError(
        ERROR_CODES.PRICING_NOT_FOUND,
        `No resolution pricing rule found for ${resolved.attemptedKey}`,
        422,
        { dimension: 'resolution', value: resolved.attemptedKey },
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
        fpsKey = lookupExactKey(rules.fps, fpsStr);
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
        qualityKey = lookupExactKey(rules.quality, input.quality);
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
    // 视频审计：记录原始请求参数（仅在相关参数存在时填充）
    ...(input.numFrames != null && { requestedNumFrames: input.numFrames }),
    ...(input.frameRate != null && { requestedFrameRate: input.frameRate }),
    ...(input.width != null && { requestedWidth: input.width }),
    ...(input.height != null && { requestedHeight: input.height }),
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
 * 从倍率表中查找匹配的原始 key（大小写不敏感）。
 * 用于审计快照记录实际匹配到的规则 key。
 */
function lookupExactKey(map: Record<string, number>, key: string): string | undefined {
  if (key in map) return key;
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(map)) {
    if (k.toLowerCase() === lowerKey) return k;
  }
  return undefined;
}

/**
 * 规范化 Agnes ratio（保留原始格式，但确保是支持的值）。
 * 不做非法 ratio 的静默转换——非法 ratio 应在请求校验层拒绝。
 */
function normalizeRatio(ratio: string): string {
  // 大小写不敏感匹配支持的 ratio
  const supported = AGNES_IMAGE_RATIOS;
  for (const r of supported) {
    if (r.toLowerCase() === ratio.toLowerCase()) return r;
  }
  // 非法 ratio 原样返回（不静默转换），审计快照会记录原始值
  return ratio;
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

/**
 * 视频分辨率规则解析结果。
 */
type VideoResolutionResolveResult =
  | { matched: true; key: string; multiplier: number; attemptedKey: string }
  | { matched: false; attemptedKey: string };

/**
 * 统一解析视频分辨率定价规则。
 *
 * 按以下优先级匹配 rules.resolution 表：
 * 1. 显式 resolution 参数精确匹配（如 "720p"、"1280x720"）
 * 2. width×height 精确匹配（如 "1280x720"）
 * 3. width×height 通配匹配（如 rules 中有 "1280x*"）
 * 4. width×height 归一化为 tier key 再匹配（如 1280x720 → "720p"）
 *
 * 第 4 步是修复 PRICING_NOT_FOUND 的核心：
 * 后台 pricing 配置使用 tier key（"480p"/"720p"/"1080p"），
 * 但 Agnes Video V2.0 请求使用 width/height（如 1280x720）。
 * 归一化使两者可以匹配。
 *
 * @param resolutionMap rules.resolution 倍率表
 * @param resolution 显式 resolution 参数（可能为 "720p" 或 "1280x720"）
 * @param width 视频宽度（像素）
 * @param height 视频高度（像素）
 */
function resolveVideoResolutionRule(
  resolutionMap: Record<string, number>,
  resolution: string | undefined,
  width: number | undefined,
  height: number | undefined,
): VideoResolutionResolveResult {
  // 1. 显式 resolution 参数精确匹配
  if (resolution) {
    const match = lookupMultiplier(resolutionMap, resolution);
    if (match !== null) {
      return { matched: true, key: lookupExactKey(resolutionMap, resolution) ?? resolution, multiplier: match, attemptedKey: resolution };
    }
  }

  // 2. width×height 精确匹配
  if (width != null && height != null) {
    const dimensionKey = `${width}x${height}`;
    const exactMatch = lookupMultiplier(resolutionMap, dimensionKey);
    if (exactMatch !== null) {
      return { matched: true, key: lookupExactKey(resolutionMap, dimensionKey) ?? dimensionKey, multiplier: exactMatch, attemptedKey: dimensionKey };
    }

    // 3. 通配匹配
    const wildcardMatch = lookupWildcardMatch(resolutionMap, width, height);
    if (wildcardMatch) {
      return { matched: true, key: wildcardMatch.key, multiplier: wildcardMatch.multiplier, attemptedKey: dimensionKey };
    }

    // 4. 归一化为 tier key 再匹配（核心修复）
    const tierKey = normalizeVideoResolutionTier(width, height);
    if (tierKey !== dimensionKey) {
      const tierMatch = lookupMultiplier(resolutionMap, tierKey);
      if (tierMatch !== null) {
        return { matched: true, key: lookupExactKey(resolutionMap, tierKey) ?? tierKey, multiplier: tierMatch, attemptedKey: tierKey };
      }
    }

    return { matched: false, attemptedKey: dimensionKey };
  }

  // 有显式 resolution 但未匹配，且没有 width/height 做归一化
  return { matched: false, attemptedKey: resolution ?? 'unknown' };
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
      size: extractString(dimensions.size),
      ratio: extractString(dimensions.ratio),
      width: extractNumber(dimensions.width),
      height: extractNumber(dimensions.height),
      resolution: extractString(dimensions.resolution),
      quality: extractString(dimensions.quality),
    };
  }

  if (type === 'VIDEO') {
    // 归一化 Agnes snake_case 参数到统一 camelCase pricing input。
    // 事实来源：前端/Agnes adapter 只发送 num_frames/frame_rate/width/height（snake_case）
    // 或 numFrames/frameRate/width/height（camelCase），billing engine 统一接收 camelCase。
    const numFrames = extractNumber(dimensions.numFrames) ?? extractNumber(dimensions.num_frames);
    const frameRate = extractNumber(dimensions.frameRate) ?? extractNumber(dimensions.frame_rate);
    return {
      duration: extractNumber(dimensions.duration),
      numFrames,
      frameRate,
      // fps 等同于 frameRate，用于 fps 倍率表匹配
      fps: extractNumber(dimensions.fps) ?? frameRate,
      resolution: extractString(dimensions.resolution),
      quality: extractString(dimensions.quality),
      width: extractNumber(dimensions.width),
      height: extractNumber(dimensions.height),
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
