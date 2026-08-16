import {
  type NotificationRequest,
  type Notifier,
} from '../../src/shared/application/ports/notifier';
import { type UniqueEntityId } from '../../src/shared/domain/unique-entity-id';
import { type CalendarDate } from '../../src/shared/domain/value-objects/calendar-date';
import { type Account } from '../../src/modules/account/core/domain/entities/account';
import {
  type AccountRepository,
  type AccountWithCard,
} from '../../src/modules/account/core/domain/repositories/account-repository';
import { type Category } from '../../src/modules/category/core/domain/entities/category';
import { type CategoryRepository } from '../../src/modules/category/core/domain/repositories/category-repository';
import { type Recurrence } from '../../src/modules/transaction/core/domain/entities/recurrence';
import { type Transaction } from '../../src/modules/transaction/core/domain/entities/transaction';
import {
  type MaterializedOccurrence,
  type RecurrenceRepository,
  type RecurrenceView,
} from '../../src/modules/transaction/core/domain/repositories/recurrence-repository';

/**
 * Dubles das contas fixas.
 *
 * Sao implementacoes parciais das portas: o job usa um punhado de metodos, e
 * implementar os trinta restantes so para satisfazer o compilador esconderia
 * quais dependencias a rotina realmente tem. O que ela nao chama, estoura.
 */

export class InMemoryRecurrenceRepository implements RecurrenceRepository {
  readonly items: Recurrence[] = [];
  readonly skipList: { recurrenceId: string; date: CalendarDate; reason: string | null }[] = [];
  readonly occurrences: (MaterializedOccurrence & { recurrenceId: string })[] = [];
  settled: number[] = [];

  async findById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<Recurrence | null> {
    return (
      this.items.find(
        (item) => item.id.equals(id) && item.workspaceId.equals(workspaceId),
      ) ?? null
    );
  }

  async findViewById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<RecurrenceView | null> {
    const recurrence = await this.findById(workspaceId, id);

    return recurrence ? { recurrence, accountName: 'Conta corrente', categoryName: null } : null;
  }

  async listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeInactive: boolean },
  ): Promise<RecurrenceView[]> {
    return this.items
      .filter(
        (item) =>
          item.workspaceId.equals(workspaceId) && (options.includeInactive || item.isActive),
      )
      .map((recurrence) => ({ recurrence, accountName: 'Conta corrente', categoryName: null }));
  }

  async create(recurrence: Recurrence): Promise<void> {
    this.items.push(recurrence);
  }

  async save(recurrence: Recurrence): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(recurrence.id));

    if (index >= 0) {
      this.items[index] = recurrence;
    }
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.id.equals(id) && item.workspaceId.equals(workspaceId),
    );

    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }

  async skips(recurrenceId: UniqueEntityId): Promise<CalendarDate[]> {
    return this.skipList
      .filter((skip) => skip.recurrenceId === recurrenceId.toValue())
      .map((skip) => skip.date);
  }

  async addSkip(
    recurrenceId: UniqueEntityId,
    occurrenceDate: CalendarDate,
    reason: string | null,
  ): Promise<void> {
    if (
      this.skipList.some(
        (skip) =>
          skip.recurrenceId === recurrenceId.toValue() && skip.date.equals(occurrenceDate),
      )
    ) {
      return;
    }

    this.skipList.push({ recurrenceId: recurrenceId.toValue(), date: occurrenceDate, reason });
  }

  async removeSkip(recurrenceId: UniqueEntityId, occurrenceDate: CalendarDate): Promise<void> {
    const index = this.skipList.findIndex(
      (skip) => skip.recurrenceId === recurrenceId.toValue() && skip.date.equals(occurrenceDate),
    );

    if (index >= 0) {
      this.skipList.splice(index, 1);
    }
  }

  async materializedOccurrences(
    _workspaceId: UniqueEntityId,
    recurrenceId: UniqueEntityId,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<MaterializedOccurrence[]> {
    return this.occurrences
      .filter(
        (entry) =>
          entry.recurrenceId === recurrenceId.toValue() &&
          entry.occurrenceDate.isBetween(from, to),
      )
      .map(({ recurrenceId: _id, ...rest }) => rest);
  }

  async settledAmounts(): Promise<number[]> {
    return this.settled;
  }

  async findActiveForJob(options: { limit: number; afterId?: string }): Promise<Recurrence[]> {
    return this.items
      .filter((item) => item.isActive)
      .sort((a, b) => a.id.toValue().localeCompare(b.id.toValue()))
      .filter((item) => (options.afterId ? item.id.toValue() > options.afterId : true))
      .slice(0, options.limit);
  }
}

/**
 * Repositorio de lancamentos com a chave unica `(recurrenceId, occurrenceDate)`
 * simulada.
 *
 * E' o unico detalhe de banco que este duble PRECISA reproduzir: sem ele, o
 * teste de idempotencia passaria mesmo com um `create` que duplica.
 */
export class InMemoryTransactionRepositoryForJobs {
  readonly items: Transaction[] = [];

  async createIfAbsent(transaction: Transaction): Promise<boolean> {
    const key = `${transaction.recurrenceId?.toValue() ?? ''}|${transaction.occurrenceDate?.toString() ?? ''}`;

    const exists = this.items.some(
      (item) =>
        `${item.recurrenceId?.toValue() ?? ''}|${item.occurrenceDate?.toString() ?? ''}` === key,
    );

    if (exists) {
      return false;
    }

    this.items.push(transaction);

    return true;
  }

  async create(transaction: Transaction): Promise<void> {
    this.items.push(transaction);
  }
}

export class FakeNotifier implements Notifier {
  readonly pushed: NotificationRequest[] = [];

  async push(request: NotificationRequest): Promise<boolean> {
    const key = `${request.userId.toValue()}|${request.dedupeKey ?? ''}`;

    // Sem chave, o aviso e' avulso e sempre entra -- e' o comportamento do
    // indice unico do Postgres, onde NULL nunca colide com NULL.
    if (request.dedupeKey !== undefined) {
      const exists = this.pushed.some(
        (item) => `${item.userId.toValue()}|${item.dedupeKey ?? ''}` === key,
      );

      if (exists) {
        return false;
      }
    }

    this.pushed.push(request);

    return true;
  }

  async pushMany(requests: readonly NotificationRequest[]): Promise<number> {
    let created = 0;

    for (const request of requests) {
      if (await this.push(request)) {
        created += 1;
      }
    }

    return created;
  }

  byType(type: string): NotificationRequest[] {
    return this.pushed.filter((item) => item.type === type);
  }
}

/**
 * So o `findById` e' real.
 *
 * Os outros metodos existem para satisfazer a porta e ESTOURAM se chamados: um
 * `return null` silencioso faria o teste de "conta de outro workspace" passar
 * pelo motivo errado.
 */
export class InMemoryAccountRepository implements Pick<AccountRepository, 'findById'> {
  readonly items: AccountWithCard[] = [];

  async findById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<AccountWithCard | null> {
    return (
      this.items.find(
        (item) => item.account.id.equals(id) && item.account.workspaceId.equals(workspaceId),
      ) ?? null
    );
  }

  add(account: Account): void {
    this.items.push({ account, billingCycle: null, creditCardLimitInCents: null });
  }
}

export class InMemoryCategoryRepository implements Pick<CategoryRepository, 'findById'> {
  readonly items: Category[] = [];

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Category | null> {
    return (
      this.items.find(
        (item) => item.id.equals(id) && item.workspaceId?.equals(workspaceId) === true,
      ) ?? null
    );
  }
}
