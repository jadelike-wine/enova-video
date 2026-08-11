import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { desc, eq } from 'drizzle-orm';
import { walletLedger, wallets, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('billing')
@Controller('api/v1/billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('wallet')
  @ApiOperation({ summary: '当前 Workspace 钱包余额' })
  async wallet(@CurrentUser() user: AuthUser): Promise<{ balance: number; reservedBalance: number }> {
    const rows = await this.db
      .select({ balance: wallets.balance, reservedBalance: wallets.reservedBalance })
      .from(wallets)
      .where(eq(wallets.workspaceId, user.workspaceId))
      .limit(1);
    const w = rows[0];
    return { balance: w?.balance ?? 0, reservedBalance: w?.reservedBalance ?? 0 };
  }

  @Get('ledger')
  @ApiOperation({ summary: '当前 Workspace 的余额流水（Workspace 隔离）' })
  async ledger(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ): Promise<unknown[]> {
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    return this.db
      .select()
      .from(walletLedger)
      .where(eq(walletLedger.workspaceId, user.workspaceId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(n);
  }
}