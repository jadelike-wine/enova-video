import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { loadEnv } from '@enova/config';
import { AppModule } from './app.module.js';
import { EnovaLogger } from './common/logger/enova-logger.js';
import { DomainExceptionFilter } from './common/exceptions/domain-exception.filter.js';

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
