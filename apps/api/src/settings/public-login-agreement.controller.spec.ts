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
    const settingsService = {
      getString: async () => 'https://example.com',
    };
    const controller = new PublicLoginAgreementController(service as never, settingsService as never);

    await expect(controller.getConfig()).resolves.toMatchObject({ enabled: true });
    await expect(controller.getLegalDocument('terms')).resolves.toEqual({
      slug: 'terms',
      title: '服务条款',
      contentMd: '# 内容',
    });
  });

  it('returns site URL from settings', async () => {
    const agreementService = {
      getPublicConfig: async () => ({}),
      getDocument: async () => ({}),
    };
    const settingsService = {
      getString: async () => 'https://example.com',
      getMany: async (keys: string[]) => {
        const map = new Map<string, string | null>();
        for (const key of keys) {
          if (key === 'general.siteUrl') map.set(key, 'https://example.com');
          else if (key === 'general.siteName') map.set(key, 'TestSite');
          else if (key === 'table.defaultPageSize') map.set(key, '50');
          else if (key === 'table.pageSizeOptions') map.set(key, '10,20,50');
          else map.set(key, null);
        }
        return map;
      },
    };
    const controller = new PublicLoginAgreementController(agreementService as never, settingsService as never);
    const result = await controller.getSiteConfig();
    expect(result.siteUrl).toBe('https://example.com');
    expect(result.siteName).toBe('TestSite');
    expect(result.tableDefaultPageSize).toBe(50);
    expect(result.tablePageSizeOptions).toEqual([10, 20, 50]);
  });

  it('falls back to localhost when site URL is not configured', async () => {
    const agreementService = {
      getPublicConfig: async () => ({}),
      getDocument: async () => ({}),
    };
    const settingsService = {
      getString: async () => null,
      getMany: async () => new Map<string, string | null>(),
    };
    const controller = new PublicLoginAgreementController(agreementService as never, settingsService as never);
    const result = await controller.getSiteConfig();
    expect(result.siteUrl).toBe('http://localhost:3000');
    expect(result.siteName).toBe('EnovaMotion');
    expect(result.tableDefaultPageSize).toBe(20);
    expect(result.tablePageSizeOptions).toEqual([10, 20, 50, 100]);
    expect(result.customMenuItems).toEqual([]);
    expect(result.hideCcsImportButton).toBe(false);
  });
});
