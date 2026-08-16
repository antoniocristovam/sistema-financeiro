import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Goal } from '../entities/goal';

export interface ContributionView {
  id: string;
  amountInCents: number;
  date: CalendarDate;
  note: string | null;
  transactionId: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface GoalView {
  goal: Goal;
  linkedAccountName: string | null;
  contributionCount: number;
}

export interface NewContribution {
  id: UniqueEntityId;
  goalId: UniqueEntityId;
  amountInCents: number;
  date: CalendarDate;
  note: string | null;
  createdByUserId: UniqueEntityId;
  /** Preenchido quando a meta tem conta vinculada e o aporte virou transferencia. */
  transactionId: UniqueEntityId | null;
}

export interface GoalRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Goal | null>;
  findViewById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<GoalView | null>;
  listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeArchived: boolean },
  ): Promise<GoalView[]>;

  create(goal: Goal): Promise<void>;
  save(goal: Goal): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;

  /**
   * Aportes de uma meta, do mais recente para o mais antigo.
   *
   * A projecao le TODOS: a media dos ultimos tres meses precisa saber quais
   * meses tiveram zero, e um `take` esconderia justamente os meses vazios.
   */
  contributions(
    workspaceId: UniqueEntityId,
    goalId: UniqueEntityId,
  ): Promise<ContributionView[]>;

  /** Aportes de varias metas de uma vez, para a listagem nao virar N+1. */
  contributionsOfMany(
    workspaceId: UniqueEntityId,
    goalIds: UniqueEntityId[],
  ): Promise<Map<string, ContributionView[]>>;

  addContribution(contribution: NewContribution): Promise<void>;
  removeContribution(
    workspaceId: UniqueEntityId,
    goalId: UniqueEntityId,
    contributionId: UniqueEntityId,
  ): Promise<{ transactionId: string | null } | null>;
}

export const GOAL_REPOSITORY = Symbol('GoalRepository');
