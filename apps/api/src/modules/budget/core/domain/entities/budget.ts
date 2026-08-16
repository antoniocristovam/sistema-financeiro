import { type Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { BudgetProgress } from '../value-objects/budget-progress';

export interface BudgetProps {
  workspaceId: UniqueEntityId;
  categoryId: UniqueEntityId;
  referenceMonth: MonthReference;
  limit: Money;
  rollover: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Limite mensal de gasto em uma categoria.
 *
 * Orcamento em categoria-mae agrega as filhas; quem monta o `consumed` resolve
 * isso na consulta. E o consumo considera a MINHA PARTE em despesa dividida,
 * nunca o valor cheio (regra 6).
 */
export class Budget extends Entity<BudgetProps> {
  static create(
    props: Optional<BudgetProps, 'rollover' | 'createdAt' | 'updatedAt'>,
    id?: UniqueEntityId,
  ): Budget {
    const now = new Date();

    return new Budget(
      {
        ...props,
        rollover: props.rollover ?? false,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get categoryId(): UniqueEntityId {
    return this.props.categoryId;
  }

  get referenceMonth(): MonthReference {
    return this.props.referenceMonth;
  }

  get limit(): Money {
    return this.props.limit;
  }

  get rollover(): boolean {
    return this.props.rollover;
  }

  /**
   * Progresso do mes.
   *
   * `carryOver` so entra quando o orcamento tem rollover ligado -- passar a
   * sobra sem a flag inflaria o limite silenciosamente.
   */
  progressWith(consumed: Money, carryOver?: Money): BudgetProgress {
    return BudgetProgress.of(
      this.props.limit,
      consumed,
      this.props.rollover ? carryOver : undefined,
    );
  }

  changeLimit(limit: Money): void {
    this.props.limit = limit;
    this.touch();
  }

  setRollover(enabled: boolean): void {
    this.props.rollover = enabled;
    this.touch();
  }

  /** Copia para outro mes -- e' o "copiar orcamentos do mes anterior". */
  copyTo(referenceMonth: MonthReference): Budget {
    return Budget.create({
      workspaceId: this.props.workspaceId,
      categoryId: this.props.categoryId,
      referenceMonth,
      limit: this.props.limit,
      rollover: this.props.rollover,
    });
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
