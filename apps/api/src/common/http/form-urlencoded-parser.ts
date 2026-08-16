import type { FastifyInstance, FastifyRequest } from 'fastify';

const MAX_WEBHOOK_BODY_SIZE = 1 << 20;

function parseFormUrlencoded(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = idx >= 0 ? pair.slice(0, idx) : pair;
    const val = idx >= 0 ? pair.slice(idx + 1) : '';
    out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(val.replace(/\+/g, ' '));
  }
  return out;
}

/** Replace Fastify's built-in form parser after Nest has initialized it. */
export function installRawFormUrlencodedParser(fastify: FastifyInstance): void {
  fastify.removeContentTypeParser('application/x-www-form-urlencoded');
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (buffer.length > MAX_WEBHOOK_BODY_SIZE) {
        done(new Error(`Payload too large: ${buffer.length} bytes exceeds ${MAX_WEBHOOK_BODY_SIZE} limit`));
        return;
      }
      try {
        const raw = buffer.toString('utf8');
        (request as FastifyRequest & { rawBody?: Buffer }).rawBody = buffer;
        done(null, parseFormUrlencoded(raw));
      } catch (error) {
        done(error as Error);
      }
    },
  );
}
