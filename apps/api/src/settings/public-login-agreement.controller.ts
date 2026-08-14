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

class PublicSiteConfigDto {
  @ApiProperty({ example: 'https://example.com' })
  siteUrl!: string;

  @ApiProperty({ example: 'support@example.com' })
  supportEmail!: string;

  @ApiProperty({ example: 'EnovaMotion' })
  appName!: string;
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
  @ApiOperation({ summary: '返回公开站点配置（站点 URL、客服邮箱和应用名称，无需登录）' })
  async getSiteConfig(): Promise<PublicSiteConfigDto> {
    const siteUrl = (await this.settings.getString('general.siteUrl'))?.trim() || 'http://localhost:3000';
    const supportEmail = (await this.settings.getString('general.supportEmail'))?.trim() || 'support@example.com';
    const appName = (await this.settings.getString('general.appName'))?.trim() || 'EnovaMotion';
    return { siteUrl, supportEmail, appName };
  }
}
