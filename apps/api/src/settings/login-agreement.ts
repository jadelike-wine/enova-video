import { createHash } from 'node:crypto';

export const LOGIN_AGREEMENT_MAX_DOCUMENTS = 20;
export const LOGIN_AGREEMENT_MAX_SLUG_LENGTH = 80;
export const LOGIN_AGREEMENT_MAX_TITLE_LENGTH = 200;
export const LOGIN_AGREEMENT_MAX_CONTENT_LENGTH = 500_000;

/** 日期格式校验：YYYY-MM-DD */
export const LOGIN_AGREEMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 路由标识前缀：所有文档路由必须以此开头 */
export const LOGIN_AGREEMENT_ROUTE_PREFIX = '/legal/';

/** 默认提供的协议文档 */
export const DEFAULT_LOGIN_AGREEMENT_DOCUMENTS = [
  { slug: 'terms', title: '服务条款', contentMd: '# 服务条款\n\n请在此编辑服务条款内容。' },
  { slug: 'usage-policy', title: '使用政策', contentMd: '# 使用政策\n\n请在此编辑使用政策内容。' },
  { slug: 'supported-regions', title: '支持的国家和地区', contentMd: '# 支持的国家和地区\n\n请在此编辑支持的国家和地区内容。' },
  { slug: 'service-specific-terms', title: '服务特定条款', contentMd: '# 服务特定条款\n\n请在此编辑服务特定条款内容。' },
] as const;

export interface LoginAgreementDocument {
  slug: string;
  title: string;
  contentMd: string;
}

export class LoginAgreementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginAgreementValidationError';
  }
}

/**
 * 从路由标识中提取 slug。
 *
 * 路由标识可以是完整路径（如 `/legal/terms`）或纯 slug（如 `terms`）。
 * 如果以 `/` 开头，取最后一段路径作为 slug 来源；否则直接使用输入值。
 * 最终 slug 经过规范化（小写、非字母数字转连字符、去首尾连字符）。
 */
function normalizeSlug(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new LoginAgreementValidationError('document slug must be a string');
  }

  let input = raw.trim();
  // 如果以 / 开头（完整路由路径），提取最后一段。
  if (input.startsWith('/')) {
    const segments = input.split('/').filter(Boolean);
    input = segments.length > 0 ? segments[segments.length - 1] : '';
  }

  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new LoginAgreementValidationError('document slug must contain a-z or 0-9');
  }
  if (slug.length > LOGIN_AGREEMENT_MAX_SLUG_LENGTH) {
    throw new LoginAgreementValidationError(`document slug must be <= ${LOGIN_AGREEMENT_MAX_SLUG_LENGTH} characters`);
  }
  return slug;
}

/** 校验条款更新日期格式（YYYY-MM-DD）。空值允许通过（表示未设置）。 */
export function validateLoginAgreementDate(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  if (!LOGIN_AGREEMENT_DATE_PATTERN.test(trimmed)) {
    throw new LoginAgreementValidationError('terms update date must be in YYYY-MM-DD format');
  }
  // 校验真实日期
  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new LoginAgreementValidationError('terms update date is not a valid calendar date');
  }
  return trimmed;
}

export function normalizeLoginAgreementDocuments(raw: unknown): LoginAgreementDocument[] {
  if (!Array.isArray(raw)) {
    throw new LoginAgreementValidationError('documents must be an array');
  }
  if (raw.length > LOGIN_AGREEMENT_MAX_DOCUMENTS) {
    throw new LoginAgreementValidationError(`documents must contain <= ${LOGIN_AGREEMENT_MAX_DOCUMENTS} items`);
  }

  const documents: LoginAgreementDocument[] = [];
  const slugs = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new LoginAgreementValidationError('each document must be an object');
    }
    const value = item as { slug?: unknown; title?: unknown; contentMd?: unknown };
    const slug = normalizeSlug(value.slug);
    if (typeof value.title !== 'string' || !value.title.trim()) {
      throw new LoginAgreementValidationError('document title cannot be empty');
    }
    if (typeof value.contentMd !== 'string') {
      throw new LoginAgreementValidationError('document contentMd must be a string');
    }

    const title = value.title.trim();
    const contentMd = value.contentMd.trim();
    if (title.length > LOGIN_AGREEMENT_MAX_TITLE_LENGTH) {
      throw new LoginAgreementValidationError(`document title must be <= ${LOGIN_AGREEMENT_MAX_TITLE_LENGTH} characters`);
    }
    if (contentMd.length > LOGIN_AGREEMENT_MAX_CONTENT_LENGTH) {
      throw new LoginAgreementValidationError(`document contentMd must be <= ${LOGIN_AGREEMENT_MAX_CONTENT_LENGTH} characters`);
    }
    if (slugs.has(slug)) {
      throw new LoginAgreementValidationError(`duplicate document slug: ${slug}`);
    }
    slugs.add(slug);
    documents.push({ slug, title, contentMd });
  }
  return documents;
}

export function parseLoginAgreementDocuments(raw: string | null | undefined): LoginAgreementDocument[] {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new LoginAgreementValidationError('documents must be valid JSON');
  }
  return normalizeLoginAgreementDocuments(parsed);
}

export function buildLoginAgreementRevision(
  updatedAt: string,
  documents: LoginAgreementDocument[],
): string {
  const canonical = JSON.stringify({
    updatedAt: updatedAt.trim(),
    documents: normalizeLoginAgreementDocuments(documents),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
