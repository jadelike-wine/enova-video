import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  CredentialsAdminService,
  type CredentialView,
  type AccountRow,
  type TestConnectionResult,
} from './credentials.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { CreateCredentialDto, UpdateCredentialDto, TestCredentialConnectionDto, AccountListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/credentials')
@Controller('api/v1/admin')
@UseGuards(AuthGuard, PermissionGuard)
export class CredentialsAdminController {
  constructor(
    @Inject(CredentialsAdminService) private readonly service: CredentialsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get('providers/:providerId/credentials')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '列出指定 Provider 的 Credential（不含 Secret 明文）' })
  listByProvider(@Param('providerId', ParseUUIDPipe) providerId: string): Promise<CredentialView[]> {
    return this.service.listByProvider(providerId);
  }

  /**
   * 展平查询：跨所有 Provider 列出所有 Credential（账号），关联 Provider 信息。
   * 这是新主列表 API，一行代表一个可调用的 API 账号。
   */
  @Get('accounts')
  @RequirePermission(PERMISSIONS.PROVIDERS_READ)
  @ApiOperation({ summary: '列出所有账号（展平 Credential + Provider）' })
  async listAccounts(
    @Query() query: AccountListQueryDto,
  ): Promise<{ items: AccountRow[]; total: number }> {
    const [items, total] = await Promise.all([
      this.service.listAccounts({
        limit: query.limit ?? 100,
        offset: query.offset ?? 0,
        search: query.search,
        status: query.status,
        providerCode: query.providerCode,
      }),
      this.service.countAccounts({
        status: query.status,
        providerCode: query.providerCode,
      }),
    ]);
    return { items, total };
  }

  @Post('providers/:providerId/credentials')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '创建 Credential（Secret 加密入库）' })
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: CreateCredentialDto,
  ): Promise<CredentialView> {
    const view = await this.service.create(providerId, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.create',
      resourceType: 'credential',
      resourceId: view.id,
      after: view as unknown as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Patch('credentials/:id')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '更新 Credential（仅传新 secret 时重新加密）' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDto,
  ): Promise<CredentialView> {
    const before = await this.service.get(id);
    const view = await this.service.update(id, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.update',
      resourceType: 'credential',
      resourceId: id,
      before: before ? (before as unknown as Record<string, unknown>) : undefined,
      after: view as unknown as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Delete('credentials/:id')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '删除 Credential' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    const before = await this.service.get(id);
    await this.service.remove(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.delete',
      resourceType: 'credential',
      resourceId: id,
      before: before ? (before as unknown as Record<string, unknown>) : undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true };
  }

  /**
   * 测试连接：验证 API Key 是否可正常调用 Provider。
   * 支持保存前测试（传 secret + providerCode/baseUrl）和保存后测试（传 credentialId）。
   */
  @Post('credentials/test-connection')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '测试 API Key 连接是否有效' })
  async testConnection(
    @Body() dto: TestCredentialConnectionDto,
  ): Promise<TestConnectionResult> {
    return this.service.testConnection({
      secret: dto.secret,
      providerCode: dto.providerCode,
      baseUrl: dto.baseUrl,
    });
  }

  /**
   * 测试已保存凭证的连接。
   */
  @Post('credentials/:id/test-connection')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '测试已保存凭证的连接' })
  async testConnectionById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestConnectionResult> {
    return this.service.testConnection({ credentialId: id });
  }
}
