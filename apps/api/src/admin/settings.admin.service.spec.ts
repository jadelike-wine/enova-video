import { describe, expect, it, vi } from 'vitest';
import { SettingsAdminService } from './settings.admin.service.js';

function makeSettings() {
  return {
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, key === 'general.loginAgreementDocuments' ? '[]' : 'false']))),
    update: vi.fn(async () => undefined),
    updateGroup: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    getBoolean: vi.fn(async () => false),
    getString: vi.fn(async (key: string) => key === 'ssrf.devAllowList' ? '' : null),
  };
}

describe('SettingsAdminService login agreement validation', () => {
  it('rejects malformed agreement JSON before writing settings', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.update('general.loginAgreementDocuments', '{bad json'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('requires at least one document when enabling the agreement', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.updateGroup([{ key: 'general.loginAgreementEnabled', value: 'true' }]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.updateGroup).not.toHaveBeenCalled();
  });

  it('rejects storage tests with the actionable configuration message', async () => {
    const settings = makeSettings();
    settings.getStorageConfig = vi.fn().mockResolvedValue({ provider: 'aws_s3', configured: false });
    const service = new SettingsAdminService(settings as never);

    await expect(service.testStorage()).rejects.toMatchObject({ statusCode: 400, message: '请配置对象存储' });
  });

  it('normalizes the documented uppercase log level values', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await service.updateGroup([{ key: 'log.level', value: 'WARNING' }]);

    expect(settings.updateGroup).toHaveBeenCalledWith(
      [{ key: 'log.level', value: 'warn' }],
      {},
    );
  });

  it('rejects malformed custom menu items before a single update', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.update('general.customMenuItems', JSON.stringify([{
        id: 'docs',
        label: '文档',
        url: 'https://docs.example.com',
        enabled: true,
        visibility: 'user',
        sortOrder: 0,
      }])),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('rejects invalid custom endpoints in a batch before writing', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.updateGroup([{
        key: 'general.customEndpoints',
        value: JSON.stringify([{
          id: 'api',
          name: '',
          url: 'javascript:alert(1)',
          description: '',
          sortOrder: 1,
        }]),
      }]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.updateGroup).not.toHaveBeenCalled();
  });

  it('rejects oversized menus and unsupported visibility values', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: `menu-${index}`,
      label: `菜单 ${index}`,
      url: 'https://docs.example.com',
      visibility: 'user',
      enabled: true,
      sortOrder: index + 1,
    }));

    await expect(
      service.update('general.customMenuItems', JSON.stringify(items)),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.update('general.customMenuItems', JSON.stringify([{
        id: 'docs',
        label: '文档',
        url: 'https://docs.example.com',
        visibility: 'everyone',
        enabled: true,
        sortOrder: 1,
      }])),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('rejects oversized logos and non-http documentation URLs', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.update('general.siteLogo', `data:image/png;base64,${'A'.repeat(410_000)}`),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.update('general.docUrl', 'javascript:alert(1)'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('rejects invalid URL settings in a batch and preserves existing security guards', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.updateGroup([
        { key: 'general.apiBaseUrl', value: 'ftp://api.example.com' },
        { key: 'payment.mode', value: 'sandbox' },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.updateGroup).not.toHaveBeenCalled();
  });
});
