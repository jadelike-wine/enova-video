import {
  Body,
  Controller,
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
import { UsersAdminService, type AdminUserView } from './users.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { AdjustCreditsDto, ListQueryDto, SetUserStatusDto } from './dto/admin.dto.js';

@ApiTags('admin/users')
@Controller('api/v1/admin/users')
@UseGuards(AuthGuard, AdminGuard)
export class UsersAdminController {
  constructor(
    @Inject(UsersAdminService) private readonly service: UsersAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出用户（含主要 Workspace 与余额）' })
  list(@Query() query: ListQueryDto): Promise<AdminUserView[]> {
    return this.service.list(query.limit ?? 50, query.offset ?? 0);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '启用/禁用用户' })
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<AdminUserView> {
    const before = await this.service.getStatus(id);
    const view = await this.service.setStatus(id, dto.status);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'user.set_status',
      resourceType: 'user',
      resourceId: id,
      before: before ? { status: before } : undefined,
      after: { status: dto.status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return view;
  }

  @Post(':id/credits')
  @ApiOperation({ summary: '调整用户主要 Workspace 余额（正负均可）' })
  async adjustCredits(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustCreditsDto,
  ): Promise<{ balance: number; reservedBalance: number }> {
    const result = await this.service.adjustCredits(id, dto.delta, dto.description);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'user.adjust_credits',
      resourceType: 'user',
      resourceId: id,
      after: { delta: dto.delta, balance: result.balance, description: dto.description },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }
}