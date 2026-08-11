import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { DomainExceptionFilter } from './domain-exception.filter.js';
import { EnovaLogger } from '../logger/enova-logger.js';

function makeHost(error: unknown): ArgumentsHost {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const res = { status };
  const req = { requestId: 'req-123' };
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
}

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }));

  it('formats DomainError into unified error body with requestId', () => {
    const err = domainError(ERROR_CODES.INSUFFICIENT_CREDITS, 'Insufficient credits', 402);
    const host = makeHost(err);
    filter.catch(err, host);
    const [statusCode] = ((host as any).switchToHttp() as any).getResponse().status.mock.calls[0];
    const body = ((host as any).switchToHttp() as any).getResponse().status(0).send.mock.calls[0][0];
    expect(statusCode).toBe(402);
    expect(body).toEqual({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits', requestId: 'req-123' },
    });
  });

  it('maps unknown exceptions to INTERNAL_ERROR 500', () => {
    const err = new Error('boom');
    const host = makeHost(err);
    filter.catch(err, host);
    const [statusCode] = ((host as any).switchToHttp() as any).getResponse().status.mock.calls[0];
    const body = ((host as any).switchToHttp() as any).getResponse().status(0).send.mock.calls[0][0];
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});