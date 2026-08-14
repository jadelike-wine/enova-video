import { describe, expect, it, vi } from 'vitest';
import { AccessLogMiddleware } from './access-log.middleware.js';

describe('AccessLogMiddleware', () => {
  it('logs request metadata when log.accessLog is enabled', async () => {
    let finish: (() => void) | undefined;
    const logger = { info: vi.fn() };
    const settings = { getAccessLog: vi.fn().mockResolvedValue(true) };
    const middleware = new AccessLogMiddleware(settings as never, logger as never);
    const req = { method: 'GET', url: '/health?x=1', requestId: 'req-1' };
    const raw = { statusCode: 204, once: vi.fn((_event: string, handler: () => void) => { finish = handler; }) };
    const res = { raw };
    const next = vi.fn();

    middleware.use(req as never, res as never, next);
    finish?.();
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalled());

    expect(logger.info).toHaveBeenCalledWith('http request completed', expect.objectContaining({
      requestId: 'req-1', method: 'GET', path: '/health', statusCode: 204,
    }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not log when log.accessLog is disabled', async () => {
    let finish: (() => void) | undefined;
    const logger = { info: vi.fn() };
    const settings = { getAccessLog: vi.fn().mockResolvedValue(false) };
    const middleware = new AccessLogMiddleware(settings as never, logger as never);
    const raw = { statusCode: 200, once: vi.fn((_event: string, handler: () => void) => { finish = handler; }) };

    middleware.use({ method: 'GET', url: '/', requestId: 'req-2' } as never, { raw } as never, vi.fn());
    finish?.();
    await Promise.resolve();

    expect(logger.info).not.toHaveBeenCalled();
  });
});
