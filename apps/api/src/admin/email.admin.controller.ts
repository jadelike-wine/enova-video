import { Body, Controller, Inject, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS, domainError, ERROR_CODES } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { AdminAuditService } from './admin.audit.service.js';
import { RuntimeEmailSender } from '../common/services/runtime-email.sender.js';
import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

class TestEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @IsOptional()
  subject?: string;
}

class TestSmtpConnectionDto {
  @IsString()
  @IsOptional()
  host?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  password?: string;
}

/**
 * 管理后台邮件管理（P0-1）。
 *
 * 提供测试邮件发送能力和 SMTP 连接测试，用于验证 SMTP 配置。
 * 受 EMAIL_TEST 权限保护，仅管理员可用。
 */
@ApiTags('admin/email')
@Controller('api/v1/admin/email')
@UseGuards(AuthGuard, PermissionGuard)
export class EmailAdminController {
  private readonly logger = new Logger('EmailAdminController');

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

  @Post('test-smtp')
  @RequirePermission(PERMISSIONS.EMAIL_TEST)
  @ApiOperation({ summary: '测试 SMTP 连接（不发送邮件）' })
  async testSmtpConnection(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: TestSmtpConnectionDto,
  ): Promise<{ ok: true; message: string }> {
    try {
      await this.emailSender.testSmtpConnection({
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        user: dto.user,
        password: dto.password,
      });
    } catch (err) {
      // 脱敏：不将 nodemailer 原始错误（含 host/port/banner 细节）返回给客户端，仅返回固定提示。
      // 详细错误只入服务端日志。
      const detail = err instanceof Error ? err.message : 'Unknown SMTP connection error';
      this.logger.error(`SMTP connection test failed: ${detail}`, undefined, 'SMTP_TEST_FAILED');
      throw domainError(
        ERROR_CODES.EMAIL_SEND_FAILED,
        'SMTP connection test failed. Check SMTP configuration and server logs for details.',
        400,
      );
    }
    await this.audit.record({
      actorUserId: user.userId,
      action: 'email.test_smtp',
      resourceType: 'email',
      resourceId: dto.host ?? 'saved-config',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true, message: 'SMTP connection successful' };
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
