import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { installRawFormUrlencodedParser } from './form-urlencoded-parser.js';

describe('installRawFormUrlencodedParser', () => {
  it('replaces Fastify default parser and preserves raw form bytes', async () => {
    const server = Fastify({ logger: false });

    installRawFormUrlencodedParser(server);
    server.post('/', async (request) => ({
      body: request.body,
      rawBody: (request as typeof request & { rawBody?: Buffer }).rawBody?.toString('utf8'),
    }));

    const response = await server.inject({
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'trade_status=TRADE_SUCCESS&sign=raw%2Bvalue',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      body: { trade_status: 'TRADE_SUCCESS', sign: 'raw+value' },
      rawBody: 'trade_status=TRADE_SUCCESS&sign=raw%2Bvalue',
    });

    await server.close();
  });
});
