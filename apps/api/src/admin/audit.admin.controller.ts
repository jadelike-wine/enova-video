import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { AdminAuditService, type AdminAuditView } from './admin.audit.service.js';
import { ListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/audit-logs')
@Controller('api/v1/admin/audit-logs')
@UseGuards(AuthGuard, AdminGuard)
export class AuditAdminController {
  constructor(@Inject(AdminAuditService) private readonly service: AdminAuditService) {}

  @Get()
  @ApiOperation({ summary: '查询管理员操作审计日志' })
  list(@Query() query: ListQueryDto): Promise<AdminAuditView[]> {
    return this.service.list(query.limit ?? 50, query.offset ?? 0);
  }
}