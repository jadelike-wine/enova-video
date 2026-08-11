/**
 * Provider 错误分类。
 *
 * 业务层 / Credential Manager 只依赖本分类，禁止直接判断上游原始 status string。
 * 分类决定两件事：
 * - 是否 transient（可重试 / 可切换 credential）
 * - Credential Manager 如何更新该 key 的 health（冷却 / 标记不可用）
 */

export type ProviderErrorCategory =
  | 'AUTH_ERROR' // 401 / 403
  | 'RATE_LIMITED' // 429
  | 'PROVIDER_TEMPORARY_ERROR' // 5xx
  | 'PROVIDER_BAD_REQUEST' // 400 / 其它 4xx（输入本身无效）
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_JOB_FAILED' // 上游明确返回 failed
  | 'NETWORK_ERROR'; // 连接/解析/DNS 失败

/** transient = 允许 BullMQ 重试 / 允许切换 credential。 */
const TRANSIENT: ReadonlySet<ProviderErrorCategory> = new Set([
  'RATE_LIMITED',
  'PROVIDER_TEMPORARY_ERROR',
  'PROVIDER_TIMEOUT',
  'NETWORK_ERROR',
]);

export function isTransientCategory(category: ProviderErrorCategory): boolean {
  return TRANSIENT.has(category);
}

export interface ProviderErrorOptions {
  category: ProviderErrorCategory;
  statusCode?: number;
  /** 上游 Retry-After（毫秒）。仅 429 时有意义。 */
  retryAfterMs?: number;
  /** 是否应标记该 credential 不可用（401/403）。 */
  degradeCredential?: boolean;
  /** 是否应冷却该 credential（429）。 */
  cooldownCredential?: boolean;
  /** 上游错误码（利于日志定位，category 分类在此基础上）。 */
  code?: string;
  cause?: unknown;
}

/**
 * 统一的上游 Provider 错误。所有 Agnes / 未来 Provider 实现都必须抛本错误，
 * 禁止把原始 HTTP 响应 / 完整 secret 放入 message。
 */
export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly degradeCredential: boolean;
  readonly cooldownCredential: boolean;
  readonly code?: string;

  constructor(message: string, opts: ProviderErrorOptions = { category: 'PROVIDER_TEMPORARY_ERROR' }) {
    super(message);
    this.name = 'ProviderError';
    this.category = opts.category;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
    this.degradeCredential = opts.degradeCredential ?? opts.category === 'AUTH_ERROR';
    this.cooldownCredential = opts.cooldownCredential ?? opts.category === 'RATE_LIMITED';
    this.code = opts.code;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  get transient(): boolean {
    return isTransientCategory(this.category);
  }
}

/** 便捷：把任意 HTTP status 归类为 ProviderError。 */
export function providerErrorFromHttpStatus(
  message: string,
  statusCode: number,
  opts: { retryAfterMs?: number; code?: string; cause?: unknown } = {},
): ProviderError {
  let category: ProviderErrorCategory;
  if (statusCode === 401 || statusCode === 403) category = 'AUTH_ERROR';
  else if (statusCode === 429) category = 'RATE_LIMITED';
  else if (statusCode >= 500) category = 'PROVIDER_TEMPORARY_ERROR';
  else if (statusCode >= 400) category = 'PROVIDER_BAD_REQUEST';
  else category = 'PROVIDER_TEMPORARY_ERROR';
  return new ProviderError(message, {
    category,
    statusCode,
    retryAfterMs: category === 'RATE_LIMITED' ? opts.retryAfterMs : undefined,
    code: opts.code,
    cause: opts.cause,
  });
}