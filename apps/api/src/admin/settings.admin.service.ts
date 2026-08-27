import { Inject, Injectable } from '@nestjs/common';
import { DomainError, domainError, ERROR_CODES } from '@enova/contracts';
import { isRegisteredSetting, SETTINGS_BY_KEY } from '@enova/db';
import { createObjectStorage, validateFetchableUrl } from '@enova/provider';
import { SettingsService, type SettingValueView } from '../settings/settings.service.js';
import { LoginAgreementValidationError, parseLoginAgreementDocuments, validateLoginAgreementDate } from '../settings/login-agreement.js';

/** 脱敏展示：Secret 返回 masked 尾缀或空。 */
function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `••••••••${value.slice(-4)}`;
}

const MAX_URL_LENGTH = 2048;
const MAX_LOGO_LENGTH = 410_000;
const MAX_LOGO_BYTES = 300 * 1024;
const MAX_CUSTOM_MENU_ITEMS = 100;
const MAX_SORT_ORDER = 10_000;
const MAX_SETTING_ID_LENGTH = 128;
const MAX_SETTING_LABEL_LENGTH = 200;

type StructuredRecord = Record<string, unknown>;

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

  /** 上传、检查并删除一个短生命周期测试对象，验证桶/空间与访问权限。 */
  async testStorage(): Promise<{
    provider: string;
    bucket: string;
    key: string;
    exists: boolean;
    publicUrl: string;
    publicUrlAccessible: boolean;
  }> {
    const config = await this.settings.getStorageConfig();
    if (config.provider === 'none' || !config.configured) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, '请配置对象存储', 400);
    }

    const storage = createObjectStorage(
      config.provider === 'aws_s3'
        ? {
            kind: 'aws_s3',
            s3: {
              region: config.region,
              bucket: config.bucket,
              prefix: config.prefix,
              publicBaseUrl: config.publicBaseUrl,
              endpointUrl: config.endpointUrl,
              credentials: config.credentials,
              download: { guard: { allowHttp: false, resolveDns: true, devAllowlist: [] }, maxBytes: 1024, timeoutMs: 5000 },
              allowedContentTypePrefixes: ['text/'],
            },
          }
        : {
            kind: 'qiniu',
            qiniu: {
              accessKey: config.qiniu.accessKey,
              secretKey: config.qiniu.secretKey,
              bucket: config.qiniu.bucket,
              domain: config.qiniu.domain,
              region: config.qiniu.region,
              prefix: config.prefix,
              download: { guard: { allowHttp: false, resolveDns: true, devAllowlist: [] }, maxBytes: 1024, timeoutMs: 5000 },
              allowedContentTypePrefixes: ['text/'],
            },
          },
    );
    const stored = await storage.uploadBytes(Buffer.from('enova-storage-test\n'), {
      mediaType: 'document',
      ext: 'txt',
      contentType: 'text/plain',
    });
    if (!stored) throw domainError(ERROR_CODES.VALIDATION_ERROR, '对象存储未完成上传', 400);

    try {
      const exists = await storage.objectExists(stored.key);
      const publicUrl = stored.url ?? await storage.getDisplayUrl(stored.key);
      let publicUrlAccessible = false;
      if (publicUrl) {
        await validateFetchableUrl(publicUrl, { allowHttp: false, resolveDns: true, devAllowlist: [] });
        const response = await fetch(publicUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
          redirect: 'manual',
        });
        publicUrlAccessible = response.ok;
        await response.body?.cancel();
      }
      return { provider: stored.provider, bucket: config.provider === 'aws_s3' ? config.bucket : config.qiniu.bucket, key: stored.key, exists, publicUrl, publicUrlAccessible };
    } finally {
      await storage.deleteObject(stored.key);
    }
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
    value = this.normalizeValue(key, value);

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
      if (key === 'table.defaultPageSize' && !Number.isInteger(n)) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'table.defaultPageSize must be an integer', 400);
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

    // 通用配置校验：URL 格式、自定义菜单 JSON 等。
    await this.validateGeneralSetting(key, value);

    // P0: 生产环境动态配置安全守卫——拒绝危险值。
    this.validateProductionSetting(key, value);
    await this.validateLoginAgreementUpdate(key, value);

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
    const normalizedItems: Array<{ key: string; value: string }> = [];
    for (const { key, value } of items) {
      if (!isRegisteredSetting(key)) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
      }
      const def = SETTINGS_BY_KEY.get(key)!;
      const normalized = this.normalizeValue(key, value);

      // 数值范围校验。
      if (def.valueType === 'number' && normalized !== '' && !(def.isSecret && normalized === '')) {
        const n = Number(normalized);
        if (!Number.isFinite(n)) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, `Invalid number value for ${key}`, 400);
        }
        if (key === 'table.defaultPageSize' && !Number.isInteger(n)) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, 'table.defaultPageSize must be an integer', 400);
        }
        if (def.min !== undefined && n < def.min) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be >= ${def.min}`, 400);
        }
        if (def.max !== undefined && n > def.max) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be <= ${def.max}`, 400);
        }
      }

      // enum 校验。
      if (def.valueType === 'enum' && def.options && normalized && !def.options.includes(normalized)) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, `${key} must be one of: ${def.options.join(', ')}`, 400);
      }

      // 通用配置校验。
      await this.validateGeneralSetting(key, normalized);

      normalizedItems.push({ key, value: normalized });
    }

    // P0: 生产环境动态配置安全守卫。
    for (const { key, value } of normalizedItems) {
      this.validateProductionSetting(key, value);
    }

    await this.validateLoginAgreementGroup(normalizedItems);

    await this.settings.updateGroup(normalizedItems, opts);

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

    // 站点 URL 生产环境必须 HTTPS 且不能是 localhost
    if (key === 'general.siteUrl' && value) {
      if (value.includes('localhost') || !value.startsWith('https://')) {
        throw domainError(
          ERROR_CODES.VALIDATION_ERROR,
          'Production requires general.siteUrl to use HTTPS and not contain localhost.',
          400,
        );
      }
    }

    // 邮件链接必须指向生产站点，避免发送不可用或不安全的验证链接。
    if (key === 'email.passwordResetUrl' || key === 'email.emailVerifyUrl') {
      if (value.includes('localhost') || !value.startsWith('https://')) {
        throw domainError(
          ERROR_CODES.VALIDATION_ERROR,
          `Production requires ${key} to use HTTPS and not contain localhost.`,
          400,
        );
      }
    }

    // 客服邮箱是公开信息，生产环境不允许继续使用示例地址。
    if (key === 'general.supportEmail' && (!value || value === 'support@example.com')) {
      throw domainError(
        ERROR_CODES.VALIDATION_ERROR,
        'Production requires general.supportEmail to be set to a real support email address.',
        400,
      );
    }
  }

  private async validateLoginAgreementUpdate(key: string, value: string): Promise<void> {
    if (key === 'general.loginAgreementDocuments') {
      this.parseLoginAgreementDocuments(value);
    }
    if (key === 'general.loginAgreementUpdatedAt') {
      try {
        validateLoginAgreementDate(value);
      } catch (error) {
        if (error instanceof LoginAgreementValidationError) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, error.message, 400);
        }
        throw error;
      }
    }
    if (key !== 'general.loginAgreementEnabled' && key !== 'general.loginAgreementDocuments') return;

    const current = await this.settings.getMany([
      'general.loginAgreementEnabled',
      'general.loginAgreementDocuments',
    ]);
    const enabled = key === 'general.loginAgreementEnabled'
      ? this.parseBoolean(value)
      : this.parseBoolean(current.get('general.loginAgreementEnabled'));
    const rawDocuments = key === 'general.loginAgreementDocuments'
      ? value
      : current.get('general.loginAgreementDocuments');
    const documents = this.parseLoginAgreementDocuments(rawDocuments);
    if (enabled && documents.length === 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'At least one legal document is required when login agreement is enabled', 400);
    }
  }

  private async validateLoginAgreementGroup(items: Array<{ key: string; value: string }>): Promise<void> {
    // 日期格式校验
    const dateItem = items.find(({ key }) => key === 'general.loginAgreementUpdatedAt');
    if (dateItem) {
      try {
        validateLoginAgreementDate(dateItem.value);
      } catch (error) {
        if (error instanceof LoginAgreementValidationError) {
          throw domainError(ERROR_CODES.VALIDATION_ERROR, error.message, 400);
        }
        throw error;
      }
    }

    if (!items.some(({ key }) => key === 'general.loginAgreementEnabled' || key === 'general.loginAgreementDocuments')) return;

    const current = await this.settings.getMany([
      'general.loginAgreementEnabled',
      'general.loginAgreementDocuments',
    ]);
    const values = new Map(current);
    for (const item of items) values.set(item.key, item.value);

    const documents = this.parseLoginAgreementDocuments(values.get('general.loginAgreementDocuments'));
    if (this.parseBoolean(values.get('general.loginAgreementEnabled')) && documents.length === 0) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, 'At least one legal document is required when login agreement is enabled', 400);
    }
  }

  /**
   * 通用配置校验：URL 格式、可选条数列表去重排序、自定义菜单 JSON 校验等。
   * 这些校验不区分生产/开发环境，始终生效。
   */
  private async validateGeneralSetting(key: string, value: string): Promise<void> {
    const urlSettingKeys = new Set(['general.siteUrl', 'general.docUrl', 'ai.titleGenerationBaseUrl']);
    if (urlSettingKeys.has(key) && value) {
      await this.validateHttpUrl(key, value);
    }

    // 站点 Logo：远程图片受 URL/SSRF 守卫保护，内嵌图片只允许受支持的图片 data URI。
    if (key === 'general.siteLogo' && value) {
      await this.validateLogo(value);
    }

    // 自定义首页以 URL 开头时会被前端作为 iframe src 使用，同样不能绕过 URL 守卫。
    if (key === 'general.homeContent' && /^https?:\/\//i.test(value.trim())) {
      await this.validateHttpUrl('general.homeContent', value.trim());
    }

    // 可选每页条数列表：保存时自动去重、排序、过滤非法值。
    if (key === 'table.pageSizeOptions' && value) {
      const normalized = this.normalizePageSizeOptions(value);
      // 校验通过后，将值替换为规范化后的结果。
      // 注意：这里不直接修改 value（调用方已持有），而是确保校验通过。
      // 规范化在 normalizeValue 中执行。
      if (normalized.length === 0) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'table.pageSizeOptions must contain at least one valid value (5-1000)', 400);
      }
    }

    // 自定义菜单项 JSON 校验。
    if (key === 'general.customMenuItems' && value) {
      await this.validateCustomMenuItems(value);
    }

    // 邮箱域名白名单 JSON 校验。
    if (key === 'auth.emailDomainWhitelist' && value) {
      this.validateEmailDomainWhitelist(value);
    }

  }

  private async getUrlGuardOptions() {
    const allowHttpSetting = await this.settings.getBoolean('ssrf.allowHttp');
    const resolveDnsSetting = await this.settings.getBoolean('ssrf.resolveDns');
    const allowHttp = process.env.NODE_ENV === 'production' ? false : (allowHttpSetting ?? false);
    const resolveDns = process.env.NODE_ENV === 'production' ? true : (resolveDnsSetting ?? true);
    const allowListRaw = process.env.NODE_ENV === 'production'
      ? ''
      : (await this.settings.getString('ssrf.devAllowList')) ?? '';

    return {
      allowHttp,
      resolveDns,
      devAllowlist: allowListRaw.split(',').map((host) => host.trim()).filter(Boolean),
    };
  }

  private async validateHttpUrl(field: string, raw: string): Promise<void> {
    const value = raw.trim();
    if (value.length > MAX_URL_LENGTH) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `${field} must be at most ${MAX_URL_LENGTH} characters`, 400);
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `${field} must be a valid http(s) URL`, 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `${field} must use http:// or https://`, 400);
    }

    await validateFetchableUrl(value, await this.getUrlGuardOptions());
  }

  private async validateLogo(value: string): Promise<void> {
    if (value.length > MAX_LOGO_LENGTH) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `general.siteLogo must be at most ${MAX_LOGO_LENGTH} characters`, 400);
    }

    if (/^data:/i.test(value)) {
      const match = /^data:(image\/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
      if (!match) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'general.siteLogo must be a PNG, JPEG, or SVG base64 data URI', 400);
      }
      const decoded = Buffer.from(match[2], 'base64');
      if (decoded.length > MAX_LOGO_BYTES) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, 'general.siteLogo image must be at most 300KB', 400);
      }
      return;
    }

    await this.validateHttpUrl('general.siteLogo', value);
  }

  /** 规范化可选每页条数列表：去空、过滤非法值、去重、升序排序。 */
  private normalizePageSizeOptions(value: string): number[] {
    const parts = value.split(',');
    const valid = new Set<number>();
    for (const part of parts) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 5 && n <= 1000) {
        valid.add(n);
      }
    }
    return Array.from(valid).sort((a, b) => a - b);
  }

  /** 校验邮箱域名白名单 JSON 格式和每项格式。 */
  private validateEmailDomainWhitelist(raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('emailDomainWhitelist must be a JSON array');
      }
      const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
      for (const [index, item] of parsed.entries()) {
        if (typeof item !== 'string') {
          throw new Error(`emailDomainWhitelist[${index}] must be a string`);
        }
        const value = item.trim().toLowerCase();
        if (!value) continue;
        // 支持 @example.com 或 example.com 或 *.edu.cn
        if (value.startsWith('@')) {
          const domain = value.slice(1);
          if (!domainPattern.test(domain)) {
            throw new Error(`emailDomainWhitelist[${index}] has invalid domain: ${item}`);
          }
        } else if (value.startsWith('*.')) {
          const domain = value.slice(2);
          if (!domainPattern.test(domain)) {
            throw new Error(`emailDomainWhitelist[${index}] has invalid wildcard domain: ${item}`);
          }
        } else if (!domainPattern.test(value)) {
          throw new Error(`emailDomainWhitelist[${index}] has invalid domain: ${item}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Invalid emailDomainWhitelist: ${message}`, 400);
    }
  }

  /** 规范化邮箱域名白名单：解析 JSON、去重、统一为 @domain 格式。 */
  private normalizeEmailDomainWhitelist(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return '[]';
      const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of parsed) {
        if (typeof item !== 'string') continue;
        const value = item.trim().toLowerCase();
        if (!value) continue;
        // 统一为 @domain 或 *.domain 格式
        if (value.startsWith('*.')) {
          const domain = value.slice(2);
          if (!domainPattern.test(domain)) continue;
          const normalized = '*.' + domain;
          if (!seen.has(normalized)) {
            seen.add(normalized);
            out.push(normalized);
          }
        } else {
          let domain = value;
          if (value.startsWith('@')) domain = value.slice(1);
          if (!domainPattern.test(domain)) continue;
          const normalized = '@' + domain;
          if (!seen.has(normalized)) {
            seen.add(normalized);
            out.push(normalized);
          }
        }
      }
      return JSON.stringify(out);
    } catch {
      return '[]';
    }
  }

  /** 校验自定义菜单项 JSON 格式。 */
  private async validateCustomMenuItems(raw: string): Promise<void> {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('customMenuItems must be a JSON array');
      }
      if (parsed.length > MAX_CUSTOM_MENU_ITEMS) {
        throw new Error(`customMenuItems supports at most ${MAX_CUSTOM_MENU_ITEMS} items`);
      }
      const ids = new Set<string>();
      for (const [index, item] of parsed.entries()) {
        if (!item || typeof item !== 'object') {
          throw new Error('Each menu item must be an object');
        }
        const record = item as StructuredRecord;
        if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > MAX_SETTING_ID_LENGTH) {
          throw new Error('Each menu item must have a non-empty id');
        }
        if (ids.has(record.id)) {
          throw new Error(`Duplicate menu item id: ${record.id}`);
        }
        ids.add(record.id);
        if (typeof record.label !== 'string' || !record.label.trim() || record.label.length > MAX_SETTING_LABEL_LENGTH) {
          throw new Error('Each menu item must have a non-empty label');
        }
        if (typeof record.url !== 'string' || !record.url.trim()) {
          throw new Error('Each menu item must have a URL');
        }
        if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
          throw new Error('Each menu item enabled value must be boolean');
        }
        if (record.sortOrder !== undefined && (typeof record.sortOrder !== 'number' || !Number.isInteger(record.sortOrder) || record.sortOrder < 1 || record.sortOrder > MAX_SORT_ORDER)) {
          throw new Error(`Each menu item sortOrder must be an integer from 1 to ${MAX_SORT_ORDER}`);
        }
        if (record.visibility !== 'user' && record.visibility !== 'admin') {
          throw new Error('Each menu item visibility must be user or admin');
        }
        await this.validateHttpUrl(`customMenuItems[${index}].url`, record.url);
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Invalid customMenuItems: ${message}`, 400);
    }
  }

  private parseBoolean(value: string | null | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
  }

  private normalizeValue(key: string, value: string): string {
    // 日志级别别名归一化。
    if (key === 'log.level') {
      const aliases: Record<string, string> = {
        DEBUG: 'debug',
        INFO: 'info',
        WARNING: 'warn',
        WARN: 'warn',
        ERROR: 'error',
        CRITICAL: 'fatal',
        FATAL: 'fatal',
      };
      return aliases[value.trim().toUpperCase()] ?? value;
    }

    // 可选每页条数列表：保存时自动去空、过滤非法值、去重、升序排序。
    if (key === 'table.pageSizeOptions' && value) {
      const normalized = this.normalizePageSizeOptions(value);
      if (normalized.length === 0) {
        return value; // 校验会在 validateGeneralSetting 中拦截
      }
      return normalized.join(',');
    }

    // 邮箱域名白名单：保存时规范化为统一 JSON 格式。
    if (key === 'auth.emailDomainWhitelist' && value) {
      return this.normalizeEmailDomainWhitelist(value);
    }

    return value;
  }

  private parseLoginAgreementDocuments(raw: string | null | undefined) {
    try {
      return parseLoginAgreementDocuments(raw);
    } catch (error) {
      if (error instanceof LoginAgreementValidationError) {
        throw domainError(ERROR_CODES.VALIDATION_ERROR, error.message, 400);
      }
      throw error;
    }
  }
}
