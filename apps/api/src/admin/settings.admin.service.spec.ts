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
  it('rejects fractional default table page sizes', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(service.update('table.defaultPageSize', '20.5')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateGroup([{ key: 'table.defaultPageSize', value: '20.5' }])).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
    expect(settings.updateGroup).not.toHaveBeenCalled();
  });

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

  it('rejects malformed agreement update date format', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.update('general.loginAgreementUpdatedAt', '2026/08/14'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates for agreement update date', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.update('general.loginAgreementUpdatedAt', '2026-13-45'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('accepts valid YYYY-MM-DD agreement update dates', async () => {
    const settings = makeSettings();
    settings.list = vi.fn(async () => [
      { key: 'general.loginAgreementUpdatedAt', value: '2026-08-14', isSecret: false },
    ]);
    const service = new SettingsAdminService(settings as never);

    await service.update('general.loginAgreementUpdatedAt', '2026-08-14');
    expect(settings.update).toHaveBeenCalledWith(
      'general.loginAgreementUpdatedAt',
      '2026-08-14',
      {},
    );
  });

  it('rejects malformed agreement update date in batch mode', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.updateGroup([{ key: 'general.loginAgreementUpdatedAt', value: 'not-a-date' }]),
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

  it('accepts a valid base64 logo that exceeds the old 4000-char DTO limit', async () => {
    const settings = makeSettings();
    settings.list = vi.fn(async () => [
      { key: 'general.siteLogo', value: '', isSecret: false },
    ]);
    const service = new SettingsAdminService(settings as never);

    // A small PNG base64 data URI (e.g. 5000 chars) should pass service-level validation.
    const logoValue = `data:image/png;base64,${'A'.repeat(5000)}`;
    await service.update('general.siteLogo', logoValue);
    expect(settings.update).toHaveBeenCalledWith(
      'general.siteLogo',
      logoValue,
      {},
    );
  });

  it('accepts a valid base64 logo in batch update mode', async () => {
    const settings = makeSettings();
    settings.list = vi.fn(async () => [
      { key: 'general.siteLogo', value: '', isSecret: false },
    ]);
    const service = new SettingsAdminService(settings as never);

    const logoValue = `data:image/png;base64,${'A'.repeat(5000)}`;
    await service.updateGroup([{ key: 'general.siteLogo', value: logoValue }]);
    expect(settings.updateGroup).toHaveBeenCalledWith(
      [{ key: 'general.siteLogo', value: logoValue }],
      {},
    );
  });

  it('rejects invalid URL settings in a batch and preserves existing security guards', async () => {
    const settings = makeSettings();
    const service = new SettingsAdminService(settings as never);

    await expect(
      service.updateGroup([
        { key: 'general.docUrl', value: 'ftp://docs.example.com' },
        { key: 'payment.mode', value: 'sandbox' },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(settings.updateGroup).not.toHaveBeenCalled();
  });
});
