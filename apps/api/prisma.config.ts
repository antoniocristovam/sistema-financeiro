import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Configuracao do Prisma CLI.
 *
 * Existe por dois motivos:
 *
 * 1. O `.env` mora na RAIZ do monorepo, nao em `apps/api`. Com um
 *    `prisma.config.ts` presente o Prisma para de carregar `.env`
 *    automaticamente, entao carregamos daqui, apontando para a raiz.
 * 2. `package.json#prisma` esta deprecado e sai no Prisma 7.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(here, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
