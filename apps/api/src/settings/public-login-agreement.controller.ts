import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { LoginAgreementService } from './login-agreement.service.js';

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

@ApiTags('public')
@Controller('api/v1/public')
export class PublicLoginAgreementController {
  constructor(
    @Inject(LoginAgreementService) private readonly agreement: LoginAgreementService,
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
}
