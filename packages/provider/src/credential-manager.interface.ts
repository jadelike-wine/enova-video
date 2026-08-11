import { CredentialStatus } from '@enova/contracts';
import type { ProviderErrorCategory } from './errors.js';

/**
 * Provider Credential 管理器接口。
 * 职责：weighted/priority 选择、并发控制、冷却、错误追踪、自动恢复、健康状态。
 * 并发控制必须基于 Redis（多实例/Worker 可靠），禁止仅用进程内 Map。
 */

export interface CredentialSelectionCriteria {
  providerCode: string;
  /** 预留：可按能力/租户绑定。 */
  workspaceId?: string;
}

/** 选中并锁定一个凭证（占用并发槽位），调用方用完必须 release。 */
export interface AcquiredCredential {
  credentialId: string;
  providerCode: string;
  secret: string; // 解密后的 secret，仅在此作用域内可用
  release(): Promise<void>;
}

/** markFailure 上报结构（基于 ProviderError 分类）。 */
export interface CredentialFailure {
  category: ProviderErrorCategory;
  retryAfterMs?: number;
  message?: string;
}

export interface CredentialHealth {
  credentialId: string;
  status: CredentialStatus;
  currentConcurrency: number;
  maxConcurrency: number;
  cooldownUntil?: Date;
  lastUsedAt?: Date;
  lastError?: string;
}

export interface CredentialManager {
  /** 选择并占用一个健康凭证；无可用时抛出 NO_AVAILABLE_CREDENTIAL。 */
  acquire(criteria: CredentialSelectionCriteria): Promise<AcquiredCredential>;
  /** 上报成功：重置退避/冷却。 */
  markSuccess(credentialId: string, providerCode: string): Promise<void>;
  /** 上报失败：根据错误分类决定冷却/禁用/降级。 */
  markFailure(credentialId: string, providerCode: string, failure: CredentialFailure): Promise<void>;
  /** 健康状态（供 Admin / 监控）。 */
  health(criteria: CredentialSelectionCriteria): Promise<CredentialHealth[]>;
  /** 配置变更后强制刷新。 */
  invalidate(providerCode: string): Promise<void>;
}

export const CREDENTIAL_MANAGER = Symbol('CREDENTIAL_MANAGER');