import { describe, expect, it } from 'vitest';
import { AuthModule } from './auth.module.js';

describe('AuthModule', () => {
  it('exports the email sender used by admin email operations', () => {
    const exports = Reflect.getMetadata('exports', AuthModule) as unknown[];
    expect(exports).toContain('EMAIL_SENDER');
  });
});
