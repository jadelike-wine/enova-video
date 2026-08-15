import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { LoginAgreementService } from './login-agreement.service.js';
import { SettingsService } from './settings.service.js';

class PublicLoginAgreementDocumentDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  title!: string;
}

class PublicLoginAgreementDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ enum: ['modal', 'checkbox'] })
  mode!: 'modal' | 'checkbox';

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty()
  revision!: string;

  @ApiProperty({ type: [PublicLoginAgreementDocumentDto] })
  documents!: PublicLoginAgreementDocumentDto[];
}

class LegalDocumentDto extends PublicLoginAgreementDocumentDto {
  @ApiProperty()
  contentMd!: string;
}

/** 自定义菜单项 DTO（公开接口返回）。 */
class PublicCustomMenuItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  visibility!: 'user' | 'admin';

  @ApiProperty()
  sortOrder!: number;
}

/** 从 JSON 解析出的原始菜单项结构（字段均可能缺失或类型不符）。 */
interface RawCustomMenuItem {
  id?: unknown;
  label?: unknown;
  url?: unknown;
  visibility?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
}

class PublicSiteConfigDto {
  @ApiProperty({ example: 'https://example.com' })
  siteUrl!: string;

  @ApiProperty({ example: 'support@example.com' })
  supportEmail!: string;

  @ApiProperty({ example: 'EnovaMotion' })
  siteName!: string;

  @ApiProperty({ example: 'AI 智能创作平台' })
  siteSubtitle!: string;

  @ApiProperty({ example: 'https://example.com/logo.png' })
  siteLogo!: string;

  @ApiProperty({ example: 'support@example.com' })
  contactInfo!: string;

  @ApiProperty({ example: 'https://docs.example.com' })
  docUrl!: string;

  @ApiProperty({ example: '<p>Custom homepage</p>' })
  homeContent!: string;

  @ApiProperty()
  compactHomeEnabled!: boolean;

  @ApiProperty()
  hideCcsImportButton!: boolean;

  @ApiProperty({ type: [PublicCustomMenuItemDto] })
  customMenuItems!: PublicCustomMenuItemDto[];

  @ApiProperty({ example: 20 })
  tableDefaultPageSize!: number;

  @ApiProperty({ example: [10, 20, 50, 100] })
  tablePageSizeOptions!: number[];
}

/** 公开注册配置 DTO（无需登录，前端注册页消费）。 */
class PublicAuthConfigDto {
  @ApiProperty()
  openRegistration!: boolean;

  @ApiProperty()
  emailVerification!: boolean;

  @ApiProperty({ type: [String], description: '邮箱域名白名单（@domain 或 *.domain 格式）' })
  emailDomainWhitelist!: string[];

  @ApiProperty()
  nonWhitelistDomainLimit!: boolean;

  @ApiProperty()
  enablePromoCode!: boolean;

  @ApiProperty()
  requireInvitationCode!: boolean;

  @ApiProperty()
  enablePasswordReset!: boolean;

  @ApiProperty()
  turnstileEnabled!: boolean;

  @ApiProperty()
  turnstileSiteKey!: string;
}

/** 安全解析自定义菜单项 JSON，过滤无效/危险数据。 */
function parseCustomMenuItems(raw: string | null | undefined): PublicCustomMenuItemDto[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as RawCustomMenuItem[])
      .filter((item): item is RawCustomMenuItem => item !== null && typeof item === 'object')
      .filter((item) => typeof item.id === 'string' && typeof item.label === 'string' && typeof item.url === 'string')
      .filter((item) => (item.url as string).startsWith('http://') || (item.url as string).startsWith('https://'))
      .filter((item) => item.visibility === 'user' || item.visibility === 'admin')
      .filter((item) => item.enabled !== false)
      .map((item) => ({
        id: String(item.id),
        label: String(item.label),
        url: String(item.url),
        visibility: item.visibility as 'user' | 'admin',
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [];
  }
}

/** 解析并验证可选每页条数列表。 */
function parsePageSizeOptions(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [10, 20, 50, 100];
  const parts = raw.split(',');
  const valid = new Set<number>();
  for (const part of parts) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 5 && n <= 1000) {
      valid.add(n);
    }
  }
  if (valid.size === 0) return [10, 20, 50, 100];
  return Array.from(valid).sort((a, b) => a - b);
}

