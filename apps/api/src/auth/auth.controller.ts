import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthResult } from './auth.service.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './session.service.js';
import { TurnstileService, type TurnstileConfig } from './turnstile.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { parseCookie } from '../common/http/cookies.js';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TurnstileService) private readonly turnstile: TurnstileService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: '注册：创建 User + Personal Workspace + Welcome Credits + Session' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AuthResult> {
    const result = await this.auth.register(dto.email, dto.password, dto.turnstileToken, req.ip);
    this.setSessionCookie(res, result);
    return this.toPublic(result);
  }

  @Post('login')
  @ApiOperation({ summary: '登录' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AuthResult> {
    const result = await this.auth.login(dto.email, dto.password, dto.turnstileToken, req.ip);
    this.setSessionCookie(res, result);
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
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: '返回当前用户、Personal Workspace 与余额' })
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser): Promise<AuthResult> {
    return this.auth.current(user.userId);
  }

  private setSessionCookie(res: FastifyReply, result: AuthResult & { token: string }): void {
    res.setCookie(SESSION_COOKIE, result.token, {
      ...this.cookieOptions(),
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

  private cookieOptions(): Record<string, unknown> {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    };
  }

  private readToken(req: FastifyRequest): string | undefined {
    return parseCookie(req.headers.cookie as string | undefined, SESSION_COOKIE);
  }
}