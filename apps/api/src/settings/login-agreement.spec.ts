import { describe, expect, it } from 'vitest';
import {
  buildLoginAgreementRevision,
  normalizeLoginAgreementDocuments,
  parseLoginAgreementDocuments,
  validateLoginAgreementDate,
  DEFAULT_LOGIN_AGREEMENT_DOCUMENTS,
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

  it('extracts slug from full route path starting with /', () => {
    expect(
      normalizeLoginAgreementDocuments([
        { slug: '/legal/terms', title: '服务条款', contentMd: '# Terms' },
        { slug: '/legal/usage-policy', title: '使用政策', contentMd: '# Usage' },
      ]),
    ).toEqual([
      { slug: 'terms', title: '服务条款', contentMd: '# Terms' },
      { slug: 'usage-policy', title: '使用政策', contentMd: '# Usage' },
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

  it('rejects duplicate routes that normalize to the same slug', () => {
    expect(() =>
      normalizeLoginAgreementDocuments([
        { slug: '/legal/terms', title: '服务条款', contentMd: '# 1' },
        { slug: '/legal/Terms', title: '另一份条款', contentMd: '# 2' },
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

describe('login agreement date validation', () => {
  it('accepts valid YYYY-MM-DD dates', () => {
    expect(validateLoginAgreementDate('2026-08-14')).toBe('2026-08-14');
    expect(validateLoginAgreementDate(' 2026-01-01 ')).toBe('2026-01-01');
  });

  it('allows empty values to represent unset dates', () => {
    expect(validateLoginAgreementDate('')).toBe('');
    expect(validateLoginAgreementDate(null)).toBe('');
    expect(validateLoginAgreementDate(undefined)).toBe('');
  });

  it('rejects malformed date strings', () => {
    expect(() => validateLoginAgreementDate('2026/08/14')).toThrow('YYYY-MM-DD');
    expect(() => validateLoginAgreementDate('08-14-2026')).toThrow('YYYY-MM-DD');
    expect(() => validateLoginAgreementDate('not-a-date')).toThrow('YYYY-MM-DD');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => validateLoginAgreementDate('2026-13-01')).toThrow('not a valid calendar date');
    expect(() => validateLoginAgreementDate('2026-02-31')).toThrow('not a valid calendar date');
  });
});

describe('default login agreement documents', () => {
  it('provides four default documents with expected slugs and titles', () => {
    expect(DEFAULT_LOGIN_AGREEMENT_DOCUMENTS).toHaveLength(4);
    const slugs = DEFAULT_LOGIN_AGREEMENT_DOCUMENTS.map((doc) => doc.slug);
    expect(slugs).toEqual(['terms', 'usage-policy', 'supported-regions', 'service-specific-terms']);
    const titles = DEFAULT_LOGIN_AGREEMENT_DOCUMENTS.map((doc) => doc.title);
    expect(titles).toEqual(['服务条款', '使用政策', '支持的国家和地区', '服务特定条款']);
  });

  it('passes normalization without errors', () => {
    expect(() => normalizeLoginAgreementDocuments(DEFAULT_LOGIN_AGREEMENT_DOCUMENTS)).not.toThrow();
  });
});
