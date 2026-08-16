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
  ProvidersAdminService,
  type ProviderView,
} from './providers.admin.service.js';
import { CredentialsAdminService, type CredentialView } from './credentials.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { CreateProviderDto, ListQueryDto, UpdateProviderDto, CreateAgnesAccountDto } from './dto/admin.dto.js';

@ApiTags('admin/providers')
@Controller('api/v1/admin/providers')
@UseGuards(AuthGuard, PermissionGuard)
export class ProvidersAdminController {
  constructor(
    @Inject(ProvidersAdminService) private readonly service: ProvidersAdminService,
    @Inject(CredentialsAdminService) private readonly credentialsService: CredentialsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.PROVIDERS_READ)
  @ApiOperation({ summary: '列出所有 Provider' })
  list(@Query() query: ListQueryDto): Promise<ProviderView[]> {
    return this.service.list(query.limit ?? 50, query.offset ?? 0);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PROVIDERS_WRITE)
  @ApiOperation({ summary: '创建 Provider（base_url 需通过 SSRF 校验）' })
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: CreateProviderDto,
  ): Promise<ProviderView> {
    const view = await this.service.create(dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: view.id,
      after: this.toAudit(view),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.PROVIDERS_WRITE)
  @ApiOperation({ summary: '更新 Provider' })
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDto,
  ): Promise<ProviderView> {
    const before = await this.service.get(id);
    const view = await this.service.update(id, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: id,
      before: this.toAudit(before),
      after: this.toAudit(view),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.PROVIDERS_WRITE)
  @ApiOperation({ summary: '删除 Provider（级联删除其 Credential）' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    const before = await this.service.get(id);
    await this.service.remove(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'provider.delete',
      resourceType: 'provider',
      resourceId: id,
      before: this.toAudit(before),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true };
  }

  /**
   * 简化的添加 Agnes 账号接口。
   * 第一版只支持 Agnes：管理员只需输入 API Key，后端自动确保 Provider 存在并创建凭证。
   * Provider / Base URL / Code 等信息固定，不需要管理员手动填写。
   */
  @Post('agnes/account')
  @RequirePermission(PERMISSIONS.CREDENTIALS_ROTATE)
  @ApiOperation({ summary: '添加 Agnes 账号（只需 API Key，自动创建 Provider）' })
  async createAgnesAccount(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: CreateAgnesAccountDto,
  ): Promise<CredentialView> {
    // 1. 确保 agnes Provider 存在（不存在则自动创建）。
    const provider = await this.service.ensureAgnesProvider();

    // 2. 创建凭证（API Key 加密入库）。
    const credential = await this.credentialsService.create(provider.id, {
      secret: dto.apiKey,
    });

    // 3. 审计。
    await this.audit.record({
      actorUserId: user.userId,
      action: 'credential.create',
      resourceType: 'credential',
      resourceId: credential.id,
      after: credential as unknown as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return credential;
  }

  /** 审计脱敏：不记录 provider.config（可能含敏感配置）。 */
  private toAudit(v: ProviderView): Record<string, unknown> {
    return { id: v.id, code: v.code, name: v.name, baseUrl: v.baseUrl, status: v.status };
  }
}
