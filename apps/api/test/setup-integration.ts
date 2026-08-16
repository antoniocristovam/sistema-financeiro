import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeEach } from 'vitest';

/**
 * Setup dos testes de integracao.
 *
 * Cada teste comeca com o banco VAZIO. Reaproveitar estado entre testes cria
 * dependencia de ordem: o teste passa sozinho, falha na suite, e o motivo leva
 * meia hora para achar.
 *
 * `TRUNCATE ... CASCADE` em vez de `DELETE`: e' mais rapido, zera as sequences
 * e nao depende da ordem das chaves estrangeiras.
 */
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;

if (!databaseUrl) {
  throw new Error('DATABASE_URL_TEST nao definido.');
}

// A aplicacao le DATABASE_URL; nos testes ela aponta para o banco de teste.
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';

/*
 * Sem worker de fila na suite.
 *
 * O teste sobe a aplicacao REAL, e com o worker ligado o job diario poderia
 * disparar no meio de um teste -- criando lancamentos que ninguem pediu, num
 * banco que outro teste esta prestes a truncar. As rotinas dos jobs sao
 * chamadas explicitamente pelos testes, que e' onde elas devem ser observadas.
 */
process.env.QUEUE_WORKER_ENABLED = 'false';

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
