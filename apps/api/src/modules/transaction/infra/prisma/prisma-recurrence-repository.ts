import { TransactionStatus } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';

import { isUniqueViolation } from '../../../../shared/database/prisma-errors';
import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { type Recurrence } from '../../core/domain/entities/recurrence';
import {
  type MaterializedOccurrence,
  type RecurrenceRepository,
  type RecurrenceView,
} from '../../core/domain/repositories/recurrence-repository';
import { RecurrenceMapper } from './recurrence-mapper';

/** O nome da conta e da categoria vem do template, que guarda so os ids. */
const VIEW_INCLUDE = {
  workspace: { select: { baseCurrency: true } },
} as const;

@Injectable()
export class PrismaRecurrenceRepository implements RecurrenceRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Recurrence | null> {
    const raw = await this.tx.client.recurrence.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: VIEW_INCLUDE,
    });

    return raw ? RecurrenceMapper.toDomain(raw, raw.workspace.baseCurrency) : null;
  }

  async findViewById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<RecurrenceView | null> {
    const recurrence = await this.findById(workspaceId, id);

    return recurrence ? (await this.decorate([recurrence]))[0]! : null;
  }

  async listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeInactive: boolean },
  ): Promise<RecurrenceView[]> {
    const raws = await this.tx.client.recurrence.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      include: VIEW_INCLUDE,
      // `id` como desempate: duas series criadas no mesmo instante nao podem
      // trocar de lugar entre uma consulta e outra.
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });

    return this.decorate(
      raws.map((raw) => RecurrenceMapper.toDomain(raw, raw.workspace.baseCurrency)),
    );
  }

  /**
   * Resolve nome de conta e de categoria em DUAS consultas, nao em 2N.
   *
   * O template guarda ids; a tela mostra nomes. Sem isso, uma lista de vinte
   * contas fixas viraria quarenta consultas.
   */
  private async decorate(recurrences: Recurrence[]): Promise<RecurrenceView[]> {
    if (recurrences.length === 0) {
      return [];
    }

    const accountIds = [...new Set(recurrences.map((r) => r.template.accountId.toValue()))];
    const categoryIds = [
      ...new Set(
        recurrences
          .map((r) => r.template.categoryId?.toValue())
          .filter((id): id is string => id !== undefined),
      ),
    ];

    const [accounts, categories] = await Promise.all([
      this.tx.client.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, name: true },
      }),
      categoryIds.length > 0
        ? this.tx.client.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

    return recurrences.map((recurrence) => ({
      recurrence,
      accountName: accountNames.get(recurrence.template.accountId.toValue()) ?? '—',
      categoryName: recurrence.template.categoryId
        ? (categoryNames.get(recurrence.template.categoryId.toValue()) ?? null)
        : null,
    }));
  }

  async create(recurrence: Recurrence): Promise<void> {
    await this.tx.client.recurrence.create({ data: RecurrenceMapper.toPrisma(recurrence) });
  }

  async save(recurrence: Recurrence): Promise<void> {
    // `workspaceId` e `createdByUserId` ficam de fora do update de proposito:
    // sao a identidade do registro, e um `save` nunca deveria poder mover uma
    // serie para outro workspace.
    const { id, workspaceId: _workspaceId, createdByUserId: _createdBy, ...data } =
      RecurrenceMapper.toPrisma(recurrence);

    await this.tx.client.recurrence.update({ where: { id }, data });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.recurrence.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }

  async skips(recurrenceId: UniqueEntityId): Promise<CalendarDate[]> {
    const raws = await this.tx.client.recurrenceSkip.findMany({
      where: { recurrenceId: recurrenceId.toValue() },
      select: { occurrenceDate: true },
    });

    return raws.map((raw) => CalendarDate.fromUtcDate(raw.occurrenceDate));
  }

  async addSkip(
    recurrenceId: UniqueEntityId,
    occurrenceDate: CalendarDate,
    reason: string | null,
  ): Promise<void> {
    try {
      await this.tx.client.recurrenceSkip.create({
        data: {
          recurrenceId: recurrenceId.toValue(),
          occurrenceDate: occurrenceDate.toUtcDate(),
          reason,
        },
      });
    } catch (error) {
      // Dispensar duas vezes a mesma data e' a mesma intencao; nao e' conflito.
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  async removeSkip(recurrenceId: UniqueEntityId, occurrenceDate: CalendarDate): Promise<void> {
    await this.tx.client.recurrenceSkip.deleteMany({
      where: {
        recurrenceId: recurrenceId.toValue(),
        occurrenceDate: occurrenceDate.toUtcDate(),
      },
    });
  }

  async materializedOccurrences(
    workspaceId: UniqueEntityId,
    recurrenceId: UniqueEntityId,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<MaterializedOccurrence[]> {
    const raws = await this.tx.client.transaction.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        recurrenceId: recurrenceId.toValue(),
        occurrenceDate: { gte: from.toUtcDate(), lte: to.toUtcDate() },
      },
      select: { id: true, occurrenceDate: true, status: true },
    });

    return raws
      .filter((raw) => raw.occurrenceDate !== null)
      .map((raw) => ({
        occurrenceDate: CalendarDate.fromUtcDate(raw.occurrenceDate!),
        transactionId: raw.id,
        isSettled: raw.status === TransactionStatus.SETTLED,
      }));
  }

  async settledAmounts(
    workspaceId: UniqueEntityId,
    recurrenceId: UniqueEntityId,
    limit: number,
  ): Promise<number[]> {
    const raws = await this.tx.client.transaction.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        recurrenceId: recurrenceId.toValue(),
        status: TransactionStatus.SETTLED,
      },
      select: { amountInCents: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return raws.map((raw) => raw.amountInCents);
  }

  /**
   * Series ativas de todos os workspaces, para o job diario.
   *
   * Paginacao por `id` e nao por offset: o job roda por minutos e novas series
   * entram durante a execucao; com offset, uma insercao no meio faria o lote
   * seguinte PULAR uma serie.
   */
  async findActiveForJob(options: { limit: number; afterId?: string }): Promise<Recurrence[]> {
    const raws = await this.tx.client.recurrence.findMany({
      where: {
        isActive: true,
        ...(options.afterId ? { id: { gt: options.afterId } } : {}),
      },
      include: VIEW_INCLUDE,
      orderBy: { id: 'asc' },
      take: options.limit,
    });

    return raws.map((raw) => RecurrenceMapper.toDomain(raw, raw.workspace.baseCurrency));
  }
}
