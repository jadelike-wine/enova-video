import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { loadEnv } from '@enova/config';
import { AppModule } from './app.module.js';
import { EnovaLogger } from './common/logger/enova-logger.js';
import { DomainExceptionFilter } from './common/exceptions/domain-exception.filter.js';

/** 解析 application/x-www-form-urlencoded body 为简单 key-value 对象。 */
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

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env, { service: 'api' });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { logger: false },
  );

  const logger = app.get(EnovaLogger);
  app.useLogger(logger);
  // 传入 httpAdapter 供异常过滤器发送响应：兼容 FastifyReply 与
  // middleware 抛错时传入的原生 http 响应（见 DomainExceptionFilter）。
  app.useGlobalFilters(new DomainExceptionFilter(logger, app.getHttpAdapter()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // ---- P0: CORS strict allowlist ----
  // Parse allowed origins from CORS_ALLOWED_ORIGINS (comma-separated).
  // Only origins in the list are allowed; credentials only for listed origins.
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Step-Up-Password'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86400,
  });

  await app.register(cookie);

  // ---- P0: Raw body capture for payment webhook signature verification ----
  // 支付宝异步通知使用 application/x-www-form-urlencoded，Fastify 默认只把 body
  // 解析为 JS 对象，不保留 raw bytes。验签需要原始未重编码的 body 字符串，
  // 否则 JSON.stringify(req.body) 会把 k=v&k2=v2 → {"k":"v","k2":"v2"}，
  // 签名字符串完全变化，验签必然失败。
  // 参考 sub2api：直接 io.ReadAll(req.Body) 拿原始字符串验签。
  // RISK-2: 限制 webhook 请求体大小为 1MB（参考 sub2api maxWebhookBodySize = 1 << 20）。
  // 支付宝/微信异步通知的 body 通常不超过几 KB，1MB 足够覆盖合法通知，同时防止 DoS 攻击。
  const MAX_WEBHOOK_BODY_SIZE = 1 << 20; // 1MB

  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (req, body, done) => {
      // RISK-2: 请求体大小校验。
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (buf.length > MAX_WEBHOOK_BODY_SIZE) {
        done(new Error(`Payload too large: ${buf.length} bytes exceeds ${MAX_WEBHOOK_BODY_SIZE} limit`), undefined);
        return;
      }
      // 同时保留 rawBody（Buffer）和 parsed body（对象），供 controller 验签使用。
      try {
        const raw = buf.toString('utf8');
        const parsed = parseFormUrlencoded(raw);
        (req as FastifyRequest & { rawBody?: Buffer }).rawBody = buf;
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // ---- P0: Swagger protection ----
  // Swagger docs only enabled when SWAGGER_ENABLED=true (default: false).
  // In production, must be explicitly enabled (e.g. for internal/staging access).
  if (env.SWAGGER_ENABLED) {
    const documentConfig = new DocumentBuilder()
      .setTitle('Enova Creator API')
      .setDescription('灵动创影 AI Creator SaaS 后端 API')
      .setVersion('1.0.0')
      .addTag('health')
      .build();
    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('api/v1/docs', app, document);

    // 将 OpenAPI 落盘供 packages/sdk 生成 TS 类型（写入 apps/api/openapi.json）
    writeFileSync(join(__dirname, '..', 'openapi.json'), JSON.stringify(document, null, 2));
    logger.warn('Swagger docs enabled at /api/v1/docs — ensure this is not exposed in production.');
  } else {
    // Still write openapi.json for SDK generation (non-serving).
    const documentConfig = new DocumentBuilder()
      .setTitle('Enova Creator API')
      .setDescription('灵动创影 AI Creator SaaS 后端 API')
      .setVersion('1.0.0')
      .addTag('health')
      .build();
    const document = SwaggerModule.createDocument(app, documentConfig);
    writeFileSync(join(__dirname, '..', 'openapi.json'), JSON.stringify(document, null, 2));
  }

  await app.listen(env.PORT, env.HOST);
  logger.info('API server started', {
    port: env.PORT,
    host: env.HOST,
    env: env.NODE_ENV,
    swagger: env.SWAGGER_ENABLED,
    corsOrigins: allowedOrigins.length,
  });
}

void bootstrap();
