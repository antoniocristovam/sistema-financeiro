import { type CategoryType, type TaxIncomeNature } from '@finapp/contracts';

import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  NotAllowedError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import {
  Category,
  type CategoryDepthExceededError,
  type CategoryTypeMismatchError,
  type SystemCategoryError,
} from '../../domain/entities/category';
import { type CategoryRepository } from '../../domain/repositories/category-repository';

type CategoryError =
  | AccessError
  | InvalidValueError
  | ResourceNotFoundError
  | ConflictError
  | NotAllowedError
  | CategoryDepthExceededError
  | CategoryTypeMismatchError
  | SystemCategoryError;

/** Categoria + quantos lancamentos usam ela. */
export interface CategoryWithUsage {
  category: Category;
  transactionCount: number;
}

// -- Listagem -----------------------------------------------------------------

/**
 * Categorias do workspace com a contagem de uso.
 *
 * A contagem existe para a UI decidir entre "excluir" e "arquivar" ANTES de o
 * usuario clicar -- oferecer excluir e falhar depois e' pior do que nao
 * oferecer.
 */
export class ListCategoriesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
    private readonly transactions: TransactionRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
    options: { includeArchived?: boolean } = {},
  ): Promise<Either<AccessError, CategoryWithUsage[]>> {
    const authorized = await this.access.authorize(workspaceId, userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const categories = await this.categories.listByWorkspace(workspaceId, options);
    const counts = await this.transactions.countGroupedByCategory(workspaceId);

    return right(
      categories.map((category) => ({
        category,
        transactionCount: counts.get(category.id.toValue()) ?? 0,
      })),
    );
  }
}

// -- Criacao ------------------------------------------------------------------

export interface CreateCategoryInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  name: string;
  type: CategoryType;
  icon?: string;
  color?: string;
  parentId?: UniqueEntityId | null;
  taxNature?: TaxIncomeNature | null;
}

export class CreateCategoryUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(input: CreateCategoryInput): Promise<Either<CategoryError, Category>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'category:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const category = Category.create({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      type: input.type,
      icon: input.icon ?? null,
      color: input.color ?? null,
      taxNature: input.taxNature ?? null,
      sortOrder: await this.categories.nextSortOrder(input.workspaceId, input.parentId ?? null),
    });

    if (input.parentId) {
      const parent = await this.categories.findById(input.workspaceId, input.parentId);

      if (!parent || parent.isSystem()) {
        return left(new ResourceNotFoundError('Categoria principal'));
      }

      // A entidade decide: nao pode ter tres niveis, nem misturar receita com
      // despesa.
      const moved = category.moveUnder(parent);

      if (moved.isLeft()) {
        return left(moved.value);
      }
    }

    await this.categories.createMany([category]);

    return right(category);
  }
}

// -- Edicao -------------------------------------------------------------------

export interface UpdateCategoryInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  categoryId: UniqueEntityId;
  name?: string;
  icon?: string | null;
  color?: string | null;
  taxNature?: TaxIncomeNature | null;
}

export class UpdateCategoryUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(input: UpdateCategoryInput): Promise<Either<CategoryError, Category>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'category:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const category = await this.categories.findById(input.workspaceId, input.categoryId);

    if (!category) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    if (input.name !== undefined) {
      const renamed = category.rename(input.name.trim());

      // Semente do sistema nao e' editavel: quem quiser mudar ganha uma copia.
      if (renamed.isLeft()) {
        return left(renamed.value);
      }
    }

    if (category.isSystem()) {
      return left(new NotAllowedError('Categorias do sistema nao podem ser alteradas.'));
    }

    category.updateAppearance({
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    });

    if (input.taxNature !== undefined) {
      category.setTaxNature(input.taxNature);
    }

    await this.categories.save(category);

    return right(category);
  }
}

// -- Reordenacao / reparentamento --------------------------------------------

export interface ReorderItem {
  id: UniqueEntityId;
  parentId: UniqueEntityId | null;
  sortOrder: number;
}

export interface ReorderCategoriesInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  items: ReorderItem[];
}

/**
 * Reordenacao e reparentamento em lote (drag-and-drop).
 *
 * Recebe a lista INTEIRA e grava tudo em UMA transacao. Arrastar um item muda
 * a posicao de todos os vizinhos; salvar um por vez deixaria a ordem
 * inconsistente se uma chamada falhasse no meio.
 *
 * A regra dos dois niveis e' validada contra o estado FINAL, nao o inicial:
 * arrastar uma mae para dentro de outra e, no mesmo gesto, tirar as filhas
 * dela, e' legitimo -- validar contra o estado inicial recusaria isso.
 */
