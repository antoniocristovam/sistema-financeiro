// Precisa vir antes do PrismaClient: define DATABASE_URL a partir do .env da raiz.
import './seed-data/env';

import { PrismaClient } from '@prisma/client';

import { SEED_CATEGORIES } from './seed-data/categories';
import { deterministicUuid } from './seed-data/uuid';

/**
 * Seed do SISTEMA. Roda em qualquer ambiente, inclusive producao.
 *
 * Idempotente por construcao: os ids saem de UUID v5 derivado do `systemKey`,
 * entao rodar de novo atualiza as mesmas linhas.
 *
 * Dados de demonstracao ficam em `seed-dev.ts` e nunca rodam em producao.
 */
const prisma = new PrismaClient();

async function seedSystemCategories(): Promise<number> {
  let count = 0;

  for (const group of SEED_CATEGORIES) {
    let parentOrder = 0;

    for (const parent of group.categories) {
      const parentId = deterministicUuid(`category:${parent.key}`);

      await prisma.category.upsert({
        where: { systemKey: parent.key },
        create: {
          id: parentId,
          systemKey: parent.key,
          workspaceId: null,
          parentId: null,
          name: parent.name,
          type: group.type,
          icon: parent.icon ?? null,
          color: parent.color ?? null,
          taxNature: parent.taxNature ?? null,
          sortOrder: parentOrder,
        },
        update: {
          name: parent.name,
          type: group.type,
          icon: parent.icon ?? null,
          color: parent.color ?? null,
          taxNature: parent.taxNature ?? null,
          sortOrder: parentOrder,
          archivedAt: null,
        },
      });
      count += 1;
      parentOrder += 1;

      let childOrder = 0;
      for (const child of parent.children ?? []) {
        await prisma.category.upsert({
          where: { systemKey: child.key },
          create: {
            id: deterministicUuid(`category:${child.key}`),
            systemKey: child.key,
            workspaceId: null,
            parentId,
            name: child.name,
            type: group.type,
            // Sem icone/cor de proposito: a subcategoria herda os da mae.
            icon: child.icon ?? null,
            color: child.color ?? null,
            taxNature: child.taxNature ?? null,
            sortOrder: childOrder,
          },
          update: {
            name: child.name,
            type: group.type,
            parentId,
            icon: child.icon ?? null,
            color: child.color ?? null,
            taxNature: child.taxNature ?? null,
            sortOrder: childOrder,
            archivedAt: null,
          },
        });
        count += 1;
        childOrder += 1;
      }
    }
  }

  return count;
}

async function main(): Promise<void> {
  const categories = await seedSystemCategories();
  console.warn(`[seed] categorias do sistema: ${categories}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[seed] falhou:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
