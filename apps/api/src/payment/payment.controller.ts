import { Body, Controller, Get, Headers, Param, ParseEnumPipe, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PAYMENT_PROVIDERS, type PaymentProviderKey } from '@enova/payment';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { RateLimitGuard } from '../common/guards/rate-limit.guard.js';
import { RateLimit } from '../common/guards/rate-limit.guard.js';
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ key: 'payment_plan', limit: 5, windowSec: 60, by: 'user' })
  @ApiOperation({ summary: '购买 Plan（创建 PLAN 订单并返回支付参数）' })
  createPlanOrder(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanOrderDto): Promise<RechargeResult> {
    return this.service.createPlanOrder(user, dto.planId, dto.couponCode);
  }

  @Post('recharge')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ key: 'payment_recharge', limit: 5, windowSec: 60, by: 'user' })
  @ApiOperation({ summary: '创建充值订单并返回支付参数（payUrl/qrCode）' })
  createRecharge(@CurrentUser() user: AuthUser, @Body() dto: CreateRechargeDto): Promise<RechargeResult> {
    return this.service.createRecharge(user, dto.amountCents, dto.couponCode);
  }

  @Post('sandbox/:orderId/confirm')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ key: 'payment_sandbox_confirm', limit: 10, windowSec: 60, by: 'user' })
  @ApiOperation({ summary: 'sandbox 模拟确认支付（仅演示模式）' })
  simulateConfirm(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<{ orderId: string; credits: number; balance: number }> {
    return this.service.simulateConfirm(user, orderId);
  }

  /**
   * 支付渠道异步通知回调（验签入账）。
   *
   * P0 修复：
   * 1. rawBody 直接从 req.rawBody（Buffer）取，不回退到 JSON.stringify(req.body)。
   *    支付宝发 application/x-www-form-urlencoded，Fastify 默认不保留 raw body，
   *    JSON.stringify 会把 k=v&k2=v2 → {"k":"v","k2":"v2"}，签名字符串完全变化。
   *    main.ts 已注册 addContentTypeParser 保留 rawBody Buffer。
   * 2. 返回纯文本 "success"（text/plain），不返回 JSON。支付宝要求纯文本 success，
   *    返回 JSON 会被视为失败，持续重试通知。微信支付需要 JSON {"code":"SUCCESS"}。
   *
   * 参考 sub2api：io.ReadAll(req.Body) + res.String("success")。
   */
  @Post('notify/:channel')
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'payment_notify', limit: 100, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: '支付渠道异步通知回调（验签入账）' })
  async notify(
    @Param('channel', new ParseEnumPipe(PAYMENT_PROVIDERS)) channel: PaymentProviderKey,
    @Headers() headers: Record<string, string>,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<FastifyReply> {
    const rawBody = this.rawBodyOf(req);
    // 微信支付 APIv3 验签串需要 HTTP method 和请求路径。
    const context = { method: req.method, url: req.url };
    try {
      await this.service.notify(channel, rawBody, headers, context);
    } catch {
      // 验签失败或处理异常：返回 400 让渠道重试（非 success 响应）。
      return res.status(400).type('text/plain').send('fail');
    }
    // P3-1: 无论 received=true（已处理入账）还是 received=false（无关事件，如非支付状态通知），
    // 都统一返回成功响应。对支付宝来说，返回 success 表示"已收到通知，无需重试"。
    // 无关事件（如 trade_status=WAIT_BUYER_PAY）返回 success 是正确行为——
    // 我们不需要支付宝重试这类通知，真正的支付成功通知会单独到达。
    // 按渠道要求返回：
    // - 支付宝：纯文本 "success"
    // - 微信支付：JSON {"code":"SUCCESS","message":"成功"}
    // - sandbox：纯文本 "success"
    if (channel === 'wechat') {
      return res.status(200).type('application/json').send({ code: 'SUCCESS', message: '成功' });
    }
    return res.status(200).type('text/plain').send('success');
  }

  /**
   * 查询订单支付状态（前端 return 页轮询用）。
   * P2 修复：前端支付完成后跳转 return 页，通过此端点轮询订单状态。
   */
  @Get('orders/:orderId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '查询订单支付状态（前端轮询）' })
  async getOrderStatus(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<{ orderId: string; status: string; amountCents: number; credits: number }> {
    const result = await this.service.queryOrderForUser(user, orderId);
    return result;
  }

  private rawBodyOf(req: FastifyRequest): string {
    // P0 修复：优先从 Fastify 的 rawBody Buffer 获取原始请求体。
    // main.ts 已注册 content-type parser 为 form-urlencoded 保留 rawBody。
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (raw && raw.length > 0) return raw.toString('utf8');
    // Fallback: 对于 JSON body（sandbox 等），rawBody 可能未设置。
    // 尝试从 req.body 构造，但只用于 sandbox 等非签名场景。
    const body = req.body;
    if (body && typeof body === 'object') {
      return JSON.stringify(body);
    }
    return '';
  }
}
