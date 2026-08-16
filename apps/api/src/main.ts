import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api');

  // O refresh token viaja em cookie httpOnly: sem o parser, o `/auth/refresh`
  // nao enxerga nada.
  app.use(cookieParser());

  // `credentials: true` e' o que permite o navegador MANDAR o cookie de volta
  // em requisicao cross-origin (web em :5173, API em :3333).
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  // Confia no proxy para `request.ip` trazer o IP real do cliente, e nao o do
  // balanceador -- o IP vai para a auditoria e para o rate limit.
  app.set('trust proxy', 1);

  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3333);
  await app.listen(port);

  new Logger('Bootstrap').log(`finapp API em http://localhost:${port}/api`);
}

void bootstrap();
