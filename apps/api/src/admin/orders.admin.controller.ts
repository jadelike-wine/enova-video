import {
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
import { OrdersAdminService } from './orders.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { SensitiveActionService } from '../common/services/sensitive-action.service.js';
import { OrderListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/orders')
@Controller('api/v1/admin/orders')
@UseGuards(AuthGuard, PermissionGuard)
export class OrdersAdminController {
  constructor(
    @Inject(OrdersAdminService) private readonly service: OrdersAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(SensitiveActionService) private readonly sensitiveAction: SensitiveActionService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: '订单列表（可按 status / orderType 过滤）' })
  list(@Query() query: OrderListQueryDto) {
    return this.service.list({
      limit: query.limit,
      offset: query.offset,
      status: query.status,
      orderType: query.orderType,
    });
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: '订单详情（含 payment transactions / fulfillment / ledger）' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/fulfillment/retry')
  @RequirePermission(PERMISSIONS.ORDERS_FULFILL)
  @ApiOperation({ summary: '重试订单履约（幂等）' })
  async retryFulfillment(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const before = await this.service.getStatus(id);
    // P1.5: Sensitive action gate (step-up + audit) before retrying fulfillment.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.ORDERS_FULFILL,
      target: `order:${id}`,
      reason: 'Retry order fulfillment',
      before: before ? { fulfillmentStatus: before.fulfillmentStatus } : undefined,
      requestId: req.id,
      stepUpPassword,
    });
    const result = await this.service.retryFulfillment(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.retry_fulfillment',
      resourceType: 'order',
      resourceId: id,
      before: before ? { fulfillmentStatus: before.fulfillmentStatus } : undefined,
      after: { fulfillmentStatus: result.status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/close')
  @RequirePermission(PERMISSIONS.ORDERS_FULFILL)
  @ApiOperation({ summary: '关闭未支付订单' })
  async closeOrder(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const before = await this.service.getStatus(id);
    // P1.5: Sensitive action gate (step-up + audit) before closing order.
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.ORDERS_FULFILL,
      target: `order:${id}`,
      reason: 'Close unpaid order',
      before: before ? { status: before.status } : undefined,
      requestId: req.id,
      stepUpPassword,
    });
    await this.service.closeOrder(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.close',
      resourceType: 'order',
      resourceId: id,
      before: before ? { status: before.status } : undefined,
      after: { status: 'FAILED' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { orderId: id, status: 'CLOSED' };
  }
}
