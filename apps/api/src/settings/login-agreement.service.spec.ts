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

  it('extracts slug from full route path and normalizes it', async () => {
    const settings = makeSettings({
      'general.loginAgreementEnabled': 'true',
      'general.loginAgreementMode': 'modal',
      'general.loginAgreementUpdatedAt': '2026-08-14',
      'general.loginAgreementDocuments': JSON.stringify([
        { slug: '/legal/terms', title: '服务条款', contentMd: '# 内容' },
        { slug: '/legal/usage-policy', title: '使用政策', contentMd: '# 使用政策' },
      ]),
    });
    const service = new LoginAgreementService(settings as never, undefined as never);
    const config = await service.getConfig();

    expect(config.documents).toHaveLength(2);
    expect(config.documents[0].slug).toBe('terms');
    expect(config.documents[1].slug).toBe('usage-policy');
  });

  it('retrieves document by slug even when stored as full route path', async () => {
    const settings = makeSettings({
      'general.loginAgreementEnabled': 'true',
      'general.loginAgreementMode': 'modal',
      'general.loginAgreementUpdatedAt': '2026-08-14',
      'general.loginAgreementDocuments': JSON.stringify([
        { slug: '/legal/terms', title: '服务条款', contentMd: '# 内容' },
      ]),
    });
    const service = new LoginAgreementService(settings as never, undefined as never);

    const doc = await service.getDocument('terms');
    expect(doc.title).toBe('服务条款');
    expect(doc.contentMd).toBe('# 内容');
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
