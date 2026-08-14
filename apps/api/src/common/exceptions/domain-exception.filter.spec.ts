import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import type { HttpServer } from '@nestjs/common/interfaces/http/http-server.interface';
import { domainError, ERROR_CODES } from '@enova/contracts';
import { DomainExceptionFilter } from './domain-exception.filter.js';
import { EnovaLogger } from '../logger/enova-logger.js';

/** 模拟 FastifyReply：存在 .code/.send，adapter 判定为非原生响应。 */
function makeFastifyRes() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  const res = { code, send };
  return { res, send, code };
}

/** 模拟原生 http.ServerResponse：无 .code/.send/.status，adapter 判定为原生响应。 */
function makeNativeRes() {
  const end = vi.fn();
  const setHeader = vi.fn();
  const res = { statusCode: 200, setHeader, end } as unknown as { end: ReturnType<typeof vi.fn> };
  return { res, end, setHeader };
}

function makeAdapter(sendBody: (body: unknown) => void) {
  return {
    isHeadersSent: vi.fn(() => false),
    reply: vi.fn((_res: unknown, body: unknown, statusCode?: number) => {
      void statusCode;
      sendBody(body);
    }),
    end: vi.fn(),
  } as unknown as HttpServer;
}

function makeHost(error: unknown, res: unknown, req = { requestId: 'req-123' }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
}

describe('DomainExceptionFilter', () => {
  it('formats DomainError into unified error body with requestId', () => {
    let captured: unknown;
    const adapter = makeAdapter((body) => {
      captured = body;
    });
    const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }), adapter);
    const { res, code } = makeFastifyRes();
    const err = domainError(ERROR_CODES.INSUFFICIENT_CREDITS, 'Insufficient credits', 402);
    filter.catch(err, makeHost(err, res));
    expect(adapter.reply).toHaveBeenCalledWith(res, expect.anything(), 402);
    expect(code).not.toHaveBeenCalled();
    expect(captured).toEqual({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits', requestId: 'req-123' },
    });
  });

  it('maps unknown exceptions to INTERNAL_ERROR 500', () => {
    let captured: unknown;
    const adapter = makeAdapter((body) => {
      captured = body;
    });
    const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }), adapter);
    const { res } = makeFastifyRes();
    const err = new Error('boom');
    filter.catch(err, makeHost(err, res));
    expect(adapter.reply).toHaveBeenCalledWith(res, expect.anything(), 500);
    expect((captured as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
  });

  it('sends response via adapter for native http response (middleware error case)', () => {
    let captured: unknown;
    const adapter = makeAdapter((body) => {
      captured = body;
    });
    const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }), adapter);
    const { res } = makeNativeRes();
    const err = new Error('native boom');
    filter.catch(err, makeHost(err, res));
    // 原生响应（无 .code/.send/.status）也交给 adapter.reply，不抛 TypeError。
    expect(adapter.reply).toHaveBeenCalledWith(res, expect.anything(), 500);
    expect((captured as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
  });

  it('ends response when headers already sent', () => {
    const adapter = makeAdapter(() => {});
    (adapter.isHeadersSent as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }), adapter);
    const { res } = makeFastifyRes();
    const err = new Error('boom');
    filter.catch(err, makeHost(err, res));
    expect(adapter.reply).not.toHaveBeenCalled();
    expect(adapter.end).toHaveBeenCalledWith(res);
  });

  it('falls back to direct response handling when no adapter provided', () => {
    const filter = new DomainExceptionFilter(new EnovaLogger({ level: 'silent' }));
    const send = vi.fn();
    const code = vi.fn(() => ({ send }));
    const res = { code, send };
    const err = new Error('boom');
    filter.catch(err, makeHost(err, res));
    expect(code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) }),
    );
  });
});
