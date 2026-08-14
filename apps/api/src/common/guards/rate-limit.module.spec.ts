import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_REDIS } from './rate-limit.guard.js';
import { RateLimitModule } from './rate-limit.module.js';

describe('RateLimitModule', () => {
  it('exports the Redis token required by feature modules using RateLimitGuard', () => {
    const exports = Reflect.getMetadata('exports', RateLimitModule) as unknown[];
    expect(exports).toContain(RATE_LIMIT_REDIS);
  });
});
