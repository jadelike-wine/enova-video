import { describe, expect, it } from 'vitest';
import { PublicLoginAgreementController } from './public-login-agreement.controller.js';

describe('PublicLoginAgreementController', () => {
  it('returns public agreement metadata and legal document content', async () => {
    const service = {
      getPublicConfig: async () => ({
        enabled: true,
        mode: 'modal' as const,
        updatedAt: '2026-08-14',
        revision: 'revision',
        documents: [{ slug: 'terms', title: '服务条款' }],
      }),
      getDocument: async (slug: string) => ({ slug, title: '服务条款', contentMd: '# 内容' }),
    };
    const controller = new PublicLoginAgreementController(service as never);

    await expect(controller.getConfig()).resolves.toMatchObject({ enabled: true });
    await expect(controller.getLegalDocument('terms')).resolves.toEqual({
      slug: 'terms',
      title: '服务条款',
      contentMd: '# 内容',
    });
  });
});
