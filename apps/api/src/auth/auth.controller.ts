import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthResult, type SessionView } from './auth.service.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './session.service.js';
import { TurnstileService, type TurnstileConfig } from './turnstile.service.js';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './dto/auth.dto.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { RateLimitGuard } from '../common/guards/rate-limit.guard.js';
import { RateLimit } from '../common/guards/rate-limit.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { parseCookie } from '../common/http/cookies.js';
import type { EmailSender } from '../common/services/email-sender.interface.js';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TurnstileService) private readonly turnstile: TurnstileService,
    @Inject('EMAIL_SENDER') private readonly emailSender: EmailSender,
  ) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'register', limit: 5, windowSec: 3600, by: 'ip' })
  @ApiOperation({ summary: '注册：创建 User + Personal Workspace + Welcome Credits + Session' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AuthResult> {
    const result = await this.auth.register(dto.email, dto.password, dto.turnstileToken, req.ip);
    this.setSessionCookie(res, result, req);
    return this.toPublic(result);
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'login', limit: 10, windowSec: 300, by: 'ip' })
  @ApiOperation({ summary: '登录' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AuthResult> {
    const result = await this.auth.login(dto.email, dto.password, dto.turnstileToken, req.ip);
    this.setSessionCookie(res, result, req);
    return this.toPublic(result);
  }

  @Get('turnstile-config')
  @ApiOperation({ summary: '返回 Turnstile 公开配置（是否启用 + site key）' })
  async turnstileConfig(): Promise<TurnstileConfig> {
    return this.turnstile.getConfig();
  }

  @Post('logout')
  @ApiOperation({ summary: '登出：删除 Session 并清除 Cookie' })
  @UseGuards(AuthGuard)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ ok: true }> {
    const rawToken = this.readToken(req);
    if (rawToken) {
      await this.auth.logout(user.userId, this.auth.mustHashToken(rawToken));
    }
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(req));
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: '返回当前用户、Personal Workspace 与余额' })
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser): Promise<AuthResult> {
    return this.auth.current(user.userId);
  }

  // ---- P1-6: 会话管理与改密 ----

  @Get('sessions')
  @ApiOperation({ summary: '列出当前用户全部 Session（不含 token 明文）' })
  @UseGuards(AuthGuard)
  async sessions(@CurrentUser() user: AuthUser): Promise<{ sessions: SessionView[] }> {
    return { sessions: await this.auth.listSessions(user.userId) };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: '撤销指定 Session' })
  @UseGuards(AuthGuard)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') sessionId: string,
  ): Promise<{ ok: true }> {
    await this.auth.revokeSession(user.userId, sessionId);
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @ApiOperation({ summary: '撤销当前用户除本会话外的所有 Session' })
  @UseGuards(AuthGuard)
  async revokeOthers(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
  ): Promise<{ revoked: number }> {
    const rawToken = this.readToken(req);
    const keepHash = rawToken ? this.auth.mustHashToken(rawToken) : '';
    return { revoked: await this.auth.revokeAllOtherSessions(user.userId, keepHash) };
  }

  @Post('change-password')
  @ApiOperation({ summary: '修改密码：校验当前密码 → 更新 hash → 撤销其它 Session' })
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    const rawToken = this.readToken(req);
    const keepHash = rawToken ? this.auth.mustHashToken(rawToken) : undefined;
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, keepHash);
    return { ok: true };
  }

  // ---- P1.5: Password Reset ----

  @Post('password/forgot')
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'password_forgot', limit: 3, windowSec: 3600, by: 'ip+email' })
  @ApiOperation({ summary: '发起密码重置（无论邮箱是否存在均返回 ok）' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    const token = await this.auth.requestPasswordReset(dto.email);
    if (token) {
      await this.emailSender.sendPasswordReset({ email: dto.email, resetToken: token });
    }
    return { ok: true };
  }

  @Post('password/reset')
  @ApiOperation({ summary: '重置密码（token + 新密码）' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  // ---- P1.5: Email Verification ----

  @Post('email/verify')
  @ApiOperation({ summary: '验证邮箱 token' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ ok: true }> {
    await this.auth.verifyEmail(dto.token);
    return { ok: true };
  }

  @Post('email/resend-verification')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ key: 'email_resend', limit: 3, windowSec: 3600, by: 'user' })
  @ApiOperation({ summary: '重发邮箱验证 token（需登录，有频率限制）' })
  async resendVerification(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    // Rate limit: 1 per minute per user
    // Simple check: if user already verified, no-op
    const verified = await this.auth.getEmailVerification(user.userId);
    if (verified) return { ok: true };
    const token = await this.auth.createEmailVerificationToken(user.userId);
    if (token) {
      await this.emailSender.sendEmailVerification({ email: user.email, verifyToken: token });
    }
    return { ok: true };
  }

  // ---- P1.5: Logout All ----

  @Post('logout-all')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '撤销当前用户所有 Session 并清除 Cookie' })
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.revokeAllSessions(user.userId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions(req));
    return { ok: true };
  }

  private setSessionCookie(res: FastifyReply, result: AuthResult & { token: string }, req: FastifyRequest): void {
    res.setCookie(SESSION_COOKIE, result.token, {
      ...this.cookieOptions(req),
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  private toPublic(result: AuthResult & { token: string }): AuthResult {
    return {
      user: result.user,
      balance: result.balance,
      reservedBalance: result.reservedBalance,
    };
  }

  private cookieOptions(req: FastifyRequest): Record<string, unknown> {
    return {
      httpOnly: true,
      sameSite: 'lax',
      // 根据实际请求协议动态决定 Secure：HTTP 部署（无 TLS）下浏览器会丢弃 Secure cookie，
      // 导致登录后会话无法回传。trustProxy 已开启，HTTPS 终止代理会正确置 req.protocol。
      secure: req.protocol === 'https',
      path: '/',
    };
  }

  private readToken(req: FastifyRequest): string | undefined {
    return parseCookie(req.headers.cookie as string | undefined, SESSION_COOKIE);
  }
}