@ApiTags('public')
@Controller('api/v1/public')
export class PublicLoginAgreementController {
  constructor(
    @Inject(LoginAgreementService) private readonly agreement: LoginAgreementService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Get('login-agreement')
  @ApiOperation({ summary: '返回公开登录条款配置（无需登录）' })
  async getConfig(): Promise<PublicLoginAgreementDto> {
    return this.agreement.getPublicConfig();
  }

  @Get('legal/:slug')
  @ApiOperation({ summary: '返回公开法律文档 Markdown（无需登录）' })
  async getLegalDocument(@Param('slug') slug: string): Promise<LegalDocumentDto> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw domainError(ERROR_CODES.NOT_FOUND, 'Legal document not found', 404);
    }
    return this.agreement.getDocument(slug);
  }

  @Get('site-config')
  @ApiOperation({ summary: '返回公开站点配置（站点名称、Logo、客服联系方式、首页内容等，无需登录）' })
  async getSiteConfig(): Promise<PublicSiteConfigDto> {
    const keys = [
      'general.siteUrl',
      'general.supportEmail',
      'general.siteName',
      'general.siteSubtitle',
      'general.siteLogo',
      'general.contactInfo',
      'general.docUrl',
      'general.homeContent',
      'general.compactHomeEnabled',
      'general.hideCcsImportButton',
      'general.customMenuItems',
      'table.defaultPageSize',
      'table.pageSizeOptions',
    ];
    const values = await this.settings.getMany(keys);

    const getStr = (key: string, fallback: string): string => {
      const v = values.get(key);
      return (v != null ? v.trim() : '') || fallback;
    };

    const getBool = (key: string, fallback: boolean): boolean => {
      const v = values.get(key);
      if (v == null) return fallback;
      return v === 'true' || v === '1' || v === 'yes' || v === 'on';
    };

    const getNum = (key: string, fallback: number): number => {
      const v = values.get(key);
      if (v == null) return fallback;
      const n = Number(v);
      return Number.isInteger(n) && n >= 5 && n <= 1000 ? n : fallback;
    };

    return {
      siteUrl: getStr('general.siteUrl', 'http://localhost:3000'),
      supportEmail: getStr('general.supportEmail', 'support@example.com'),
      siteName: getStr('general.siteName', 'EnovaMotion'),
      siteSubtitle: getStr('general.siteSubtitle', ''),
      siteLogo: getStr('general.siteLogo', ''),
      contactInfo: getStr('general.contactInfo', 'support@example.com'),
      docUrl: getStr('general.docUrl', ''),
      homeContent: getStr('general.homeContent', ''),
      compactHomeEnabled: getBool('general.compactHomeEnabled', false),
      hideCcsImportButton: getBool('general.hideCcsImportButton', false),
      customMenuItems: parseCustomMenuItems(values.get('general.customMenuItems')),
      tableDefaultPageSize: getNum('table.defaultPageSize', 20),
      tablePageSizeOptions: parsePageSizeOptions(values.get('table.pageSizeOptions')),
    };
  }

  @Get('auth-config')
  @ApiOperation({ summary: '返回公开注册配置（开放注册、邮箱验证、白名单等，无需登录）' })
  async getAuthConfig(): Promise<PublicAuthConfigDto> {
    const keys = [
      'auth.openRegistration',
      'auth.emailVerification',
      'auth.emailDomainWhitelist',
      'auth.nonWhitelistDomainLimit',
      'auth.enablePromoCode',
      'auth.requireInvitationCode',
      'auth.enablePasswordReset',
      'auth.turnstileEnabled',
      'auth.turnstileSiteKey',
    ];
    const values = await this.settings.getMany(keys);

    const getBool = (key: string, fallback: boolean): boolean => {
      const v = values.get(key);
      if (v == null) return fallback;
      return v === 'true' || v === '1' || v === 'yes' || v === 'on';
    };

    const getStr = (key: string, fallback: string): string => {
      const v = values.get(key);
      return (v != null ? v.trim() : '') || fallback;
    };

    let whitelist: string[] = [];
    try {
      const raw = values.get('auth.emailDomainWhitelist');
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          whitelist = parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
        }
      }
    } catch {
      // 无效 JSON 返回空数组
    }

    return {
      openRegistration: getBool('auth.openRegistration', true),
      emailVerification: getBool('auth.emailVerification', false),
      emailDomainWhitelist: whitelist,
      nonWhitelistDomainLimit: getBool('auth.nonWhitelistDomainLimit', false),
      enablePromoCode: getBool('auth.enablePromoCode', false),
      requireInvitationCode: getBool('auth.requireInvitationCode', false),
      enablePasswordReset: getBool('auth.enablePasswordReset', true),
      turnstileEnabled: getBool('auth.turnstileEnabled', false),
      turnstileSiteKey: getStr('auth.turnstileSiteKey', ''),
    };
  }
}
