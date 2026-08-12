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
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { OrdersAdminService } from './orders.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { OrderListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/orders')
@Controller('api/v1/admin/orders')
@UseGuards(AuthGuard, AdminGuard)
export class OrdersAdminController {
  constructor(
    @Inject(OrdersAdminService) private readonly service: OrdersAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  @Get()
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
  @ApiOperation({ summary: '订单详情（含 payment transactions / fulfillment / ledger）' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/fulfillment/retry')
  @ApiOperation({ summary: '重试订单履约（幂等）' })
  async retryFulfillment(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const before = await this.service.getStatus(id);
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
  @ApiOperation({ summary: '关闭未支付订单' })
  async closeOrder(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const before = await this.service.getStatus(id);
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
