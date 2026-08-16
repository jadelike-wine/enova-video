import { Inject, Injectable } from '@nestjs/common';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { domainError, ERROR_CODES, CREDENTIAL_STATUSES, type CredentialStatus } from '@enova/contracts';
import { providerCredentials, providers, type Database } from '@enova/db';
import { CredentialCrypto, validateFetchableUrl, type UrlGuardOptions } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';
import { SettingsService } from '../settings/settings.service.js';

/** 展平后的账号行：Credential + Provider 信息。 */
export interface AccountRow {
  id: string;
  name: string | null;
  remark: string | null;
  providerId: string;
  providerCode: string;
  providerName: string;
  providerBaseUrl: string;
  providerStatus: string;
  status: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  currentConcurrency: number;
  cooldownUntil: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  hasSecret: boolean;
  maskedApiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 测试连接结果。 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
  /** HTTP 状态码（如果有）。 */
  statusCode?: number;
  /** 错误分类（如果有）。 */
  category?: string;
}

export interface CredentialView {
  id: string;
  providerId: string;
  name: string | null;
  remark: string | null;
  status: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  currentConcurrency: number;
  cooldownUntil: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  /** 不返回 Secret，仅标示是否已设置。 */
  hasSecret: boolean;
  /** 脱敏后的 API Key 预览，例如 sk-••••3A8F。 */
  maskedApiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCredentialInput {
  secret: string;
  name?: string;
  remark?: string;
  status?: CredentialStatus;
  priority?: number;
  weight?: number;
  maxConcurrency?: number;
}

export interface UpdateCredentialInput {
  secret?: string;
  name?: string;
  remark?: string;
  status?: CredentialStatus;
  priority?: number;
  weight?: number;
  maxConcurrency?: number;
  /** 清除 cooldown/lastError（管理员手动恢复）。 */
  clearBackoff?: boolean;
}

/**
 * Provider Credential 管理（Admin）。
 * - Secret 入库前 AES-GCM 加密（encrypted_secret），绝不存明文、绝不返回明文。
 * - 更新时仅当提供新 secret 才重新加密，其它字段按需更新。
 */
@Injectable()
export class CredentialsAdminService {
  private readonly crypto: CredentialCrypto;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {
    this.crypto = CredentialCrypto.fromEnv(env.CREDENTIAL_MASTER_KEY);
  }

