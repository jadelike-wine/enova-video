import { describe, expect, it } from 'vitest';
import { USER_ROLES } from '@enova/contracts';
import { AdminGuard } from './admin.guard.js';

function makeContext(authUser?: unknown) {
  const req = { authUser };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows access for ADMIN role', () => {
    expect(guard.canActivate(makeContext({ role: USER_ROLES.ADMIN }))).toBe(true);
  });

  it('rejects when no authUser is present', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrowError(/Admin access required/);
  });

  it('rejects for non-admin roles', () => {
    expect(() => guard.canActivate(makeContext({ role: USER_ROLES.USER }))).toThrowError(/Admin access required/);
  });

  it('rejects when role is missing entirely', () => {
    expect(() => guard.canActivate(makeContext({ id: 'u1' }))).toThrowError(/Admin access required/);
  });
});