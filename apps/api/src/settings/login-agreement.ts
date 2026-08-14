import { createHash } from 'node:crypto';

export const LOGIN_AGREEMENT_MAX_DOCUMENTS = 20;
export const LOGIN_AGREEMENT_MAX_SLUG_LENGTH = 80;
export const LOGIN_AGREEMENT_MAX_TITLE_LENGTH = 200;
export const LOGIN_AGREEMENT_MAX_CONTENT_LENGTH = 500_000;

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

function normalizeSlug(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new LoginAgreementValidationError('document slug must be a string');
  }

  const slug = raw
    .trim()
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
