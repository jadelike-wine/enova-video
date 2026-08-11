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
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  ProvidersAdminService,
  type ProviderView,
} from './providers.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { CreateProviderDto, ListQueryDto, UpdateProviderDto } from './dto/admin.dto.js';

@ApiTags('admin/providers')
@Controller('api/v1/admin/providers')
@UseGuards(AuthGuard, AdminGuard)
export class ProvidersAdminController {
  constructor(
    @Inject(ProvidersAdminService) private readonly service: ProvidersAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出所有 Provider' })
  list(@Query() query: ListQueryDto): Promise<ProviderView[]> {
    return this.service.list(query.limit ?? 50, query.offset ?? 0);
  }

  @Post()
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

  /** 审计脱敏：不记录 provider.config（可能含敏感配置）。 */
  private toAudit(v: ProviderView): Record<string, unknown> {
    return { id: v.id, code: v.code, name: v.name, baseUrl: v.baseUrl, status: v.status };
  }
}