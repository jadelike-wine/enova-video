import { Controller, Get, Inject, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { CustomersAdminService } from './customers.admin.service.js';

@ApiTags('admin/customers')
@Controller('api/v1/admin/customers')
@UseGuards(AuthGuard, AdminGuard)
export class CustomersAdminController {
  constructor(@Inject(CustomersAdminService) private readonly service: CustomersAdminService) {}

  @Get(':userId/360')
  @ApiOperation({ summary: 'Customer 360 视图（用户 / 工作区 / 钱包 / 订阅 / reservation / ledger / generations / payments / usage / audit）' })
  getCustomer360(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.getCustomer360(userId);
  }
}
