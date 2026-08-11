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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import {
  ConversationsService,
  type ConversationView,
  type MessageView,
} from './conversations.service.js';
import {
  CreateConversationDto,
  CreateMessageDto,
  SaveMessagesDto,
  UpdateConversationDto,
} from './dto/conversation.dto.js';

@ApiTags('conversations')
@Controller('api/v1/conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly service: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: '列出当前 Workspace 的会话' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ConversationView[]> {
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 100);
    return this.service.list(user.workspaceId, n, cursor);
  }

  @Post()
  @ApiOperation({ summary: '创建会话' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto): Promise<ConversationView> {
    return this.service.create(user.workspaceId, user.userId, dto.title ?? '新对话');
  }

  @Get(':id')
  @ApiOperation({ summary: '获取会话（Workspace 隔离）' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConversationView> {
    return this.service.get(user.workspaceId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名会话' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationView> {
    return this.service.updateTitle(user.workspaceId, id, dto.title);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除会话及其消息' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.service.remove(user.workspaceId, id);
    return { ok: true };
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '列出会话消息（Workspace 隔离）' })
  listMessages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MessageView[]> {
    return this.service.listMessages(user.workspaceId, id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: '追加一条消息' })
  appendOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageView[]> {
    return this.service.appendMessages(user.workspaceId, id, [
      { role: dto.role, content: dto.content, provider: dto.provider, model: dto.model },
    ]);
  }

  @Post(':id/messages/batch')
  @ApiOperation({ summary: '批量追加消息（端内保存对话）' })
  appendBatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMessagesDto,
  ): Promise<MessageView[]> {
    return this.service.appendMessages(
      user.workspaceId,
      id,
      dto.messages.map((m) => ({ role: m.role, content: m.content, provider: m.provider, model: m.model })),
    );
  }
}