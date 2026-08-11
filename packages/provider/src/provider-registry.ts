import { AIProvider } from './ai-provider.interface.js';
import { ProviderError } from './errors.js';
import { AgnesProvider } from './agnes/agnes.provider.js';
import { validateFetchableUrl, type UrlGuardOptions } from './url-guard.js';

/**
 * Provider 注册中心：按 code 解析 Provider 实例。
 * - 配置（base_url / status）来自 DB 的 providers 表（管理员维护），业务层不直接 fetch。
 * - base_url 在创建 Provider 前必须通过 SSRF 校验。
 * - 实例带短 TTL 缓存，配置变更可 invalidate。
 */

export interface ProviderRecord {
  code: string;
  name: string;
  baseUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  config?: Record<string, unknown>;
}

export interface ProviderRegistryOptions {
  /** 从 DB 读取 Provider 配置（Worker 注入）。测试可注入假 loader。 */
  loadProvider: (code: string) => Promise<ProviderRecord | null>;
  guard: UrlGuardOptions;
  timeoutMs: number;
  /** 实例缓存 TTL（毫秒）。 */
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL = 60_000;

export class ProviderRegistry {
  private readonly cache = new Map<string, { provider: AIProvider; expires: number }>();

  constructor(private readonly opts: ProviderRegistryOptions) {}

  async getProvider(code: string): Promise<AIProvider> {
    const cached = this.cache.get(code);
    if (cached && cached.expires > Date.now()) return cached.provider;

    const record = await this.opts.loadProvider(code);
    if (!record) {
      throw new ProviderError(`Provider not found or disabled: ${code}`, { category: 'PROVIDER_BAD_REQUEST' });
    }
    if (record.status !== 'ACTIVE') {
      throw new ProviderError(`Provider disabled: ${code}`, { category: 'PROVIDER_BAD_REQUEST' });
    }

    // SSRF 校验：base_url 只允许管理员配置的安全地址。
    await validateFetchableUrl(record.baseUrl, this.opts.guard);

    const provider = new AgnesProvider({
      baseUrl: record.baseUrl,
      timeoutMs: this.opts.timeoutMs,
      guard: this.opts.guard,
    });

    this.cache.set(code, {
      provider,
      expires: Date.now() + (this.opts.cacheTtlMs ?? DEFAULT_CACHE_TTL),
    });
    return provider;
  }

  /** 配置变更后强制刷新。 */
  invalidate(code?: string): void {
    if (code) this.cache.delete(code);
    else this.cache.clear();
  }
}