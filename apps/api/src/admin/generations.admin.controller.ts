import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
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
import { GenerationsAdminService } from './generations.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { SensitiveActionService } from '../common/services/sensitive-action.service.js';
import { ForceFailJobDto, GenerationListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/generations')
@Controller('api/v1/admin/generations')
@UseGuards(AuthGuard, PermissionGuard)
export class GenerationsAdminController {
  constructor(
    @Inject(GenerationsAdminService) private readonly service: GenerationsAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(SensitiveActionService) private readonly sensitiveAction: SensitiveActionService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.GENERATION_READ)
  @ApiOperation({ summary: '生成任务列表（可按 status / workspaceId 过滤）' })
  list(@Query() query: GenerationListQueryDto) {
    return this.service.list({
      limit: query.limit,
      offset: query.offset,
      status: query.status,
      workspaceId: query.workspaceId,
    });
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.GENERATION_READ)
  @ApiOperation({ summary: '生成任务详情（含 quote / reservation / attempts / outbox / usage）' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/force-fail')
  @RequirePermission(PERMISSIONS.GENERATION_FORCE_FAIL)
  @ApiOperation({ summary: '强制失败并释放 reservation（运营救援）' })
  async forceFail(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ForceFailJobDto,
  ) {
    const before = await this.service.getStatus(id);
    // P1.5: Sensitive action gate (step-up + audit) before force-failing a generation job.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.GENERATION_FORCE_FAIL,
      target: `generation:${id}`,
      reason: dto.reason ?? 'Force fail generation job',
      before: before ? { status: before } : undefined,
      requestId: req.id,
      stepUpPassword,
    });
    const result = await this.service.forceFail(id, dto.reason);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'generation.force_fail',
      resourceType: 'generation_job',
      resourceId: id,
      before: before ? { status: before } : undefined,
      after: { status: result.status, releasedCredits: result.releasedCredits, reason: dto.reason },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/outbox/replay')
  @RequirePermission(PERMISSIONS.GENERATION_REPLAY)
  @ApiOperation({ summary: '重置 outbox 触发重新投递（运营救援）' })
  async replayOutbox(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // P1.5: Sensitive action gate (step-up + audit) before replaying outbox.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.GENERATION_REPLAY,
      target: `generation:${id}`,
      reason: 'Replay outbox for generation job',
      requestId: req.id,
      stepUpPassword,
    });
    const result = await this.service.replayOutbox(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'generation.replay_outbox',
      resourceType: 'generation_job',
      resourceId: id,
      after: { reset: result.reset },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }
}
