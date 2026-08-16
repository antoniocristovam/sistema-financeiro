import { Injectable } from '@nestjs/common';
import { type Category as PrismaCategory } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { Category } from '../../core/domain/entities/category';
import { type CategoryRepository } from '../../core/domain/repositories/category-repository';

function toDomain(raw: PrismaCategory): Category {
  return Category.create(
    {
      workspaceId: raw.workspaceId ? new UniqueEntityId(raw.workspaceId) : null,
      name: raw.name,
      type: raw.type,
      icon: raw.icon,
      color: raw.color,
      parentId: raw.parentId ? new UniqueEntityId(raw.parentId) : null,
      sortOrder: raw.sortOrder,
      taxNature: raw.taxNature,
      systemKey: raw.systemKey,
      sourceSystemKey: raw.sourceSystemKey,
      archivedAt: raw.archivedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
    new UniqueEntityId(raw.id),
  );
}

function toPrisma(category: Category) {
  return {
    id: category.id.toValue(),
    workspaceId: category.workspaceId?.toValue() ?? null,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    parentId: category.parentId?.toValue() ?? null,
    sortOrder: category.sortOrder,
    taxNature: category.taxNature,
    systemKey: category.systemKey,
    sourceSystemKey: category.sourceSystemKey,
    archivedAt: category.archivedAt,
  };
}

@Injectable()
export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async listSystemSeeds(): Promise<Category[]> {
    const rows = await this.tx.client.category.findMany({
      where: { workspaceId: null },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });

    return rows.map(toDomain);
  }

  /** Devolve as maes pedidas E as filhas delas -- ver a porta do repositorio. */
  async findSystemByKeys(systemKeys: string[]): Promise<Category[]> {
    if (systemKeys.length === 0) {
      return [];
    }

    const roots = await this.tx.client.category.findMany({
      where: { workspaceId: null, systemKey: { in: systemKeys }, parentId: null },
    });

    const children = await this.tx.client.category.findMany({
      where: { workspaceId: null, parentId: { in: roots.map((root) => root.id) } },
      orderBy: { sortOrder: 'asc' },
    });

    return [...roots, ...children].map(toDomain);
  }

  async listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeArchived?: boolean } = {},
  ): Promise<Category[]> {
    const rows = await this.tx.client.category.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        ...(options.includeArchived === true ? {} : { archivedAt: null }),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });

    return rows.map(toDomain);
  }

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Category | null> {
    const raw = await this.tx.client.category.findFirst({
      // Aceita a semente do sistema (workspace nulo) OU a do proprio workspace.
      // Categoria de OUTRO workspace nao entra -- e' a barreira contra IDOR.
      where: {
        id: id.toValue(),
        OR: [{ workspaceId: workspaceId.toValue() }, { workspaceId: null }],
      },
    });

    return raw ? toDomain(raw) : null;
  }

  async listCopiedSystemKeys(workspaceId: UniqueEntityId): Promise<string[]> {
    const rows = await this.tx.client.category.findMany({
      where: { workspaceId: workspaceId.toValue(), sourceSystemKey: { not: null }, parentId: null },
      select: { sourceSystemKey: true },
    });

    return rows.map((row) => row.sourceSystemKey).filter((key): key is string => key !== null);
  }

  async listChildren(workspaceId: UniqueEntityId, parentId: UniqueEntityId): Promise<Category[]> {
    const rows = await this.tx.client.category.findMany({
      where: { workspaceId: workspaceId.toValue(), parentId: parentId.toValue() },
      orderBy: { sortOrder: 'asc' },
    });

    return rows.map(toDomain);
  }

  async nextSortOrder(
    workspaceId: UniqueEntityId,
    parentId: UniqueEntityId | null,
  ): Promise<number> {
    const last = await this.tx.client.category.findFirst({
      where: { workspaceId: workspaceId.toValue(), parentId: parentId?.toValue() ?? null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return (last?.sortOrder ?? -1) + 1;
  }

  async updatePosition(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
    parentId: UniqueEntityId | null,
    sortOrder: number,
  ): Promise<void> {
    // `updateMany` com o escopo: um `update` por id mexeria na categoria de
    // outro workspace se o id vazasse.
    await this.tx.client.category.updateMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      data: { parentId: parentId?.toValue() ?? null, sortOrder },
    });
  }

  async createMany(categories: Category[]): Promise<void> {
    // Maes primeiro: a filha referencia o id da mae por chave estrangeira.
    const ordered = [...categories].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));

    for (const category of ordered) {
      await this.tx.client.category.create({ data: toPrisma(category) });
    }
  }

  async save(category: Category): Promise<void> {
    const data = toPrisma(category);

    await this.tx.client.category.update({
      where: { id: data.id },
      data: {
        name: data.name,
        icon: data.icon,
        color: data.color,
        parentId: data.parentId,
        sortOrder: data.sortOrder,
        archivedAt: data.archivedAt,
      },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.category.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }
}
