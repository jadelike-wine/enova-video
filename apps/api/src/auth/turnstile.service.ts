import { Inject, Injectable } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { SettingsService } from '../settings/settings.service.js';

export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string;
}

interface SiteVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile 人机验证服务。
 * 未启用或未配置时校验直接放行（便于本地/封闭私网部署）；启用后校验失败即拒绝。
 */
@Injectable()
export class TurnstileService {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  /** 公开配置：是否启用 + site key（site key 仅用于前端渲染，非敏感）。 */
  async getConfig(): Promise<TurnstileConfig> {
    const enabled = (await this.settings.getBoolean('auth.turnstileEnabled')) ?? false;
    const siteKey = (await this.settings.getString('auth.turnstileSiteKey'))?.trim() ?? '';
    return { enabled, siteKey };
  }

  /** 校验 Turnstile token；未启用时直接放行。 */
  async verify(token: string | undefined, remoteIP: string): Promise<void> {
    const { enabled } = await this.getConfig();
    if (!enabled) return;

    const secretKey = (await this.settings.getString('auth.turnstileSecretKey'))?.trim() ?? '';
    if (!secretKey) {
      throw domainError(ERROR_CODES.TURNSTILE_NOT_CONFIGURED, 'Turnstile is not configured', 503);
    }
    if (!token) {
      throw domainError(ERROR_CODES.TURNSTILE_VERIFICATION_FAILED, 'Turnstile verification failed', 400);
    }

    const body = new URLSearchParams();
    body.set('secret', secretKey);
    body.set('response', token);
    if (remoteIP) body.set('remoteip', remoteIP);

    let result: SiteVerifyResponse;
    try {
      const resp = await fetch(VERIFY_URL, { method: 'POST', body });
      result = (await resp.json()) as SiteVerifyResponse;
    } catch {
      throw domainError(ERROR_CODES.TURNSTILE_VERIFICATION_FAILED, 'Turnstile verification failed', 400);
    }

    if (!result.success) {
      throw domainError(ERROR_CODES.TURNSTILE_VERIFICATION_FAILED, 'Turnstile verification failed', 400);
    }
  }
}
