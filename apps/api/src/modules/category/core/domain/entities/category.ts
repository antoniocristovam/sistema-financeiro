import { ApiErrorCode, type CategoryType, type TaxIncomeNature } from '@finapp/contracts';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';

export class CategoryDepthExceededError extends DomainError {
  readonly code = ApiErrorCode.CATEGORY_DEPTH_EXCEEDED;
  readonly message = 'Categorias tem no maximo dois niveis. Escolha uma categoria principal.';
}

export class SystemCategoryError extends DomainError {
  readonly code = ApiErrorCode.FORBIDDEN;
  readonly message = 'Categorias do sistema nao podem ser alteradas. Crie uma copia sua.';
}

export class CategoryTypeMismatchError extends DomainError {
  readonly code = ApiErrorCode.VALIDATION_FAILED;
  readonly message = 'Uma subcategoria precisa ser do mesmo tipo da categoria principal.';
}

export interface CategoryProps {
  /** Nulo = categoria semente do sistema, visivel para todos e nao editavel. */
  workspaceId: UniqueEntityId | null;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  parentId: UniqueEntityId | null;
  sortOrder: number;
  taxNature: TaxIncomeNature | null;
  /// Identidade da semente do sistema. So a semente global tem.
  systemKey: string | null;
  /// Semente de origem, quando esta categoria e uma copia no workspace.
  sourceSystemKey: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Categoria de lancamento, com hierarquia de NO MAXIMO dois niveis.
 *
 * O limite de dois niveis nao e' arbitrario: relatorio agrega por
 * categoria-mae com drill-down para as filhas. Um terceiro nivel obrigaria o
 * relatorio a decidir em que nivel agregar, e a resposta seria diferente em
 * cada tela.
 *
 * Subcategoria HERDA icone e cor da mae quando nao define os seus -- e' por isso
 * que as sementes vem sem icone nas filhas.
 */
export class Category extends Entity<CategoryProps> {
  static create(
    props: Optional<
      CategoryProps,
      | 'icon'
      | 'color'
      | 'parentId'
      | 'sortOrder'
      | 'taxNature'
      | 'systemKey'
      | 'sourceSystemKey'
      | 'archivedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): Category {
    const now = new Date();

    return new Category(
      {
        ...props,
        icon: props.icon ?? null,
        color: props.color ?? null,
        parentId: props.parentId ?? null,
        sortOrder: props.sortOrder ?? 0,
        taxNature: props.taxNature ?? null,
        systemKey: props.systemKey ?? null,
        sourceSystemKey: props.sourceSystemKey ?? null,
        archivedAt: props.archivedAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId | null {
    return this.props.workspaceId;
  }

  get name(): string {
    return this.props.name;
  }

  get type(): CategoryType {
    return this.props.type;
  }

  get icon(): string | null {
    return this.props.icon;
  }

  get color(): string | null {
    return this.props.color;
  }

  get parentId(): UniqueEntityId | null {
    return this.props.parentId;
  }

  get sortOrder(): number {
    return this.props.sortOrder;
  }

  get taxNature(): TaxIncomeNature | null {
    return this.props.taxNature;
  }

  get systemKey(): string | null {
    return this.props.systemKey;
  }

  get sourceSystemKey(): string | null {
    return this.props.sourceSystemKey;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt;
  }

  isSystem(): boolean {
    return this.props.workspaceId === null;
  }

  isRoot(): boolean {
    return this.props.parentId === null;
  }

  isArchived(): boolean {
    return this.props.archivedAt !== null;
  }

  /** So categoria-mae pode receber filhas -- e' o que garante os dois niveis. */
  canBeParent(): boolean {
    return this.isRoot();
  }

  /**
   * Copia esta categoria para dentro de um workspace.
   *
   * E' o que o passo 4 do onboarding faz: a semente do sistema nao e' editavel,
   * entao o usuario recebe uma copia propria, que ele pode renomear e arquivar.
   *
   * A copia guarda a origem em `sourceSystemKey`, e NAO em `systemKey`: ela
   * veio da semente, mas nao e a semente. Com um campo so, as duas colidiriam
   * no indice unico global.
   */
  copyToWorkspace(workspaceId: UniqueEntityId, parentId?: UniqueEntityId): Category {
    return Category.create({
      workspaceId,
      name: this.props.name,
      type: this.props.type,
      icon: this.props.icon,
      color: this.props.color,
      parentId: parentId ?? null,
      sortOrder: this.props.sortOrder,
      taxNature: this.props.taxNature,
      // A copia NAO e a semente: ela aponta para a origem em outro campo.
      systemKey: null,
      sourceSystemKey: this.props.systemKey,
    });
  }

  /** Icone efetivo, ja com a heranca da mae aplicada. */
  effectiveIcon(parent?: Category): string | null {
    return this.props.icon ?? parent?.icon ?? null;
  }

  effectiveColor(parent?: Category): string | null {
    return this.props.color ?? parent?.color ?? null;
  }

  /**
   * Vira filha de `parent`.
   *
   * Falha se a candidata a mae ja for uma subcategoria (terceiro nivel) ou se
   * os tipos divergirem -- uma subcategoria de despesa dentro de uma
   * categoria de receita quebraria todo relatorio.
   */
  moveUnder(
    parent: Category,
  ): Either<CategoryDepthExceededError | CategoryTypeMismatchError | SystemCategoryError, void> {
    if (this.isSystem()) {
      return left(new SystemCategoryError());
    }

    if (!parent.canBeParent()) {
      return left(new CategoryDepthExceededError());
    }

    if (parent.type !== this.props.type) {
      return left(new CategoryTypeMismatchError());
    }

    this.props.parentId = parent.id;
    this.touch();

    return right(undefined);
  }

  /** Promove a categoria principal. */
  moveToRoot(): Either<SystemCategoryError, void> {
    if (this.isSystem()) {
      return left(new SystemCategoryError());
    }

    this.props.parentId = null;
    this.touch();

    return right(undefined);
  }

  rename(name: string): Either<SystemCategoryError, void> {
    if (this.isSystem()) {
      return left(new SystemCategoryError());
    }

    this.props.name = name;
    this.touch();

    return right(undefined);
  }

  updateAppearance(changes: { icon?: string | null; color?: string | null }): void {
    if (changes.icon !== undefined) this.props.icon = changes.icon;
    if (changes.color !== undefined) this.props.color = changes.color;
    this.touch();
  }

  /** Natureza fiscal do rendimento (IRPF). So faz sentido em categoria INCOME. */
  setTaxNature(taxNature: TaxIncomeNature | null): void {
    this.props.taxNature = taxNature;
    this.touch();
  }

  reorder(sortOrder: number): void {
    this.props.sortOrder = sortOrder;
    this.touch();
  }

  /** Arquivar em vez de excluir quando ha lancamento vinculado. */
  archive(now: Date = new Date()): void {
    if (this.props.archivedAt === null) {
      this.props.archivedAt = now;
      this.touch();
    }
  }

  unarchive(): void {
    this.props.archivedAt = null;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
