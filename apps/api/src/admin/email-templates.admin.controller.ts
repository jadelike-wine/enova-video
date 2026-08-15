import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { EmailTemplatesAdminService } from './email-templates.admin.service.js';

class UpdateEmailTemplateDto {
  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  html!: string;
}

class PreviewEmailTemplateDto {
  @IsString()
  event!: string;

  @IsString()
  locale!: string;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  html!: string;
}

/**
 * 管理后台邮件模板管理。
 * 提供模板列表、获取、更新、恢复官方模板和预览能力。
 */
@ApiTags('admin/email-templates')
@Controller('api/v1/admin/settings/email-templates')
@UseGuards(AuthGuard, PermissionGuard)
export class EmailTemplatesAdminController {
  constructor(private readonly service: EmailTemplatesAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '获取邮件模板列表（事件 + 语言 + 占位符）' })
  list() {
    return this.service.listTemplates();
  }

  @Get(':event/:locale')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '获取指定事件和语言的邮件模板' })
  getTemplate(@Param('event') event: string, @Param('locale') locale: string) {
    return this.service.getTemplate(event, locale);
  }

  @Post('preview')
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: '预览邮件模板（替换占位符为 mock 数据）' })
  preview(@Body() dto: PreviewEmailTemplateDto) {
    return this.service.previewTemplate(dto);
  }

  @Post(':event/:locale/restore-official')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '恢复官方默认模板' })
  restoreOfficial(@Param('event') event: string, @Param('locale') locale: string) {
    return this.service.restoreOfficial(event, locale);
  }

  @Put(':event/:locale')
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: '更新邮件模板' })
  updateTemplate(
    @Param('event') event: string,
    @Param('locale') locale: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.service.updateTemplate(event, locale, dto);
  }
}
