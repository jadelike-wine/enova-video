import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Module({
  controllers: [AssetsController],
  providers: [AuthGuard, AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
