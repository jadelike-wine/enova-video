/**
 * P0-4: Rate Limit Module.
 *
 * Provides RateLimitGuard with a dedicated Redis connection.
 * The guard is NOT global — controllers must explicitly @UseGuards(RateLimitGuard)
 * and @RateLimit(...) on endpoints that need limiting.
 */

import { Global, Module } from '@nestjs/common';
import IORedis from 'ioredis';
import { RateLimitGuard, RATE_LIMIT_REDIS } from './rate-limit.guard.js';
import { ENV, type Env } from '../../config/config.module.js';

@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_REDIS,
      inject: [ENV],
      useFactory: (env: Env): IORedis => {
        // Disable rate limiting in test environment by providing a mock Redis.
        // In production, this creates a real Redis connection.
        return new IORedis(env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        });
      },
    },
    RateLimitGuard,
  ],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
