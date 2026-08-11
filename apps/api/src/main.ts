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
  const env = loadEnv();
  const logger = new EnovaLogger();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { logger: false },
  );

  app.useLogger(logger);
  app.useGlobalFilters(new DomainExceptionFilter(logger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie);

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

  await app.listen(env.PORT, env.HOST);
  logger.info('API server started', { port: env.PORT, host: env.HOST });
}

void bootstrap();