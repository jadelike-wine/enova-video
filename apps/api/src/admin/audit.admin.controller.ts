import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@enova/contracts';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { PermissionGuard } from '../common/guards/permission.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { AdminAuditService, type AdminAuditView } from './admin.audit.service.js';
import { ListQueryDto } from './dto/admin.dto.js';

@ApiTags('admin/audit-logs')
@Controller('api/v1/admin/audit-logs')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditAdminController {
  constructor(@Inject(AdminAuditService) private readonly service: AdminAuditService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: '查询管理员操作审计日志' })
  list(@Query() query: ListQueryDto): Promise<AdminAuditView[]> {
    return this.service.list(query.limit ?? 50, query.offset ?? 0);
  }
}
