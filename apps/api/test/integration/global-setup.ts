import { execSync } from 'node:child_process';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

/**
 * Preparacao do banco de integracao, uma vez por execucao.
 *
 * Aponta para o container `postgres-test` (porta 5433), que roda com `tmpfs` --
 * o volume vive em memoria, entao resetar e' barato e nada sobra entre
 * execucoes.
 *
 * As migrations sao aplicadas com `migrate deploy`, o MESMO comando de
 * producao. Usar `db push` aqui deixaria o schema de teste divergir do que
 * roda de verdade, e o teste passaria contra um banco que nao existe.
 */
export async function setup(): Promise<void> {
  // O vitest roda com o root em apps/api (ver `root` na config). Usar cwd em
  // vez de import.meta mantem o arquivo compilavel tambem em CommonJS.
  const apiRoot = process.cwd();

  loadEnv({ path: path.resolve(apiRoot, '../../.env'), quiet: true });

  const databaseUrl = process.env.DATABASE_URL_TEST;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL_TEST nao definido. Suba o compose (`pnpm infra:up`) e copie .env.example para .env.',
    );
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
