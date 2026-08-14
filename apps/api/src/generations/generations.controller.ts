import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { RateLimitGuard } from '../common/guards/rate-limit.guard.js';
import { RateLimit } from '../common/guards/rate-limit.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { GenerationsService, type GenerationView } from './generations.service.js';
import { CreateGenerationDto } from './dto/generation.dto.js';

@ApiTags('generations')
@Controller('api/v1/generations')
@UseGuards(AuthGuard)
export class GenerationsController {
  constructor(@Inject(GenerationsService) private readonly service: GenerationsService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: 'generation_create', limit: 20, windowSec: 60, by: 'user' })
  @ApiOperation({ summary: '创建生成任务：定价 → 预留 Credits → 入队 → 返回 jobId' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGenerationDto): Promise<GenerationView> {
    return this.service.create(
      user.workspaceId,
      user.userId,
      dto.type,
      dto.provider,
      dto.model,
      dto.input ?? {},
    );
  }

  @Get()
  @ApiOperation({ summary: '列出当前 Workspace 的生成任务（Workspace 隔离）' })
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string): Promise<GenerationView[]> {
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    return this.service.list(user.workspaceId, n);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取生成任务（Workspace 隔离）' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<GenerationView> {
    return this.service.get(user.workspaceId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消任务并释放已预留 Credits' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<GenerationView> {
    return this.service.cancel(user.workspaceId, id);
  }
}