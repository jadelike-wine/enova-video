import { Body, Controller, Get, Headers, Param, ParseEnumPipe, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PAYMENT_PROVIDERS, type PaymentProviderKey } from '@enova/payment';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { PaymentService, type RechargeResult } from './payment.service.js';
import { CreatePlanOrderDto, CreateRechargeDto } from './dto/payment.dto.js';

@ApiTags('payment')
@Controller('api/v1/payment')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Get('plans')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '列出可售卖的 Plan（enabled=true）' })
  listPlans(): Promise<Array<Record<string, unknown>>> {
    return this.service.listPurchasablePlans();
  }

  @Post('plan/checkout')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '购买 Plan（创建 PLAN 订单并返回支付参数）' })
  createPlanOrder(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanOrderDto): Promise<RechargeResult> {
    return this.service.createPlanOrder(user, dto.planId, dto.couponCode);
  }

  @Post('recharge')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '创建充值订单并返回支付参数（payUrl/qrCode）' })
  createRecharge(@CurrentUser() user: AuthUser, @Body() dto: CreateRechargeDto): Promise<RechargeResult> {
    return this.service.createRecharge(user, dto.amountCents, dto.couponCode);
  }

  @Post('sandbox/:orderId/confirm')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'sandbox 模拟确认支付（仅演示模式）' })
  simulateConfirm(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<{ orderId: string; credits: number; balance: number }> {
    return this.service.simulateConfirm(user, orderId);
  }

  @Post('notify/:channel')
  @ApiOperation({ summary: '支付渠道异步通知回调（验签入账）' })
  async notify(
    @Param('channel', new ParseEnumPipe(PAYMENT_PROVIDERS)) channel: PaymentProviderKey,
    @Headers() headers: Record<string, string>,
    @Req() req: FastifyRequest,
  ): Promise<{ received: boolean }> {
    const rawBody = this.rawBodyOf(req);
    return this.service.notify(channel, rawBody, headers);
  }

  private rawBodyOf(req: FastifyRequest): string {
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (raw && raw.length > 0) return raw.toString('utf8');
    return JSON.stringify(req.body ?? {});
  }
}