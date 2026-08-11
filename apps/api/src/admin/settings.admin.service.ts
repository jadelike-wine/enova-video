import { Inject, Injectable } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { isRegisteredSetting } from '@enova/db';
import { SettingsService, type SettingValueView } from '../settings/settings.service.js';

/**
 * 系统配置管理（Admin）：读取/更新动态配置。
 * 敏感项（isSecret）在返回给后台时脱敏，避免明文泄露。
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** 列出全部配置（敏感值脱敏）。 */
  async list(): Promise<SettingValueView[]> {
    const views = await this.settings.list();
    return views.map((v) => (v.isSecret ? { ...v, value: v.value ? '••••••' : '' } : v));
  }

  /** 更新单个配置。 */
  async update(key: string, value: string): Promise<SettingValueView> {
    if (!isRegisteredSetting(key)) {
      throw domainError(ERROR_CODES.VALIDATION_ERROR, `Unknown setting key: ${key}`, 400);
    }
    await this.settings.set(key, value);
    const views = await this.settings.list();
    const view = views.find((v) => v.key === key)!;
    return view.isSecret ? { ...view, value: view.value ? '••••••' : '' } : view;
  }
}