import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/**
 * Config para pacotes Node/NestJS.
 *
 * A regra de dependencia da Clean Architecture e' enforçada aqui: nada dentro de
 * `core/` pode importar NestJS, Prisma ou qualquer infraestrutura.
 */
export const nodeConfig = tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Incompativel com a DI do Nest: `emitDecoratorMetadata` precisa do
      // import em RUNTIME para preencher `design:paramtypes`. Trocar por
      // `import type` apaga o metadado e o container passa a injetar undefined.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // `core/` e' o dominio puro. Vale tambem para o kernel compartilhado, que
    // as entidades importam.
    files: ['src/modules/*/core/**/*.ts', 'src/shared/domain/**/*.ts', 'src/shared/either.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Pacotes de infraestrutura.
              group: [
                '@nestjs/*',
                '@prisma/*',
                'prisma',
                '.prisma/*',
                'bullmq',
                'minio',
                'express',
                'ioredis',
                'nodemailer',
                'argon2',
                '@node-rs/*',
              ],
              message:
                'core/ nao pode importar infraestrutura. Defina uma porta em core/application/ports e implemente em infra/.',
            },
            {
              /*
               * Caminhos de infraestrutura dentro do proprio projeto.
               *
               * `**​/infra/**` sozinho nao basta: o `PrismaService` mora em
               * `shared/database/`, e sem estes padroes uma entidade poderia
               * importa-lo direto -- exatamente o vazamento que a regra existe
               * para impedir.
               */
              group: [
                '**/infra/**',
                '**/shared/database/**',
                '**/shared/storage/**',
                '**/shared/queue/**',
                '**/shared/mail/**',
                '**/shared/http/**',
                '**/shared/guards/**',
                '**/shared/filters/**',
                '**/shared/decorators/**',
              ],
              message:
                'core/ nao pode importar infraestrutura do projeto. Defina uma porta em core/application/ports e implemente em infra/.',
            },
          ],
        },
      ],
    },
  },
);

export default nodeConfig;
