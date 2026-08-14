import { Inject, Injectable } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { isRegisteredSetting, SETTINGS_BY_KEY } from '@enova/db';
import { SettingsService, type SettingValueView } from '../settings/settings.service.js';

/** 脱敏展示：Secret 返回 masked 尾缀或空。 */
function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `••••••••${value.slice(-4)}`;
}

/**
 * 系统配置管理（Admin）：读取/更新动态配置。
 * - 使用 CAS update()（写 history + 广播失效），保证多实例实时生效 + 可审计。
 * - 敏感项（isSecret）在返回给后台时脱敏，绝不返回明文。
 * - Secret 留空提交 = 保持原值不变（不覆盖）。
 * - 批量原子更新（updateGroup）用于 payment/storage 等必须成组一致的配置。
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** 列出全部配置（敏感值脱敏）。 */
  async list(): Promise<SettingValueView[]> {
    const views = await this.settings.list();
    return views.map((v) => (v.isSecret ? { ...v, value: v.value ? maskSecret(v.value) : '' } : v));
  }

  /** 更新单个配置（CAS + history + 失效广播）。 */
  async update(
    key: string,
    value: string,
    opts: { expectedVersion?: number; updatedBy?: string; requestId?: string; reason?: string } = {},
  ): Promise<SettingValueView> {
    if (!isRegisteredSetting(key)) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
    }
    const def = SETTINGS_BY_KEY.get(key)!;

    // Secret 留空 = 保持不变（不允许用空字符串覆盖已有 Secret）。
    if (def.isSecret && value === '') {
      // 返回当前值（脱敏）。
      const views = await this.settings.list();
      const view = views.find((v) => v.key === key)!;
      return { ...view, value: view.value ? maskSecret(view.value) : '' };
    }

    // 数值范围校验。
    if (def.valueType === 'number' && value !== '') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `Invalid number value for ${key}`, 400);
      }
      if (def.min !== undefined && n < def.min) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be >= ${def.min}`, 400);
      }
      if (def.max !== undefined && n > def.max) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be <= ${def.max}`, 400);
      }
    }

    // enum 校验。
    if (def.valueType === 'enum' && def.options && value && !def.options.includes(value)) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be one of: ${def.options.join(', ')}`, 400);
    }

    // P0: 生产环境动态配置安全守卫——拒绝危险值。
    this.validateProductionSetting(key, value);

    await this.settings.update(key, value, opts);

    const views = await this.settings.list();
    const view = views.find((v) => v.key === key)!;
    return view.isSecret ? { ...view, value: view.value ? maskSecret(view.value) : '' } : view;
  }

  /** 批量原子更新（同组配置一致性）。Secret 留空=保持不变。 */
  async updateGroup(
    items: Array<{ key: string; value: string }>,
    opts: { updatedBy?: string; requestId?: string; reason?: string } = {},
  ): Promise<SettingValueView[]> {
    // 校验所有 key 已注册。
    for (const { key, value } of items) {
      if (!isRegisteredSetting(key)) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
      }
      // P0: 生产环境动态配置安全守卫。
      this.validateProductionSetting(key, value);
    }

    await this.settings.updateGroup(items, opts);

    // 返回更新后的全部配置（脱敏）。
    return this.list();
  }

  /** 清除 Secret（设为空字符串）。 */
  async clearSecret(
    key: string,
    opts: { updatedBy?: string; requestId?: string; reason?: string } = {},
  ): Promise<SettingValueView> {
    if (!isRegisteredSetting(key)) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
    }
    const def = SETTINGS_BY_KEY.get(key)!;
    if (!def.isSecret) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} is not a secret setting`, 400);
    }

    await this.settings.clearSecret(key, opts);

    const views = await this.settings.list();
    const view = views.find((v) => v.key === key)!;
    return { ...view, value: '' };
  }

  /** 获取单个配置的变更历史。 */
  async history(key: string, limit = 50) {
    if (!isRegisteredSetting(key)) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
    }
    const def = SETTINGS_BY_KEY.get(key)!;
    const history = await this.settings.history(key, limit);
    // Secret 历史记录的 before/after 也不返回明文。
    if (def.isSecret) {
      return history.map((h) => ({
        ...h,
        before: h.before ? '[REDACTED]' : h.before,
        after: h.after ? '[REDACTED]' : h.after,
      }));
    }
    return history;
  }

  /**
   * P0: 生产环境动态配置安全守卫。
   * 阻止管理员通过后台将安全配置改为危险值。
   * 这些检查在启动时 loadEnv 已做，但运行时通过 System Settings 修改时也必须拦截。
   */
  private validateProductionSetting(key: string, value: string): void {
    if (process.env.NODE_ENV !== 'production') return;

    // 禁止将支付模式改回 sandbox
    if (key === 'payment.mode' && value === 'sandbox') {
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot set payment.mode to sandbox in production. Use alipay or wechat.',
        400,
      );
    }

    // 禁止将存储改为 none
    if (key === 'storage.provider' && value === 'none') {
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot set storage.provider to none in production. Use s3.',
        400,
      );
    }

    // 禁止将支付回调地址改为 HTTP 或 localhost
    if (key === 'payment.returnBaseUrl' || key === 'payment.notifyUrl') {
      if (value.includes('localhost') || !value.startsWith('https://')) {
        throw domainError(
          ERROR_CODES.VALIDATION_ERROR,
          `Production requires ${key} to use HTTPS and not contain localhost.`,
          400,
        );
      }
    }

    // 禁止关闭 SSRF DNS 校验
    if (key === 'ssrf.resolveDns' && value === 'false') {
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot disable ssrf.resolveDns in production.',
        400,
      );
    }

    // 禁止在生产开启 SSRF allowHttp
    if (key === 'ssrf.allowHttp' && value === 'true') {
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        'Cannot enable ssrf.allowHttp in production.',
        400,
      );
    }
  }
}
