import { describe, expect, it } from 'vitest';
import {
  buildLoginAgreementRevision,
  normalizeLoginAgreementDocuments,
  parseLoginAgreementDocuments,
} from './login-agreement.js';

describe('login agreement document normalization', () => {
  it('normalizes slugs and trims document fields before publishing', () => {
    expect(
      normalizeLoginAgreementDocuments([
        { slug: ' Terms / Service ', title: ' 服务条款 ', contentMd: '  # Terms  ' },
      ]),
    ).toEqual([
      { slug: 'terms-service', title: '服务条款', contentMd: '# Terms' },
    ]);
  });

  it('rejects malformed or duplicate documents instead of silently publishing them', () => {
    expect(() => parseLoginAgreementDocuments('{"slug":"terms"}')).toThrow(
      'documents must be an array',
    );
    expect(() =>
      normalizeLoginAgreementDocuments([
        { slug: 'terms', title: '服务条款', contentMd: '# 1' },
        { slug: ' TERMS ', title: '另一份条款', contentMd: '# 2' },
      ]),
    ).toThrow('duplicate document slug');
  });

  it('produces a deterministic revision that changes when content changes', () => {
    const documents = [{ slug: 'terms', title: '服务条款', contentMd: '# v1' }];
    const first = buildLoginAgreementRevision('2026-08-14', documents);
    expect(first).toBe(buildLoginAgreementRevision('2026-08-14', documents));
    expect(first).not.toBe(buildLoginAgreementRevision('2026-08-14', [{ ...documents[0], contentMd: '# v2' }]));
  });
});
