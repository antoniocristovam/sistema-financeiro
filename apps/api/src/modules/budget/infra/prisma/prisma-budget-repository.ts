import { Injectable } from '@nestjs/common';
import { Money } from '@finapp/money';
import { type Budget as PrismaBudget, Prisma } from '@prisma/client';

import { isUniqueViolation } from '../../../../shared/database/prisma-errors';
import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../shared/domain/value-objects/month-reference';
import { Budget } from '../../core/domain/entities/budget';
import {
  type BudgetRepository,
  type BudgetView,
} from '../../core/domain/repositories/budget-repository';

function toDomain(raw: PrismaBudget, currency: string): Budget {
  return Budget.create(
    {
      workspaceId: new UniqueEntityId(raw.workspaceId),
      categoryId: new UniqueEntityId(raw.categoryId),
      referenceMonth: MonthReference.fromDate(CalendarDate.fromUtcDate(raw.referenceMonth)),
      limit: Money.fromCents(raw.limitInCents, currency),
      rollover: raw.rollover,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
    new UniqueEntityId(raw.id),
  );
}

/**
 * Consumo de um conjunto de categorias num mes -- COM A REGRA 6.
 *
 * A soma nao e' `SUM(amountInCents)`. Em despesa dividida, o valor cheio saiu
 * da conta e afeta o SALDO, mas o orcamento mede o que e' MEU: a linha marcada
 * `isOwner` em `expense_splits`. Quando nao ha divisao, o valor cheio e' a
 * minha parte.
 *
 * O `COALESCE` faz exatamente isso em uma passada, sem carregar lancamento em
 * memoria: pega a parte do dono quando existe, e o valor do lancamento quando
 * nao existe.
 *
 * Transferencia e pagamento de fatura ficam de fora porque nao sao despesa
 * (regra 4) -- o filtro por `type = 'EXPENSE'` ja garante isso.
 */
function consumedSql(
  workspaceId: string,
  categoryIds: string[],
  month: MonthReference,
): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(SUM(COALESCE(s."amountInCents", t."amountInCents")), 0)::bigint AS total
    FROM "transactions" t
    LEFT JOIN "expense_splits" s
      ON s."transactionId" = t."id" AND s."isOwner" = true
    WHERE t."workspaceId" = ${workspaceId}::uuid
      AND t."type" = 'EXPENSE'
      AND t."categoryId" = ANY(${categoryIds}::uuid[])
      AND t."date" >= ${month.firstDay().toUtcDate()}
      AND t."date" <= ${month.lastDay().toUtcDate()}
  `;
}

@Injectable()
export class PrismaBudgetRepository implements BudgetRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  /**
   * A categoria-mae inclui as filhas.
   *
   * Orcar "Alimentacao" e ver so o que foi lancado exatamente nela -- ignorando
   * Mercado, Restaurante e Delivery -- daria um consumo proximo de zero e um
   * orcamento inutil.
   */
  private async categoryTree(
    workspaceId: UniqueEntityId,
    categoryId: UniqueEntityId,
  ): Promise<string[]> {
    const children = await this.tx.client.category.findMany({
      where: { workspaceId: workspaceId.toValue(), parentId: categoryId.toValue() },
      select: { id: true },
    });

    return [categoryId.toValue(), ...children.map((child) => child.id)];
  }

  private async sumConsumed(
    workspaceId: UniqueEntityId,
    categoryIds: string[],
    month: MonthReference,
  ): Promise<number> {
    const rows = await this.tx.client.$queryRaw<{ total: bigint }[]>(
      consumedSql(workspaceId.toValue(), categoryIds, month),
    );

    return Number(rows[0]?.total ?? 0);
  }

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Budget | null> {
    const raw = await this.tx.client.budget.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: { workspace: { select: { baseCurrency: true } } },
    });

    return raw ? toDomain(raw, raw.workspace.baseCurrency) : null;
  }

  async findByCategoryAndMonth(
    workspaceId: UniqueEntityId,
    categoryId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<Budget | null> {
    const raw = await this.tx.client.budget.findFirst({
      where: {
        workspaceId: workspaceId.toValue(),
        categoryId: categoryId.toValue(),
        referenceMonth: referenceMonth.firstDay().toUtcDate(),
      },
      include: { workspace: { select: { baseCurrency: true } } },
    });

    return raw ? toDomain(raw, raw.workspace.baseCurrency) : null;
  }

  async listByMonth(
    workspaceId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<BudgetView[]> {
    const raws = await this.tx.client.budget.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        referenceMonth: referenceMonth.firstDay().toUtcDate(),
      },
      include: {
        workspace: { select: { baseCurrency: true } },
        category: {
          select: {
            id: true,
            name: true,
            icon: true,
            color: true,
            parent: { select: { name: true } },
          },
        },
      },
      // `id` como desempate: dois orcamentos da mesma categoria-nome nao podem
      // trocar de lugar entre duas leituras.
      orderBy: [{ category: { name: 'asc' } }, { id: 'asc' }],
    });

    const views: BudgetView[] = [];

    for (const raw of raws) {
      const tree = await this.categoryTree(workspaceId, new UniqueEntityId(raw.categoryId));

      views.push({
        budget: toDomain(raw, raw.workspace.baseCurrency),
        category: {
          id: raw.category.id,
          name: raw.category.name,
          icon: raw.category.icon,
          color: raw.category.color,
          parentName: raw.category.parent?.name ?? null,
        },
        consumedInCents: await this.sumConsumed(workspaceId, tree, referenceMonth),
      });
    }

    return views;
  }

  async create(budget: Budget): Promise<void> {
    await this.tx.client.budget.create({ data: this.toPrisma(budget) });
  }

  async createMany(budgets: Budget[]): Promise<void> {
    await this.tx.client.budget.createMany({
      data: budgets.map((budget) => this.toPrisma(budget)),
      skipDuplicates: true,
    });
  }

  async save(budget: Budget): Promise<void> {
    await this.tx.client.budget.update({
      where: { id: budget.id.toValue() },
      data: { limitInCents: budget.limit.toCents(), rollover: budget.rollover },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.budget.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }

  async consumedFor(
    workspaceId: UniqueEntityId,
    categoryId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<number> {
    const tree = await this.categoryTree(workspaceId, categoryId);

    return this.sumConsumed(workspaceId, tree, referenceMonth);
  }

  /**
   * Gasto do mes fora de qualquer categoria orcada.
   *
   * Inclui o que nao tem categoria nenhuma: e' justamente onde o gasto sem
   * controle costuma se esconder.
   */
  async unbudgetedInMonth(
    workspaceId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<number> {
    const budgets = await this.tx.client.budget.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        referenceMonth: referenceMonth.firstDay().toUtcDate(),
      },
      select: { categoryId: true },
    });

    const budgeted = new Set<string>();

    for (const budget of budgets) {
      for (const id of await this.categoryTree(
        workspaceId,
        new UniqueEntityId(budget.categoryId),
      )) {
        budgeted.add(id);
      }
    }

    const ids = [...budgeted];

    const rows = await this.tx.client.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(COALESCE(s."amountInCents", t."amountInCents")), 0)::bigint AS total
      FROM "transactions" t
      LEFT JOIN "expense_splits" s
        ON s."transactionId" = t."id" AND s."isOwner" = true
      WHERE t."workspaceId" = ${workspaceId.toValue()}::uuid
        AND t."type" = 'EXPENSE'
        AND t."date" >= ${referenceMonth.firstDay().toUtcDate()}
        AND t."date" <= ${referenceMonth.lastDay().toUtcDate()}
        AND (t."categoryId" IS NULL OR NOT (t."categoryId" = ANY(${ids}::uuid[])))
    `);

    return Number(rows[0]?.total ?? 0);
  }

  async notifiedThresholds(budgetId: UniqueEntityId): Promise<number[]> {
    const raws = await this.tx.client.budgetAlert.findMany({
      where: { budgetId: budgetId.toValue() },
      select: { threshold: true },
    });

    return raws.map((raw) => raw.threshold);
  }

  async markThresholdNotified(budgetId: UniqueEntityId, threshold: number): Promise<boolean> {
    try {
      await this.tx.client.budgetAlert.create({
        data: { budgetId: budgetId.toValue(), threshold },
      });

      return true;
    } catch (error) {
      // O indice `(budgetId, threshold)` e' a garantia de "uma vez por limiar,
      // por mes": a colisao aqui e' o resultado certo, nao uma falha.
      if (isUniqueViolation(error)) {
        return false;
      }

      throw error;
    }
  }

  async findForAlertJob(referenceMonth: MonthReference, limit: number): Promise<Budget[]> {
    const raws = await this.tx.client.budget.findMany({
      where: { referenceMonth: referenceMonth.firstDay().toUtcDate() },
      include: { workspace: { select: { baseCurrency: true } } },
      orderBy: { id: 'asc' },
      take: limit,
    });

    return raws.map((raw) => toDomain(raw, raw.workspace.baseCurrency));
  }

  private toPrisma(budget: Budget) {
    return {
      id: budget.id.toValue(),
      workspaceId: budget.workspaceId.toValue(),
      categoryId: budget.categoryId.toValue(),
      referenceMonth: budget.referenceMonth.firstDay().toUtcDate(),
      limitInCents: budget.limit.toCents(),
      rollover: budget.rollover,
    };
  }
}
