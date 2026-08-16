import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { domainError, ERROR_CODES, PROVIDER_STATUSES, type ProviderStatus } from '@enova/contracts';
import { providers, type Database } from '@enova/db';
import { validateProviderBaseUrl, type UrlGuardOptions } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';
import { SettingsService } from '../settings/settings.service.js';

export interface ProviderView {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  status: ProviderStatus | string;
  config: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProviderInput {
  code: string;
  name: string;
  baseUrl: string;
  status?: ProviderStatus;
  config?: Record<string, unknown>;
}

export interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  status?: ProviderStatus;
  config?: Record<string, unknown>;
}

/** Agnes Provider 固定配置（第一版只支持 Agnes，不做多 Provider 适配）。 */
export const AGNES_PROVIDER_CODE = 'agnes';
export const AGNES_PROVIDER_NAME = 'Agnes';
export const AGNES_PROVIDER_BASE_URL = 'https://apihub.agnes-ai.com';

/**
 * Provider 管理（Admin）。
 * base_url 必须经过 SSRF 校验（仅 https、非私网），防止管理员配置出可达内网的 URL。
 */
@Injectable()
export class ProvidersAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /**
   * 确保 Agnes Provider 存在。
   * 第一版只支持 Agnes，管理员添加账号时无需手动创建 Provider。
   * 如果数据库中还没有 agnes Provider，自动创建；已存在则返回现有记录。
   */
  async ensureAgnesProvider(): Promise<ProviderView> {
    const existing = await this.db
      .select()
      .from(providers)
      .where(eq(providers.code, AGNES_PROVIDER_CODE))
      .limit(1);
    if (existing.length > 0) return this.toView(existing[0]);

    const [row] = await this.db
      .insert(providers)
      .values({
        code: AGNES_PROVIDER_CODE,
        name: AGNES_PROVIDER_NAME,
        baseUrl: AGNES_PROVIDER_BASE_URL,
        status: PROVIDER_STATUSES.ACTIVE,
      })
      .returning();
    return this.toView(row);
  }

  async list(limit: number, offset: number): Promise<ProviderView[]> {
    const limitSafe = Math.min(Math.max(limit, 1), 100);
    const offsetSafe = Math.max(offset, 0);
    const rows = await this.db.select().from(providers).orderBy(providers.code).limit(limitSafe).offset(offsetSafe);
    return rows.map((r) => this.toView(r));
  }

  async get(id: string): Promise<ProviderView> {
    const row = await this.requireProvider(id);
    return this.toView(row);
  }

  async create(input: CreateProviderInput): Promise<ProviderView> {
    const code = input.code.trim();
    if (!code) throw domainError(ERROR_CODES.VALIDATION_ERROR, 'provider code is required', 400);

    await this.validateBaseUrl(input.baseUrl);

    const existing = await this.db.select().from(providers).where(eq(providers.code, code)).limit(1);
    if (existing.length > 0) throw domainError(ERROR_CODES.CONFLICT, `Provider code already exists: ${code}`, 409);

    const [row] = await this.db.insert(providers).values({
      code,
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim(),
      status: input.status ?? PROVIDER_STATUSES.ACTIVE,
      config: input.config,
    }).returning();
    return this.toView(row);
  }

  async update(id: string, input: UpdateProviderInput): Promise<ProviderView> {
    const row = await this.requireProvider(id);
    if (input.baseUrl !== undefined && input.baseUrl !== row.baseUrl) {
      await this.validateBaseUrl(input.baseUrl);
    }
    const [updated] = await this.db
      .update(providers)
      .set({
        name: input.name !== undefined ? input.name.trim() : row.name,
        baseUrl: input.baseUrl !== undefined ? input.baseUrl.trim() : row.baseUrl,
        status: input.status ?? row.status,
        config: input.config !== undefined ? input.config : row.config,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, id))
      .returning();
    return this.toView(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireProvider(id);
    // providers.credentials 外键 onDelete cascade，删除 Provider 会连带清除其 Credential。
    await this.db.delete(providers).where(eq(providers.id, id));
  }

  private async requireProvider(id: string) {
    const rows = await this.db.select().from(providers).where(eq(providers.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw domainError(ERROR_CODES.PROVIDER_NOT_FOUND, 'Provider not found', 404);
    return row;
  }

  private async validateBaseUrl(baseUrl: string): Promise<void> {
    if (!baseUrl || !baseUrl.trim()) throw domainError(ERROR_CODES.VALIDATION_ERROR, 'provider base_url is required', 400);
    await validateProviderBaseUrl(baseUrl.trim(), await this.guardOptions());
  }

  /** SSRF guard 配置从动态配置读取（管理员后台可修改，实时生效）。 */
  private async guardOptions(): Promise<UrlGuardOptions> {
    const allowHttp = (await this.settings.getBoolean('ssrf.allowHttp')) ?? this.env.SSRF_ALLOW_HTTP;
    const resolveDns = (await this.settings.getBoolean('ssrf.resolveDns')) ?? this.env.SSRF_RESOLVE_DNS;
    const devAllowList = (await this.settings.getString('ssrf.devAllowList')) ?? this.env.SSRF_DEV_ALLOW_LIST;
    return {
      allowHttp,
      resolveDns,
      devAllowlist: this.env.NODE_ENV !== 'production'
        ? devAllowList.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    };
  }

  private toView(r: {
    id: string;
    code: string;
    name: string;
    baseUrl: string;
    status: string;
    config: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProviderView {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      baseUrl: r.baseUrl,
      status: r.status,
      config: r.config,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}