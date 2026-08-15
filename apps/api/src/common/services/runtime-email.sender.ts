import { ConsoleEmailSender } from './console-email.sender.js';
import { DisabledEmailSender } from './disabled-email.sender.js';
import { SmtpEmailSender, type SmtpEmailOptions } from './smtp-email.sender.js';
import type { EmailSender } from './email-sender.interface.js';
import { createTransport } from 'nodemailer';
import { validateSmtpHost, type UrlGuardOptions } from '@enova/provider';

export interface RuntimeEmailSettings {
  getMany(keys: string[]): Promise<Map<string, string | null>>;
  getBoolean?(key: string): Promise<boolean | null>;
  getString?(key: string): Promise<string | null>;
}

export interface RuntimeEmailEnvironment {
  NODE_ENV: string;
  SSRF_ALLOW_HTTP?: boolean;
  SSRF_RESOLVE_DNS?: boolean;
  SSRF_DEV_ALLOW_LIST?: string;
}

/**
 * Partial SMTP config from the admin "test connection" form.
 * Empty/null fields will be filled from saved settings.
 */
export interface SmtpTestConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
}

type SmtpSender = EmailSender & { sendTestEmail(to: string): Promise<void> };
type SmtpFactory = (options: SmtpEmailOptions) => SmtpSender;

const EMAIL_SETTING_KEYS = [
  'email.smtpHost',
  'email.smtpPort',
  'email.smtpSecure',
  'email.smtpUser',
  'email.smtpPassword',
  'email.smtpFromName',
  'email.smtpFromEmail',
  'email.passwordResetUrl',
  'email.emailVerifyUrl',
  'general.appName',
  'general.siteUrl',
];

const SSRF_SETTING_KEYS = [
  'ssrf.allowHttp',
  'ssrf.resolveDns',
  'ssrf.devAllowList',
];

/** SMTP 连接测试超时（毫秒），避免指向接受连接但不发 SMTP greeting 的主机长时间挂起。 */
const SMTP_TEST_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_TEST_SOCKET_TIMEOUT_MS = 10_000;

/**
 * Runtime email adapter.
 *
 * The existing email sender was constructed once from ENV. This delegating
 * adapter reads the registered settings before each email operation, so a DB
 * update takes effect immediately while preserving Console/Disabled behavior.
 */
export class RuntimeEmailSender implements EmailSender {
  private delegate: EmailSender | null = null;
  private delegateSignature: string | null = null;

  constructor(
    private readonly settings: RuntimeEmailSettings,
    private readonly env: RuntimeEmailEnvironment,
    private readonly createSmtp: SmtpFactory = (options) => new SmtpEmailSender(options),
  ) {}

  async sendPasswordReset(opts: { email: string; resetToken: string }): Promise<void> {
    const sender = await this.currentSender();
    await sender.sendPasswordReset(opts);
  }

  async sendEmailVerification(opts: { email: string; verifyToken: string }): Promise<void> {
    const sender = await this.currentSender();
    await sender.sendEmailVerification(opts);
  }

  async isSmtpConfigured(): Promise<boolean> {
    const sender = await this.currentSender();
    return this.isSmtpSender(sender);
  }

  async sendTestEmail(to: string): Promise<void> {
    const sender = await this.currentSender();
    if (!this.isSmtpSender(sender)) {
      throw new Error('SMTP email sender is not configured');
    }
    await sender.sendTestEmail(to);
  }

