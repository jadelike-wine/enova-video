import { Inject, Injectable } from '@nestjs/common';
import { WalletGateway } from '@enova/billing';
import { DATABASE } from '../database/database.module.js';
import type { Database } from '@enova/db';

/**
 * Wallet 服务（NestJS 适配层）。
 * 计费核心逻辑见 @enova/billing 的 WalletGateway，本类仅注入 Database 并继承复用，
 * 保证 API 与 Worker 使用同一套 Reserve / Settle / Release 实现。
 */
@Injectable()
export class WalletService extends WalletGateway {
  constructor(@Inject(DATABASE) db: Database) {
    super(db);
  }
}