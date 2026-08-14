import { describe, expect, it, vi } from 'vitest';
import { LoginAgreementService } from './login-agreement.service.js';

function makeSettings(values: Record<string, string>) {
  return {
    getMany: vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, values[key] ?? null])),
    ),
  };
}

describe('LoginAgreementService', () => {
  it('builds a public config from settings and exposes metadata without markdown', async () => {
    const settings = makeSettings({
      'general.loginAgreementEnabled': 'true',
      'general.loginAgreementMode': 'checkbox',
      'general.loginAgreementUpdatedAt': '2026-08-14',
      'general.loginAgreementDocuments': JSON.stringify([
        { slug: 'terms', title: '服务条款', contentMd: '# 内容' },
      ]),
    });
    const service = new LoginAgreementService(settings as never, undefined as never);

    await expect(service.getPublicConfig()).resolves.toMatchObject({
      enabled: true,
      mode: 'checkbox',
      updatedAt: '2026-08-14',
      documents: [{ slug: 'terms', title: '服务条款' }],
    });
    const config = await service.getConfig();
    expect(config.documents[0].contentMd).toBe('# 内容');
  });

  it('requires the current revision before authentication can continue', async () => {
    const settings = makeSettings({
      'general.loginAgreementEnabled': 'true',
      'general.loginAgreementMode': 'modal',
      'general.loginAgreementUpdatedAt': '2026-08-14',
      'general.loginAgreementDocuments': JSON.stringify([
        { slug: 'terms', title: '服务条款', contentMd: '# 内容' },
      ]),
    });
    const service = new LoginAgreementService(settings as never, undefined as never);
    const config = await service.getConfig();

    await expect(service.assertCurrentRevision(undefined)).rejects.toMatchObject({
      code: 'AGREEMENT_REQUIRED',
    });
    await expect(service.assertCurrentRevision('stale')).rejects.toMatchObject({
      code: 'AGREEMENT_OUTDATED',
    });
    await expect(service.assertCurrentRevision(config.revision)).resolves.toBeUndefined();
  });
});
