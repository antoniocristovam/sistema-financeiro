import { Injectable } from '@nestjs/common';
import { Money } from '@finapp/money';
import { type Goal as PrismaGoal } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { Goal } from '../../core/domain/entities/goal';
import {
  type ContributionView,
  type GoalRepository,
  type GoalView,
  type NewContribution,
} from '../../core/domain/repositories/goal-repository';

function toDomain(raw: PrismaGoal, currency: string): Goal {
  return Goal.create(
    {
      workspaceId: new UniqueEntityId(raw.workspaceId),
      name: raw.name,
      targetAmount: Money.fromCents(raw.targetAmountInCents, currency),
      deadline: raw.deadline ? CalendarDate.fromUtcDate(raw.deadline) : null,
      icon: raw.icon,
      color: raw.color,
      linkedAccountId: raw.linkedAccountId ? new UniqueEntityId(raw.linkedAccountId) : null,
      achievedAt: raw.achievedAt,
      archivedAt: raw.archivedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
    new UniqueEntityId(raw.id),
  );
}

const INCLUDE = {
  workspace: { select: { baseCurrency: true } },
  linkedAccount: { select: { name: true } },
  _count: { select: { contributions: true } },
} as const;

@Injectable()
export class PrismaGoalRepository implements GoalRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Goal | null> {
    const raw = await this.tx.client.goal.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: { workspace: { select: { baseCurrency: true } } },
    });

    return raw ? toDomain(raw, raw.workspace.baseCurrency) : null;
  }

  async findViewById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<GoalView | null> {
    const raw = await this.tx.client.goal.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: INCLUDE,
    });

    if (!raw) {
      return null;
    }

    return {
      goal: toDomain(raw, raw.workspace.baseCurrency),
      linkedAccountName: raw.linkedAccount?.name ?? null,
      contributionCount: raw._count.contributions,
    };
  }

  async listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeArchived: boolean },
  ): Promise<GoalView[]> {
    const raws = await this.tx.client.goal.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      include: INCLUDE,
      // Concluidas por ultimo; entre as ativas, a mais recente primeiro. O id
      // desempata metas criadas no mesmo instante.
      orderBy: [{ achievedAt: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });

    return raws.map((raw) => ({
      goal: toDomain(raw, raw.workspace.baseCurrency),
      linkedAccountName: raw.linkedAccount?.name ?? null,
      contributionCount: raw._count.contributions,
    }));
  }

  async create(goal: Goal): Promise<void> {
    await this.tx.client.goal.create({
      data: {
        id: goal.id.toValue(),
        workspaceId: goal.workspaceId.toValue(),
        name: goal.name,
        targetAmountInCents: goal.targetAmount.toCents(),
        deadline: goal.deadline?.toUtcDate() ?? null,
        icon: goal.icon,
        color: goal.color,
        linkedAccountId: goal.linkedAccountId?.toValue() ?? null,
      },
    });
  }

  async save(goal: Goal): Promise<void> {
    await this.tx.client.goal.update({
      where: { id: goal.id.toValue() },
      data: {
        name: goal.name,
        targetAmountInCents: goal.targetAmount.toCents(),
        deadline: goal.deadline?.toUtcDate() ?? null,
        icon: goal.icon,
        color: goal.color,
        achievedAt: goal.achievedAt,
        archivedAt: goal.archivedAt,
      },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.goal.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }

  async contributions(
    workspaceId: UniqueEntityId,
    goalId: UniqueEntityId,
  ): Promise<ContributionView[]> {
    const raws = await this.tx.client.goalContribution.findMany({
      where: { goalId: goalId.toValue(), goal: { workspaceId: workspaceId.toValue() } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });

    return raws.map((raw) => ({
      id: raw.id,
      amountInCents: raw.amountInCents,
      date: CalendarDate.fromUtcDate(raw.date),
      note: raw.note,
      transactionId: raw.transactionId,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
    }));
  }

  async contributionsOfMany(
    workspaceId: UniqueEntityId,
    goalIds: UniqueEntityId[],
  ): Promise<Map<string, ContributionView[]>> {
    if (goalIds.length === 0) {
      return new Map();
    }

    const raws = await this.tx.client.goalContribution.findMany({
      where: {
        goalId: { in: goalIds.map((id) => id.toValue()) },
        goal: { workspaceId: workspaceId.toValue() },
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });

    const byGoal = new Map<string, ContributionView[]>();

    for (const raw of raws) {
      const list = byGoal.get(raw.goalId) ?? [];

      list.push({
        id: raw.id,
        amountInCents: raw.amountInCents,
        date: CalendarDate.fromUtcDate(raw.date),
        note: raw.note,
        transactionId: raw.transactionId,
        createdBy: raw.createdBy,
        createdAt: raw.createdAt,
      });

      byGoal.set(raw.goalId, list);
    }

    return byGoal;
  }

  async addContribution(contribution: NewContribution): Promise<void> {
    await this.tx.client.goalContribution.create({
      data: {
        id: contribution.id.toValue(),
        goalId: contribution.goalId.toValue(),
        amountInCents: contribution.amountInCents,
        date: contribution.date.toUtcDate(),
        note: contribution.note,
        createdByUserId: contribution.createdByUserId.toValue(),
        transactionId: contribution.transactionId?.toValue() ?? null,
      },
    });
  }

  async removeContribution(
    workspaceId: UniqueEntityId,
    goalId: UniqueEntityId,
    contributionId: UniqueEntityId,
  ): Promise<{ transactionId: string | null } | null> {
    const raw = await this.tx.client.goalContribution.findFirst({
      where: {
        id: contributionId.toValue(),
        goalId: goalId.toValue(),
        goal: { workspaceId: workspaceId.toValue() },
      },
      select: { id: true, transactionId: true },
    });

    if (!raw) {
      return null;
    }

    await this.tx.client.goalContribution.delete({ where: { id: raw.id } });

    return { transactionId: raw.transactionId };
  }
}
