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
import { OrdersAdminService } from './orders.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import { SensitiveActionService } from '../common/services/sensitive-action.service.js';
import { OrderListQueryDto, RecordManualRefundDto } from './dto/admin.dto.js';

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

  // ---- 人工退款记录（非自动退款）----

  @Post(':id/manual-refund')
  @RequirePermission(PERMISSIONS.ORDERS_REFUND)
  @ApiOperation({
    summary: '记录人工退款处理结果（非自动退款）：管理员在渠道商户平台完成退款后，在此记录处理结果 + 回收 credits',
    description: '此接口不调用渠道退款 API，不改变 orders.status，仅为内部登记和审计。',
  })
  async recordManualRefund(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordManualRefundDto,
  ) {
    const before = await this.service.getStatus(id);
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.ORDERS_REFUND,
      target: `order:${id}`,
      reason: `Record manual refund: ${dto.reason}`,
      before: before ? { status: before.status } : undefined,
      requestId: req.id,
      stepUpPassword,
    });
    const result = await this.service.recordManualRefund(id, {
      operatorId: user.userId,
      reason: dto.reason,
      refundChannel: dto.refundChannel,
      channelRefundNo: dto.channelRefundNo,
      refundAmountCents: dto.refundAmountCents,
      reviewNote: dto.reviewNote,
      externalRefundedAt: dto.externalRefundedAt,
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.record_manual_refund',
      resourceType: 'order',
      resourceId: id,
      before: before ? { status: before.status } : undefined,
      after: {
        recordId: result.recordId,
        refundStatus: result.status,
        refundAmountCents: result.refundAmountCents,
        isFullRefund: result.isFullRefund,
        creditsToRevoke: result.creditsToRevoke,
        creditsRevoked: result.creditsRevoked,
        creditsFullyRevoked: result.creditsFullyRevoked,
        subscriptionCanceled: result.subscriptionCanceled,
        reason: dto.reason,
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post(':id/manual-refund/credits-retry')
  @RequirePermission(PERMISSIONS.ORDERS_REFUND)
  @ApiOperation({
    summary: '补扣 Credits（仅 CREDITS_PENDING 状态）：不重新退款，只再次尝试 Credits 冲正',
    description: '此接口不调用渠道退款 API，不重新创建现金退款记录，不重复取消订阅。',
  })
  async retryCreditsRevocation(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const before = await this.service.getStatus(id);
    const stepUpPassword = (req.headers['x-step-up-password'] as string) || undefined;
    await this.sensitiveAction.execute({
      actorUserId: user.userId,
      permission: PERMISSIONS.ORDERS_REFUND,
      target: `order:${id}`,
      reason: 'Retry credits revocation for manual refund',
      before: before ? { status: before.status } : undefined,
      requestId: req.id,
      stepUpPassword,
    });
    const result = await this.service.retryCreditsRevocation(id, {
      operatorId: user.userId,
    });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'order.retry_credits_revocation',
      resourceType: 'order',
      resourceId: id,
      before: before ? { status: before.status } : undefined,
      after: {
        refundRecordId: result.recordId,
        creditsToRevoke: result.creditsToRevoke,
        creditsRevoked: result.creditsRevoked,
        creditsFullyRevoked: result.creditsFullyRevoked,
        finalStatus: result.status,
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post('anomalies')
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: '查询异常订单（支付成功但履约失败/待处理）' })
  async listAnomalies() {
    return { anomalies: await this.service.listAnomalies() };
  }
}
