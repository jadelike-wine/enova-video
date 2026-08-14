import { describe, expect, it, vi } from 'vitest';
import { SettingsAdminService } from './settings.admin.service.js';

function makeSettings() {
  return {
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((key) => [key, key === 'general.loginAgreementDocuments' ? '[]' : 'false']))),
    getString: vi.fn(async () => '[]'),
    update: vi.fn(async () => undefined),
    updateGroup: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
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
});
