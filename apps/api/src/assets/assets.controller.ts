import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { AssetsService, type AssetView } from './assets.service.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

@ApiTags('assets')
@Controller('api/v1/assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly service: AssetsService) {}

  @Get()
  @ApiOperation({ summary: '列出当前 Workspace 的媒体资产（Workspace 隔离）' })
  list(@CurrentUser() user: AuthUser, @Query() dto: ListAssetsDto): Promise<AssetView[]> {
    return this.service.list(user.workspaceId, dto);
  }
}
