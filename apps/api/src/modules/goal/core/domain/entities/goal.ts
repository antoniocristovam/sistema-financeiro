import { type Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import {
  GoalProjection,
  type ContributionRecord,
  type GoalProjectionResult,
} from '../value-objects/goal-projection';

export interface GoalProps {
  workspaceId: UniqueEntityId;
  name: string;
  targetAmount: Money;
  deadline: CalendarDate | null;
  icon: string | null;
  color: string | null;
  /** Conta de reserva. Se preenchida, o aporte gera uma transferencia real. */
  linkedAccountId: UniqueEntityId | null;
  achievedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Cofrinho: um alvo em dinheiro, com prazo opcional. */
export class Goal extends Entity<GoalProps> {
  static create(
    props: Optional<
      GoalProps,
      | 'deadline'
      | 'icon'
      | 'color'
      | 'linkedAccountId'
      | 'achievedAt'
      | 'archivedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): Goal {
    const now = new Date();

    return new Goal(
      {
        ...props,
        deadline: props.deadline ?? null,
        icon: props.icon ?? null,
        color: props.color ?? null,
        linkedAccountId: props.linkedAccountId ?? null,
        achievedAt: props.achievedAt ?? null,
        archivedAt: props.archivedAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get name(): string {
    return this.props.name;
  }

  get targetAmount(): Money {
    return this.props.targetAmount;
  }

  get deadline(): CalendarDate | null {
    return this.props.deadline;
  }

  get icon(): string | null {
    return this.props.icon;
  }

  get color(): string | null {
    return this.props.color;
  }

  get linkedAccountId(): UniqueEntityId | null {
    return this.props.linkedAccountId;
  }

  get achievedAt(): Date | null {
    return this.props.achievedAt;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt;
  }

  isAchieved(): boolean {
    return this.props.achievedAt !== null;
  }

  isArchived(): boolean {
    return this.props.archivedAt !== null;
  }

  /** Aporte gera transferencia real quando ha conta de reserva vinculada. */
  hasLinkedAccount(): boolean {
    return this.props.linkedAccountId !== null;
  }

  /** "Nesse ritmo, quando eu chego la?" */
  project(contributions: readonly ContributionRecord[], today: CalendarDate): GoalProjectionResult {
    return GoalProjection.calculate({
      target: this.props.targetAmount,
      contributions,
      today,
      deadline: this.props.deadline,
    });
  }

  /** Idempotente: bater 100% de novo nao remarca a data da comemoracao. */
  markAchieved(now: Date = new Date()): void {
    if (this.props.achievedAt === null) {
      this.props.achievedAt = now;
      this.touch();
    }
  }

  /** Um saque derruba o total abaixo do alvo: a meta deixa de estar batida. */
  clearAchievement(): void {
    if (this.props.achievedAt !== null) {
      this.props.achievedAt = null;
      this.touch();
    }
  }

  changeTarget(targetAmount: Money): void {
    this.props.targetAmount = targetAmount;
    this.touch();
  }

  changeDeadline(deadline: CalendarDate | null): void {
    this.props.deadline = deadline;
    this.touch();
  }

  archive(now: Date = new Date()): void {
    if (this.props.archivedAt === null) {
      this.props.archivedAt = now;
      this.touch();
    }
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
