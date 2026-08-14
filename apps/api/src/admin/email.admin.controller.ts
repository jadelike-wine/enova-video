import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS, domainError, ERROR_CODES } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { AdminAuditService } from './admin.audit.service.js';
import { RuntimeEmailSender } from '../common/services/runtime-email.sender.js';
import { IsEmail, IsOptional, IsString } from 'class-validator';

class TestEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @IsOptional()
  subject?: string;
}

/**
 * 管理后台邮件管理（P0-1）。
 *
 * 提供测试邮件发送能力，用于验证 SMTP 配置。
 * 受 EMAIL_TEST 权限保护，仅管理员可用。
 */
@ApiTags('admin/email')
@Controller('api/v1/admin/email')
@UseGuards(AuthGuard, PermissionGuard)
export class EmailAdminController {
  constructor(
    @Inject('EMAIL_SENDER') private readonly emailSender: RuntimeEmailSender,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Post('test')
  @RequirePermission(PERMISSIONS.EMAIL_TEST)
  @ApiOperation({ summary: '发送测试邮件（验证 SMTP 配置）' })
  async sendTestEmail(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: TestEmailDto,
  ): Promise<{ ok: true; message: string }> {
    if (!(await this.emailSender.isSmtpConfigured())) {
      throw domainError(
        ERROR_CODES.EMAIL_NOT_CONFIGURED,
        'SMTP email sender is not configured. Configure it in Admin Settings or provide the legacy environment fallback.',
        400,
      );
    }
    try {
      await this.emailSender.sendTestEmail(dto.to);
    } catch {
      throw domainError(
        ERROR_CODES.EMAIL_SEND_FAILED,
        'Failed to send test email. Check SMTP configuration and server logs.',
        500,
      );
    }
    await this.audit.record({
      actorUserId: user.userId,
      action: 'email.test_send',
      resourceType: 'email',
      resourceId: dto.to,
      after: { subject: dto.subject ?? 'Test email' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true, message: `Test email sent to ${dto.to}` };
  }

  @Post('check')
  @RequirePermission(PERMISSIONS.EMAIL_TEST)
  @ApiOperation({ summary: '检查邮件配置状态' })
  async checkConfig(): Promise<{ configured: boolean; sender: string }> {
    const configured = await this.emailSender.isSmtpConfigured();
    return {
      configured,
      sender: configured ? 'SmtpEmailSender' : 'DisabledEmailSender',
    };
  }
}
