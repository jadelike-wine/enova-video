import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthResult } from '../auth/auth.service.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth/session.service.js';
import { SetupInitDto } from './dto/setup.dto.js';

/**
 * 首启 Setup（参考 sub2api）：
 * - GET /api/v1/setup/status：系统是否还需要初始化管理员（尚无任何 ADMIN 账号）。
 * - POST /api/v1/setup/init：创建首个管理员账号并授予 SUPER_ADMIN，成功后直接登录。
 * 仅当系统完全没有管理员时可用，避免被二次提权劫持。
 */
@ApiTags('setup')
@Controller('api/v1/setup')
export class SetupController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('status')
  @ApiOperation({ summary: '返回是否需要首启初始化管理员' })
  async status(): Promise<{ needsSetup: boolean }> {
    return { needsSetup: !(await this.auth.hasAdminUser()) };
  }

  @Post('init')
  @ApiOperation({ summary: '创建首个管理员并登录（仅当尚无管理员时可用）' })
  async init(
    @Body() dto: SetupInitDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AuthResult> {
    const result = await this.auth.createAdmin(dto.email, dto.password, req.ip);
    res.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return {
      user: result.user,
      balance: result.balance,
      reservedBalance: result.reservedBalance,
    };
  }
}