import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Category } from '../entities/category';

/**
 * Porta do repositorio de categorias.
 *
 * As sementes do sistema (`workspaceId` nulo) tem metodos proprios: elas sao
 * globais e nao pertencem a workspace nenhum, entao passar `workspaceId` nelas
 * seria mentira. Tudo que e' do workspace continua escopado.
 */
export interface CategoryRepository {
  /** Sementes do sistema, maes e filhas, em ordem de exibicao. */
  listSystemSeeds(): Promise<Category[]>;
  /**
   * Sementes pelas chaves, JUNTO com as filhas de cada mae encontrada.
   *
   * As filhas vem mesmo sem terem sido pedidas: copiar "Alimentacao" sem
   * "Mercado" e "Restaurante" deixaria a arvore pela metade e o drill-down do
   * relatorio vazio.
   */
  findSystemByKeys(systemKeys: string[]): Promise<Category[]>;

  listByWorkspace(
    workspaceId: UniqueEntityId,
    options?: { includeArchived?: boolean },
  ): Promise<Category[]>;
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Category | null>;
  /** Chaves de semente ja copiadas para o workspace. */
  listCopiedSystemKeys(workspaceId: UniqueEntityId): Promise<string[]>;

  listChildren(workspaceId: UniqueEntityId, parentId: UniqueEntityId): Promise<Category[]>;
  /** Proxima posicao livre dentro de um nivel, para o item novo entrar no fim. */
  nextSortOrder(workspaceId: UniqueEntityId, parentId: UniqueEntityId | null): Promise<number>;
  /** Grava posicao e mae de um item -- usado pela reordenacao em lote. */
  updatePosition(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
    parentId: UniqueEntityId | null,
    sortOrder: number,
  ): Promise<void>;

  createMany(categories: Category[]): Promise<void>;
  save(category: Category): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;
}

export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');
