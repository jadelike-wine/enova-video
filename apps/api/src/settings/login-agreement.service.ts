import { Inject, Injectable } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { SettingsService } from './settings.service.js';
import {
  buildLoginAgreementRevision,
  parseLoginAgreementDocuments,
  type LoginAgreementDocument,
} from './login-agreement.js';

const AGREEMENT_KEYS = [
  'general.loginAgreementEnabled',
  'general.loginAgreementMode',
  'general.loginAgreementUpdatedAt',
  'general.loginAgreementDocuments',
] as const;

export interface LoginAgreementConfig {
  enabled: boolean;
  mode: 'modal' | 'checkbox';
  updatedAt: string;
  revision: string;
  documents: LoginAgreementDocument[];
}

export interface PublicLoginAgreementConfig extends Omit<LoginAgreementConfig, 'documents'> {
  documents: Array<Pick<LoginAgreementDocument, 'slug' | 'title'>>;
}

@Injectable()
export class LoginAgreementService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async getConfig(): Promise<LoginAgreementConfig> {
    const values = await this.settings.getMany([...AGREEMENT_KEYS]);
    const updatedAt = (values.get('general.loginAgreementUpdatedAt') ?? '').trim();
    const documents = parseLoginAgreementDocuments(values.get('general.loginAgreementDocuments'));
    const revision = buildLoginAgreementRevision(updatedAt, documents);
    const mode = values.get('general.loginAgreementMode') === 'checkbox' ? 'checkbox' : 'modal';
    const enabled = values.get('general.loginAgreementEnabled') === 'true' && documents.length > 0;

    return { enabled, mode, updatedAt, revision, documents };
  }

  async getPublicConfig(): Promise<PublicLoginAgreementConfig> {
    const config = await this.getConfig();
    return {
      enabled: config.enabled,
      mode: config.mode,
      updatedAt: config.updatedAt,
      revision: config.revision,
      documents: config.documents.map(({ slug, title }) => ({ slug, title })),
    };
  }

  async getDocument(slug: string): Promise<LoginAgreementDocument> {
    const config = await this.getConfig();
    const document = config.documents.find((item) => item.slug === slug);
    if (!document) {
      throw domainError(ERROR_CODES.NOT_FOUND, 'Legal document not found', 404);
    }
    return document;
  }

  async assertCurrentRevision(revision: string | undefined): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;
    if (!revision?.trim()) {
      throw domainError(ERROR_CODES.AGREEMENT_REQUIRED, 'Please accept the current agreement before continuing', 428);
    }
    if (revision.trim() !== config.revision) {
      throw domainError(ERROR_CODES.AGREEMENT_OUTDATED, 'The agreement has changed. Please review and accept it again', 409);
    }
  }
}