  async listByProvider(providerId: string): Promise<CredentialView[]> {
    const rows = await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.providerId, providerId))
      .orderBy(providerCredentials.priority);
    return rows.map((r) => this.toView(r));
  }

  /**
   * 展平查询：跨所有 Provider 列出所有 Credential，关联 Provider 信息。
   * 这是新的主列表 API，一行代表一个可调用的 API 账号。
   */
  async listAccounts(opts?: {
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
    providerCode?: string;
  }): Promise<AccountRow[]> {
    const limitSafe = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const offsetSafe = Math.max(opts?.offset ?? 0, 0);

    const conditions = [];
    if (opts?.status) {
      conditions.push(eq(providerCredentials.status, opts.status as CredentialStatus));
    }
    if (opts?.providerCode) {
      conditions.push(eq(providers.code, opts.providerCode));
    }

    const rows = await this.db
      .select({
        id: providerCredentials.id,
        name: providerCredentials.name,
        remark: providerCredentials.remark,
        providerId: providerCredentials.providerId,
        providerCode: providers.code,
        providerName: providers.name,
        providerBaseUrl: providers.baseUrl,
        providerStatus: providers.status,
        status: providerCredentials.status,
        priority: providerCredentials.priority,
        weight: providerCredentials.weight,
        maxConcurrency: providerCredentials.maxConcurrency,
        currentConcurrency: providerCredentials.currentConcurrency,
        cooldownUntil: providerCredentials.cooldownUntil,
        lastUsedAt: providerCredentials.lastUsedAt,
        lastError: providerCredentials.lastError,
        encryptedSecret: providerCredentials.encryptedSecret,
        createdAt: providerCredentials.createdAt,
        updatedAt: providerCredentials.updatedAt,
      })
      .from(providerCredentials)
      .innerJoin(providers, eq(providerCredentials.providerId, providers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(providerCredentials.priority), asc(providerCredentials.createdAt))
      .limit(limitSafe)
      .offset(offsetSafe);

    return rows.map((r) => ({
      ...r,
      maskedApiKey: this.maskSecret(r.encryptedSecret),
      hasSecret: r.encryptedSecret.length > 0,
      lastError: this.sanitizeLastError(r.lastError),
    }));
  }

  /** 统计总数（用于分页）。 */
  async countAccounts(opts?: { status?: string; providerCode?: string }): Promise<number> {
    const conditions = [];
    if (opts?.status) {
      conditions.push(eq(providerCredentials.status, opts.status as CredentialStatus));
    }
    if (opts?.providerCode) {
      conditions.push(eq(providers.code, opts.providerCode));
    }
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(providerCredentials)
      .innerJoin(providers, eq(providerCredentials.providerId, providers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return rows[0]?.count ?? 0;
  }

  async get(id: string): Promise<CredentialView> {
    const row = await this.requireCredential(id);
    return this.toView(row);
  }

  async create(providerId: string, input: CreateCredentialInput): Promise<CredentialView> {
    await this.requireProvider(providerId);
    if (!input.secret || !input.secret.trim()) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'credential secret is required', 400);
    }
    const encrypted = this.crypto.encrypt(input.secret);

    const [row] = await this.db.insert(providerCredentials).values({
      providerId,
      name: input.name?.trim() || null,
      remark: input.remark?.trim() || null,
      encryptedSecret: encrypted,
      status: input.status ?? CREDENTIAL_STATUSES.ACTIVE,
      priority: input.priority ?? 0,
      weight: input.weight ?? 1,
      maxConcurrency: input.maxConcurrency ?? 1,
    }).returning();
    return this.toView(row);
  }

  async update(id: string, input: UpdateCredentialInput): Promise<CredentialView> {
    const row = await this.requireCredential(id);
    const encryptedSecret = input.secret !== undefined && input.secret.trim()
      ? this.crypto.encrypt(input.secret)
      : row.encryptedSecret;

    const [updated] = await this.db
      .update(providerCredentials)
      .set({
        encryptedSecret,
        name: input.name !== undefined ? (input.name?.trim() || null) : row.name,
        remark: input.remark !== undefined ? (input.remark?.trim() || null) : row.remark,
        status: input.status ?? row.status,
        priority: input.priority ?? row.priority,
        weight: input.weight ?? row.weight,
        maxConcurrency: input.maxConcurrency ?? row.maxConcurrency,
        cooldownUntil: input.clearBackoff ? null : row.cooldownUntil,
        lastError: input.clearBackoff ? null : row.lastError,
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.id, id))
      .returning();
    return this.toView(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireCredential(id);
    await this.db.delete(providerCredentials).where(eq(providerCredentials.id, id));
  }

  /**
   * 测试连接：向 Provider 发送一个轻量级请求，验证 API Key 是否有效。
   * - 支持保存前测试（直接传 secret + providerCode/baseUrl）。
   * - 支持保存后测试（传 credentialId，自动解密 + 查 Provider 信息）。
   * - 使用 SSRF guard 校验 baseUrl。
   * - 超时 10 秒，不产生任何实际生成任务。
   */
  async testConnection(opts: {
    credentialId?: string;
    secret?: string;
    providerCode?: string;
    baseUrl?: string;
  }): Promise<TestConnectionResult> {
    // 确定 secret
    let secret: string | undefined = opts.secret?.trim();
    let providerCode: string | undefined = opts.providerCode;
    let baseUrl: string | undefined = opts.baseUrl;

    if (opts.credentialId) {
      const cred = await this.requireCredential(opts.credentialId);
      if (!secret) {
        secret = this.crypto.decrypt(cred.encryptedSecret);
      }
      // 查 Provider 信息
      const providerRows = await this.db
        .select()
        .from(providers)
        .where(eq(providers.id, cred.providerId))
        .limit(1);
      const provider = providerRows[0];
      if (provider) {
        providerCode ??= provider.code;
        baseUrl ??= provider.baseUrl;
      }
    }

    if (!secret) {
      return { success: false, message: 'API Key 为空，无法测试' };
    }
    if (!baseUrl) {
      return { success: false, message: 'Base URL 为空，无法测试' };
    }

    // SSRF 校验
    try {
      const guardOpts = await this.guardOptions();
      await validateFetchableUrl(baseUrl, guardOpts);
    } catch {
      return { success: false, message: 'Base URL 未通过 SSRF 校验' };
    }

    // 发送一个轻量级请求验证 API Key。
    // Agnes 使用 Bearer token 认证；GET 一个已知端点，期望返回 200 或 401/403。
    // 其他 Provider 如果将来支持，可以在 ProviderRegistry 中扩展。
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const url = new URL('/agnesapi', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
          redirect: 'manual',
        });

        if (res.status === 401 || res.status === 403) {
          return {
            success: false,
            message: 'API Key 无效',
            statusCode: res.status,
            category: 'AUTH_ERROR',
          };
        }
        if (res.status === 429) {
          return {
            success: true,
            message: 'API Key 验证成功（触发限流，但 Key 有效）',
            statusCode: res.status,
          };
        }
        if (res.status >= 200 && res.status < 500) {
          return {
            success: true,
            message: 'API Key 验证成功',
            statusCode: res.status,
          };
        }
        // 5xx 可能是 Provider 端问题
        return {
          success: false,
          message: `Provider 无法访问 (HTTP ${res.status})`,
          statusCode: res.status,
          category: 'PROVIDER_ERROR',
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, message: '请求超时', category: 'PROVIDER_TIMEOUT' };
      }
      return {
        success: false,
        message: `Provider 无法访问: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        category: 'PROVIDER_ERROR',
      };
    }
  }

  /** SSRF guard 配置（复用 ProvidersAdminService 逻辑）。 */
  private async guardOptions(): Promise<UrlGuardOptions> {
    const allowHttp = (await this.settings.getBoolean('ssrf.allowHttp')) ?? false;
    const resolveDns = (await this.settings.getBoolean('ssrf.resolveDns')) ?? false;
    return {
      allowHttp,
      resolveDns,
      devAllowlist: [],
    };
  }

  private async requireProvider(providerId: string): Promise<void> {
    const rows = await this.db.select({ id: providers.id }).from(providers).where(eq(providers.id, providerId)).limit(1);
    if (rows.length === 0) throw domainError(ERROR_CODES.PROVIDER_NOT_FOUND, 'Provider not found', 404);
  }

  private async requireCredential(id: string) {
    const rows = await this.db.select().from(providerCredentials).where(eq(providerCredentials.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw domainError(ERROR_CODES.CREDENTIAL_NOT_FOUND, 'Credential not found', 404);
    return row;
  }

  private toView(r: {
    id: string;
    providerId: string;
    name: string | null;
    remark: string | null;
    status: string;
    priority: number;
    weight: number;
    maxConcurrency: number;
    currentConcurrency: number;
    cooldownUntil: Date | null;
    lastUsedAt: Date | null;
    lastError: string | null;
    encryptedSecret: string;
    createdAt: Date;
    updatedAt: Date;
  }): CredentialView {
    return {
      id: r.id,
      providerId: r.providerId,
      name: r.name,
      remark: r.remark,
      status: r.status,
      priority: r.priority,
      weight: r.weight,
      maxConcurrency: r.maxConcurrency,
      currentConcurrency: r.currentConcurrency,
      cooldownUntil: r.cooldownUntil,
      lastUsedAt: r.lastUsedAt,
      lastError: this.sanitizeLastError(r.lastError),
      hasSecret: r.encryptedSecret.length > 0,
      maskedApiKey: this.maskSecret(r.encryptedSecret),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * 脱敏 API Key：解密后取前缓后后级拼接。
   * 格式：sk-••••3A8F（前缀 + 掩码 + 后4位）。
   */
  private maskSecret(encryptedSecret: string): string | null {
    if (!encryptedSecret) return null;
    try {
      const plain = this.crypto.decrypt(encryptedSecret);
      if (plain.length <= 8) {
        return '••••';
      }
      const prefix = plain.slice(0, Math.min(3, plain.length));
      const suffix = plain.slice(-4);
      return `${prefix}••••${suffix}`;
    } catch {
      return '••••';
    }
  }

  /** last_error 只保存过 sanitized 摘要；这里再兜底截断，避免泄漏任何敏感信息。 */
  private sanitizeLastError(lastError: string | null): string | null {
    if (!lastError) return null;
    return lastError.length > 500 ? `${lastError.slice(0, 500)}…` : lastError;
  }
}