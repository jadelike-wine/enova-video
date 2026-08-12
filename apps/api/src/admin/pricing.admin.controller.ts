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
import { type GenerationType } from '@enova/contracts';
import { PricingAdminService } from './pricing.admin.service.js';
import { AdminAuditService } from './admin.audit.service.js';
import {
  CreatePricingRuleDto,
  PreviewQuoteDto,
  PricingVersionListQueryDto,
  PublishPricingVersionDto,
  UpdatePricingRuleDto,
} from './dto/admin.dto.js';

@ApiTags('admin/pricing')
@Controller('api/v1/admin/pricing')
@UseGuards(AuthGuard, AdminGuard)
export class PricingAdminController {
  constructor(
    @Inject(PricingAdminService) private readonly service: PricingAdminService,
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
  ) {}

  // ---- Pricing Rules ----

  @Get('rules')
  @ApiOperation({ summary: '定价规则列表' })
  listRules(@Query() query: PricingVersionListQueryDto) {
    return this.service.listRules({ limit: query.limit, offset: query.offset });
  }

  @Post('rules')
  @ApiOperation({ summary: '创建定价规则' })
  async createRule(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: CreatePricingRuleDto,
  ) {
    const result = await this.service.createRule({ ...dto, generationType: dto.generationType as GenerationType });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'pricing.create_rule',
      resourceType: 'pricing_rule',
      resourceId: result.id,
      after: { generationType: dto.generationType, provider: dto.provider, model: dto.model, credits: dto.credits },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: '更新定价规则（不影响已发布 version 和历史 job）' })
  async updateRule(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    const before = await this.service.getRule(id);
    const result = await this.service.updateRule(id, dto);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'pricing.update_rule',
      resourceType: 'pricing_rule',
      resourceId: id,
      before: before ? { credits: before.credits, enabled: before.enabled } : undefined,
      after: { credits: dto.credits, enabled: dto.enabled },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  // ---- Pricing Versions ----

  @Get('versions')
  @ApiOperation({ summary: '定价版本列表（含历史，不可变）' })
  listVersions(@Query() query: PricingVersionListQueryDto) {
    return this.service.listVersions({
      generationType: query.generationType,
      provider: query.provider,
      model: query.model,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post('versions/publish')
  @ApiOperation({ summary: '发布新定价版本（不可变，发布后不可修改）' })
  async publishVersion(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() dto: PublishPricingVersionDto,
  ) {
    const result = await this.service.publishVersion({ ...dto, generationType: dto.generationType as GenerationType });
    await this.audit.record({
      actorUserId: user.userId,
      action: 'pricing.publish_version',
      resourceType: 'pricing_version',
      resourceId: result.versionId,
      after: {
        generationType: dto.generationType,
        provider: dto.provider,
        model: dto.model,
        credits: dto.credits,
        version: result.version,
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post('versions/:id/archive')
  @ApiOperation({ summary: '归档定价版本（禁止删除）' })
  async archiveVersion(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.archiveVersion(id);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'pricing.archive_version',
      resourceType: 'pricing_version',
      resourceId: id,
      after: { status: 'ARCHIVED' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { versionId: id, status: 'ARCHIVED' };
  }

  @Post('quote/preview')
  @ApiOperation({ summary: '预览报价（不创建 PriceQuote 行）' })
  previewQuote(@Body() dto: PreviewQuoteDto) {
    return this.service.previewQuote({ ...dto, type: dto.type as GenerationType });
  }
}
