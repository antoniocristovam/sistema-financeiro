import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma gerenciado pelo ciclo de vida do Nest.
 *
 * Vive em `shared/` e so pode ser importado por `infra/`. Nenhum arquivo dentro
 * de `core/` enxerga esta classe -- a regra de dependencia esta no ESLint
 * (`@finapp/config/eslint/node`).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
