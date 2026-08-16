import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

/**
 * Carrega o `.env` da RAIZ do monorepo.
 *
 * Importe este modulo ANTES de instanciar o PrismaClient. O `prisma db seed`
 * passa pelo `prisma.config.ts`, que ja carrega o .env; rodar o script direto
 * (`tsx prisma/seed-dev.ts`) nao passa -- e' este import que cobre os dois casos.
 */
loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
  quiet: true,
});