  /**
   * Test SMTP connection using form-provided config, falling back to saved settings
   * for any empty field. Uses nodemailer.verify() — no email is sent.
   *
   * 安全：对 host 复用 @enova/provider 的 SSRF 防护（拒绝私网/链路本地地址、DNS 解析后再校验），
   * 并为 transport 显式设置超时，避免探测内网或长时间挂起。
   */
  async testSmtpConnection(config?: SmtpTestConfig): Promise<void> {
    const allKeys = [...EMAIL_SETTING_KEYS, ...SSRF_SETTING_KEYS];
    const values = await this.settings.getMany(allKeys);
    const get = (key: string, fallback = '') => values.get(key) ?? fallback;

    const host = (config?.host ?? '').trim() || get('email.smtpHost').trim();
    const user = (config?.user ?? '').trim() || get('email.smtpUser').trim();
    const password = config?.password ?? get('email.smtpPassword') ?? '';
    const port = config?.port && config.port > 0 ? config.port : Number(get('email.smtpPort', '587')) || 587;
    const secure = config?.secure ?? ['1', 'true', 'yes', 'on'].includes(get('email.smtpSecure', 'false').toLowerCase());

    if (!host) {
      throw new Error('SMTP host is required');
    }

    // SSRF 防护：对 SMTP host 做与 Provider base_url 同等强度的校验。
    const guard = await this.guardOptions(values);
    await validateSmtpHost(host, guard);

    const transporter = createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      auth: user || password ? { user, pass: password } : undefined,
      connectionTimeout: SMTP_TEST_CONNECTION_TIMEOUT_MS,
      socketTimeout: SMTP_TEST_SOCKET_TIMEOUT_MS,
      greetingTimeout: SMTP_TEST_CONNECTION_TIMEOUT_MS,
    });

    try {
      await transporter.verify();
    } finally {
      transporter.close();
    }
  }

  private async currentSender(): Promise<EmailSender> {
    const values = await this.settings.getMany(EMAIL_SETTING_KEYS);
    if (this.env.NODE_ENV === 'development' || this.env.NODE_ENV === 'test') {
      if (this.delegateSignature !== 'console') {
        this.delegate = new ConsoleEmailSender();
        this.delegateSignature = 'console';
      }
      return this.delegate!;
    }

    const options = this.smtpOptions(values);
    if (!options) {
      if (this.delegateSignature !== 'disabled') {
        this.delegate = new DisabledEmailSender();
        this.delegateSignature = 'disabled';
      }
      return this.delegate!;
    }

    const signature = JSON.stringify(options);
    if (this.delegateSignature !== signature) {
      this.delegate = this.createSmtp(options);
      this.delegateSignature = signature;
    }
    return this.delegate!;
  }

  private smtpOptions(values: Map<string, string | null>): SmtpEmailOptions | null {
    const get = (key: string, fallback = '') => values.get(key) ?? fallback;
    const host = get('email.smtpHost').trim();
    const user = get('email.smtpUser').trim();
    const password = get('email.smtpPassword');
    const fromEmail = get('email.smtpFromEmail').trim();
    if (!host || !user || !password || !fromEmail) return null;

    const port = Number(get('email.smtpPort', '587'));
    return {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: ['1', 'true', 'yes', 'on'].includes(get('email.smtpSecure', 'false').toLowerCase()),
      user,
      password,
      fromName: get('email.smtpFromName', 'EnovaMotion'),
      fromEmail,
      resetUrl: this.resolveEmailUrl(values, 'email.passwordResetUrl', '/zh-CN/auth/reset-password'),
      verifyUrl: this.resolveEmailUrl(values, 'email.emailVerifyUrl', '/zh-CN/auth/verify-email'),
      appName: get('general.appName', 'EnovaMotion'),
    };
  }

  /**
   * 解析邮件链接地址：优先使用单独配置的 URL，否则基于 general.siteUrl 自动生成。
   */
  private resolveEmailUrl(
    values: Map<string, string | null>,
    urlKey: string,
    path: string,
  ): string {
    const configured = values.get(urlKey);
    const configuredUrl = configured?.trim() ?? '';
    const localDefault = `http://localhost:3000${path}`;
    if (configuredUrl && configuredUrl !== localDefault) return configuredUrl;

    // fallback 到 general.siteUrl
    const siteUrl = (values.get('general.siteUrl') ?? '').trim();
    if (siteUrl) {
      const base = siteUrl.replace(/\/+$/, '');
      return `${base}${path}`;
    }

    if (configuredUrl) return configuredUrl;

    // 最终兜底（仅开发环境可能用到）
    return `http://localhost:3000${path}`;
  }

  private isSmtpSender(sender: EmailSender): sender is SmtpSender {
    return typeof (sender as Partial<SmtpSender>).sendTestEmail === 'function';
  }

  /** 从动态配置（或 env fallback）读取 SSRF guard 选项，与 ProvidersAdminService 保持一致。 */
  private async guardOptions(values: Map<string, string | null>): Promise<UrlGuardOptions> {
    const getStr = (key: string) => values.get(key);
    const allowHttpStr = getStr('ssrf.allowHttp');
    const resolveDnsStr = getStr('ssrf.resolveDns');
    const devAllowListStr = getStr('ssrf.devAllowList');

    // 优先使用 getBoolean/getString（SettingsService 提供），回退到 getMany 原始值解析，最后回退到 env。
    const allowHttp = this.settings.getBoolean
      ? (await this.settings.getBoolean('ssrf.allowHttp')) ?? this.env.SSRF_ALLOW_HTTP ?? false
      : allowHttpStr != null ? ['1', 'true', 'yes', 'on'].includes(allowHttpStr.toLowerCase()) : this.env.SSRF_ALLOW_HTTP ?? false;

    const resolveDns = this.settings.getBoolean
      ? (await this.settings.getBoolean('ssrf.resolveDns')) ?? this.env.SSRF_RESOLVE_DNS ?? true
      : resolveDnsStr != null ? ['1', 'true', 'yes', 'on'].includes(resolveDnsStr.toLowerCase()) : this.env.SSRF_RESOLVE_DNS ?? true;

    const devAllowList = this.settings.getString
      ? (await this.settings.getString('ssrf.devAllowList')) ?? this.env.SSRF_DEV_ALLOW_LIST ?? ''
      : devAllowListStr ?? this.env.SSRF_DEV_ALLOW_LIST ?? '';

    return {
      allowHttp,
      resolveDns,
      devAllowlist: this.env.NODE_ENV !== 'production'
        ? devAllowList.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    };
  }
}
