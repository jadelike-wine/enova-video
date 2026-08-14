import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { SystemUpdateController } from './system-update.controller.js';

describe('SystemUpdateController', () => {
  it('starts an update for an authorized admin without requiring a step-up password', async () => {
    const operation = {
      operation_id: 'sysop-update-test',
      status: 'running' as const,
      action: 'update' as const,
      started_at: new Date().toISOString(),
    };
    const service = { startUpdate: vi.fn().mockResolvedValue(operation) };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const controller = new SystemUpdateController(service as never, audit as never);
    const user = { userId: 'admin-1' } as AuthUser;
    const request = {
      id: 'request-1',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'vitest' },
    } as unknown as FastifyRequest;

    await expect(controller.update(user, request)).resolves.toEqual(operation);
    expect(service.startUpdate).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledOnce();
  });
});