export class ReorderCategoriesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: ReorderCategoriesInput): Promise<Either<CategoryError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'category:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const existing = await this.categories.listByWorkspace(input.workspaceId, {
      includeArchived: true,
    });

    const byId = new Map(existing.map((category) => [category.id.toValue(), category]));
    const finalParent = new Map<string, string | null>();

    for (const category of existing) {
      finalParent.set(category.id.toValue(), category.parentId?.toValue() ?? null);
    }

    for (const item of input.items) {
      const id = item.id.toValue();

      if (!byId.has(id)) {
        return left(new ResourceNotFoundError('Categoria'));
      }

      finalParent.set(id, item.parentId?.toValue() ?? null);
    }

    // Valida a arvore RESULTANTE.
    for (const item of input.items) {
      const category = byId.get(item.id.toValue())!;

      if (category.isSystem()) {
        return left(new NotAllowedError('Categorias do sistema nao podem ser reordenadas.'));
      }

      const parentId = item.parentId?.toValue() ?? null;

      if (parentId === null) {
        continue;
      }

      const parent = byId.get(parentId);

      if (!parent) {
        return left(new ResourceNotFoundError('Categoria principal'));
      }

      if (parent.type !== category.type) {
        return left(
          new InvalidValueError(
            'Uma subcategoria precisa ser do mesmo tipo da categoria principal.',
            'parentId',
          ),
        );
      }

      if (parentId === item.id.toValue()) {
        return left(new InvalidValueError('Uma categoria nao pode ser mae de si mesma.', 'parentId'));
      }

      // A mae escolhida nao pode, ela propria, ter mae no estado final.
      if (finalParent.get(parentId) !== null) {
        return left(
          new InvalidValueError(
            'Categorias tem no maximo dois niveis. Escolha uma categoria principal.',
            'parentId',
          ),
        );
      }

      // E esta categoria nao pode ter filhas se esta virando filha.
      const hasChildren = [...finalParent.entries()].some(
        ([childId, childParent]) => childParent === item.id.toValue() && childId !== item.id.toValue(),
      );

      if (hasChildren) {
        return left(
          new InvalidValueError(
            'Esta categoria tem subcategorias. Mova-as antes de transforma-la em subcategoria.',
            'parentId',
          ),
        );
      }
    }

    await this.unitOfWork.run(async () => {
      for (const item of input.items) {
        await this.categories.updatePosition(
          input.workspaceId,
          item.id,
          item.parentId,
          item.sortOrder,
        );
      }
    });

    return right(undefined);
  }
}

// -- Arquivar -----------------------------------------------------------------

export interface ArchiveCategoryInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  categoryId: UniqueEntityId;
  archived: boolean;
}

export class ArchiveCategoryUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ArchiveCategoryInput): Promise<Either<CategoryError, Category>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'category:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const category = await this.categories.findById(input.workspaceId, input.categoryId);

    if (!category || category.isSystem()) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    if (input.archived) {
      category.archive(this.clock.now());
    } else {
      category.unarchive();
    }

    await this.categories.save(category);

    return right(category);
  }
}

// -- Exclusao com realocacao --------------------------------------------------

export interface DeleteCategoryInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  categoryId: UniqueEntityId;
  /** Para onde os lancamentos existentes vao. */
  reassignToId?: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Exclusao de categoria.
 *
 * Se houver lancamento vinculado, EXIGE um destino. Apagar sem realocar
 * deixaria transacoes sem categoria e um buraco no relatorio por categoria --
 * o dinheiro sumiria de um grafico que precisa somar o total.
 *
 * A subcategoria vai junto: uma filha orfa nao tem onde aparecer.
 */
export class DeleteCategoryUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: DeleteCategoryInput): Promise<Either<CategoryError, { reassigned: number }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'category:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const category = await this.categories.findById(input.workspaceId, input.categoryId);

    if (!category || category.isSystem()) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    const children = await this.categories.listChildren(input.workspaceId, input.categoryId);
    const affectedIds = [category.id, ...children.map((child) => child.id)];

    const usage = await this.transactions.countByCategory(input.workspaceId, affectedIds);

    if (usage > 0 && !input.reassignToId) {
      return left(
        new ConflictError(
          `Esta categoria tem ${usage} lancamento(s). Escolha uma categoria de destino para realoca-los.`,
        ),
      );
    }

    if (input.reassignToId) {
      if (affectedIds.some((id) => id.equals(input.reassignToId!))) {
        return left(
          new InvalidValueError(
            'A categoria de destino nao pode ser a que esta sendo excluida.',
            'reassignToId',
          ),
        );
      }

      const destination = await this.categories.findById(input.workspaceId, input.reassignToId);

      if (!destination) {
        return left(new ResourceNotFoundError('Categoria de destino'));
      }

      if (destination.type !== category.type) {
        return left(
          new InvalidValueError(
            'A categoria de destino precisa ser do mesmo tipo.',
            'reassignToId',
          ),
        );
      }
    }

    let reassigned = 0;

    await this.unitOfWork.run(async () => {
      if (usage > 0 && input.reassignToId) {
        reassigned = await this.transactions.reassignCategory(
          input.workspaceId,
          affectedIds,
          input.reassignToId,
        );
      }

      // Filhas primeiro: a mae tem chave estrangeira apontando para ela.
      for (const child of children) {
        await this.categories.delete(input.workspaceId, child.id);
      }

      await this.categories.delete(input.workspaceId, input.categoryId);
    });

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.userId.toValue(),
      action: 'CATEGORY_DELETED',
      entityType: 'Category',
      entityId: input.categoryId.toValue(),
      metadata: {
        name: category.name,
        children: children.length,
        reassigned,
        reassignedTo: input.reassignToId?.toValue() ?? null,
      },
      ipAddress: input.ipAddress,
    });

    return right({ reassigned });
  }
}
