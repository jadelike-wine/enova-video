import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { domainError, ERROR_CODES, CREDENTIAL_STATUSES, type CredentialStatus } from '@enova/contracts';
import { providerCredentials, providers, type Database } from '@enova/db';
import { CredentialCrypto } from '@enova/provider';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/config.module.js';

export interface CredentialView {
  id: string;
  providerId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCredentialInput {
  secret: string;
  status?: CredentialStatus;
  priority?: number;
  weight?: number;
  maxConcurrency?: number;
}

export interface UpdateCredentialInput {
  secret?: string;
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
      status: r.status,
      priority: r.priority,
      weight: r.weight,
      maxConcurrency: r.maxConcurrency,
      currentConcurrency: r.currentConcurrency,
      cooldownUntil: r.cooldownUntil,
      lastUsedAt: r.lastUsedAt,
      lastError: this.sanitizeLastError(r.lastError),
      hasSecret: r.encryptedSecret.length > 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** last_error 只保存过 sanitized 摘要；这里再兜底截断，避免泄漏任何敏感信息。 */
  private sanitizeLastError(lastError: string | null): string | null {
    if (!lastError) return null;
    return lastError.length > 500 ? `${lastError.slice(0, 500)}…` : lastError;
  }
}