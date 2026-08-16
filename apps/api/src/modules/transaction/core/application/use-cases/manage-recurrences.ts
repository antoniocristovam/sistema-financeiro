import {
  monthlyEquivalentInCents,
  type RecurrenceFrequency,
  type RecurrenceOccurrence,
} from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type Clock } from '../../../../../shared/application/ports/clock';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Either, left, right } from '../../../../../shared/either';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { type CategoryRepository } from '../../../../category/core/domain/repositories/category-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { Recurrence } from '../../domain/entities/recurrence';
import {
  type RecurrenceRepository,
  type RecurrenceView,
} from '../../domain/repositories/recurrence-repository';
import { RecurrenceSchedule } from '../../domain/value-objects/recurrence-schedule';

type RecurrenceError =
  | AccessError
  | InvalidValueError
  | ResourceNotFoundError
  | ConflictError;

export interface ScheduleInput {
  frequency: RecurrenceFrequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
}

export interface TemplateInput {
  type: 'INCOME' | 'EXPENSE';
  accountId: string;
  categoryId: string | null;
  amountInCents: number;
  description: string;
  notes?: string;
}

/** Serie + o quanto ela compromete por mes, ja normalizado. */
export interface RecurrenceWithProjection {
  view: RecurrenceView;
  nextOccurrence: CalendarDate | null;
  monthlyAmountInCents: number;
}

function buildSchedule(
  input: ScheduleInput,
): Either<InvalidValueError, RecurrenceSchedule> {
  const startDate = CalendarDate.create(input.startDate);

  if (startDate.isLeft()) {
    return left(startDate.value);
  }

  let endDate: CalendarDate | null = null;

  if (input.endDate !== null) {
    const parsed = CalendarDate.create(input.endDate);

    if (parsed.isLeft()) {
      return left(parsed.value);
    }

    endDate = parsed.value;
  }

  return RecurrenceSchedule.create({
    frequency: input.frequency,
    interval: input.interval,
    dayOfMonth: input.dayOfMonth,
    weekday: input.weekday,
    monthOfYear: input.monthOfYear,
    startDate: startDate.value,
    endDate,
  });
}

/**
 * Conta e categoria precisam existir DENTRO do workspace.
 *
 * Mesma barreira do lancamento avulso, e aqui ela pesa mais: uma serie aponta
 * para a conta uma vez e gera lancamento por anos. Um id de outro workspace que
 * passasse na criacao viraria um vazamento que se repete todo mes.
 */
async function resolveTemplateTargets(
  accounts: AccountRepository,
  categories: CategoryRepository,
  workspaceId: UniqueEntityId,
  template: { accountId: string; categoryId: string | null; type: 'INCOME' | 'EXPENSE' },
): Promise<Either<RecurrenceError, void>> {
  const account = await accounts.findById(workspaceId, new UniqueEntityId(template.accountId));

  if (!account) {
    return left(new ResourceNotFoundError('Conta'));
  }

  if (!account.account.acceptsNewTransactions()) {
    return left(new ConflictError('Esta conta esta arquivada e nao aceita lancamentos novos.'));
  }

  if (template.categoryId) {
    const category = await categories.findById(
      workspaceId,
      new UniqueEntityId(template.categoryId),
    );

    if (!category) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    if (category.type !== template.type) {
      return left(
        new InvalidValueError(
          `Esta categoria e de ${category.type === 'INCOME' ? 'receita' : 'despesa'}.`,
          'categoryId',
        ),
      );
    }
  }

  return right(undefined);
}

function project(view: RecurrenceView, today: CalendarDate): RecurrenceWithProjection {
  const { recurrence } = view;

  return {
    view,
    // Estritamente depois de ontem: a ocorrencia de HOJE ainda esta por vir.
    nextOccurrence: recurrence.isActive
      ? recurrence.schedule.nextAfter(today.addDays(-1))
      : null,
    monthlyAmountInCents: monthlyEquivalentInCents(
      recurrence.template.amount.toCents(),
      recurrence.schedule.frequency,
      recurrence.schedule.interval,
    ),
  };
}

// -- Listagem -----------------------------------------------------------------

export interface ListRecurrencesInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  includeInactive: boolean;
}

export interface RecurrenceListResult {
  items: RecurrenceWithProjection[];
  monthlyCommittedInCents: number;
}

export class ListRecurrencesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ListRecurrencesInput,
  ): Promise<Either<RecurrenceError, RecurrenceListResult>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const today = CalendarDate.fromUtcDate(this.clock.now());
    const views = await this.recurrences.listByWorkspace(input.workspaceId, {
      includeInactive: input.includeInactive,
    });

    const items = views.map((view) => project(view, today));

    /*
     * O comprometimento soma so as DESPESAS ativas.
     *
     * Misturar o salario recorrente aqui daria um numero sem significado: o
     * painel responde "quanto do meu mes ja esta comprometido", nao "qual e' o
     * meu saldo recorrente".
     */
    const monthlyCommittedInCents = items
      .filter(
        (item) => item.view.recurrence.isActive && item.view.recurrence.template.type === 'EXPENSE',
      )
      .reduce((sum, item) => sum + item.monthlyAmountInCents, 0);

    return right({ items, monthlyCommittedInCents });
  }
}

// -- Criacao ------------------------------------------------------------------

export interface CreateRecurrenceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  name: string;
  template: TemplateInput;
  schedule: ScheduleInput;
  reminderDaysBefore: number | null;
}

export class CreateRecurrenceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
    private readonly accounts: AccountRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: CreateRecurrenceInput,
  ): Promise<Either<RecurrenceError, RecurrenceWithProjection>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const targets = await resolveTemplateTargets(
      this.accounts,
      this.categories,
      input.workspaceId,
      input.template,
    );

    if (targets.isLeft()) {
      return left(targets.value);
    }

    const schedule = buildSchedule(input.schedule);

    if (schedule.isLeft()) {
      return left(schedule.value);
    }

    // Serie que nunca gera nada e' quase sempre erro de formulario -- data
    // final antes da primeira ocorrencia, por exemplo. Recusar aqui e' melhor
    // do que criar um registro que fica inerte para sempre.
    if (schedule.value.first() === null) {
      return left(
        new InvalidValueError('Esta regra nao gera nenhuma ocorrencia.', 'frequency'),
      );
    }

    const now = this.clock.now();

    const recurrence = Recurrence.create({
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      name: input.name.trim(),
      template: {
        accountId: new UniqueEntityId(input.template.accountId),
        categoryId: input.template.categoryId
          ? new UniqueEntityId(input.template.categoryId)
          : null,
        type: input.template.type,
        amount: Money.fromCents(
          input.template.amountInCents,
          authorized.value.workspace.baseCurrency,
        ),
        description: input.template.description.trim(),
        notes: input.template.notes?.trim() ?? null,
      },
      schedule: schedule.value,
      reminderDaysBefore: input.reminderDaysBefore,
      createdAt: now,
      updatedAt: now,
    });

    await this.recurrences.create(recurrence);

    const view = await this.recurrences.findViewById(input.workspaceId, recurrence.id);

    return right(project(view!, CalendarDate.fromUtcDate(now)));
  }
}

// -- Edicao -------------------------------------------------------------------

export interface UpdateRecurrenceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  recurrenceId: UniqueEntityId;
  name?: string;
  template?: Partial<TemplateInput>;
  schedule?: ScheduleInput;
  reminderDaysBefore?: number | null;
  isActive?: boolean;
}

export class UpdateRecurrenceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
    private readonly accounts: AccountRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: UpdateRecurrenceInput,
  ): Promise<Either<RecurrenceError, RecurrenceWithProjection>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const recurrence = await this.recurrences.findById(input.workspaceId, input.recurrenceId);

    if (!recurrence) {
      return left(new ResourceNotFoundError('Conta fixa'));
    }

    if (input.template) {
      const merged = {
        type: input.template.type ?? recurrence.template.type,
        accountId: input.template.accountId ?? recurrence.template.accountId.toValue(),
        categoryId:
          input.template.categoryId !== undefined
            ? input.template.categoryId
            : (recurrence.template.categoryId?.toValue() ?? null),
      };

      const targets = await resolveTemplateTargets(
        this.accounts,
        this.categories,
        input.workspaceId,
        merged,
      );

      if (targets.isLeft()) {
        return left(targets.value);
      }

      recurrence.updateTemplate({
        type: merged.type,
        accountId: new UniqueEntityId(merged.accountId),
        categoryId: merged.categoryId ? new UniqueEntityId(merged.categoryId) : null,
        ...(input.template.amountInCents !== undefined
          ? {
              amount: Money.fromCents(
                input.template.amountInCents,
                authorized.value.workspace.baseCurrency,
              ),
            }
          : {}),
        ...(input.template.description !== undefined
          ? { description: input.template.description.trim() }
          : {}),
        ...(input.template.notes !== undefined
          ? { notes: input.template.notes.trim() || null }
          : {}),
      });
    }

    if (input.schedule) {
      const schedule = buildSchedule(input.schedule);

      if (schedule.isLeft()) {
        return left(schedule.value);
      }

      if (schedule.value.first() === null) {
        return left(new InvalidValueError('Esta regra nao gera nenhuma ocorrencia.', 'frequency'));
      }

      recurrence.changeSchedule(schedule.value);
    }

    if (input.name !== undefined) {
      recurrence.rename(input.name.trim());
    }

    if (input.reminderDaysBefore !== undefined) {
      recurrence.changeReminder(input.reminderDaysBefore);
    }

    if (input.isActive !== undefined) {
      if (input.isActive) {
        recurrence.activate();
      } else {
        recurrence.deactivate();
      }
    }

    await this.recurrences.save(recurrence);

    const view = await this.recurrences.findViewById(input.workspaceId, recurrence.id);

    return right(project(view!, CalendarDate.fromUtcDate(this.clock.now())));
  }
}

// -- Exclusao -----------------------------------------------------------------

export interface DeleteRecurrenceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  recurrenceId: UniqueEntityId;
}

/**
 * Excluir a serie NAO apaga os lancamentos que ela ja gerou.
 *
 * O que ja foi materializado virou historico: o aluguel de marco aconteceu, e
 * apagar a serie em abril nao pode reescrever o extrato nem mexer no saldo. Os
 * lancamentos apenas perdem o vinculo (`onDelete: SetNull`).
 *
 * Quem quer parar de gerar sem perder o vinculo desativa em vez de excluir.
 */
export class DeleteRecurrenceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: DeleteRecurrenceInput): Promise<Either<RecurrenceError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const recurrence = await this.recurrences.findById(input.workspaceId, input.recurrenceId);

    if (!recurrence) {
      return left(new ResourceNotFoundError('Conta fixa'));
    }

    await this.recurrences.delete(input.workspaceId, input.recurrenceId);

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.userId.toValue(),
      action: 'RECURRENCE_DELETED',
      entityType: 'Recurrence',
      entityId: input.recurrenceId.toValue(),
      metadata: { name: recurrence.name },
    });

    return right(undefined);
  }
}

// -- Linha do tempo -----------------------------------------------------------

export interface ListOccurrencesInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  recurrenceId: UniqueEntityId;
  /** Quantos meses a frente mostrar. */
  months: number;
}

/**
 * Ocorrencias da serie: as ja materializadas, as dispensadas e as futuras.
 *
 * Le direto da regra em vez de so listar transacoes -- a tela precisa mostrar o
 * que AINDA VAI acontecer, e isso por definicao nao esta no banco.
 */
export class ListRecurrenceOccurrencesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ListOccurrencesInput,
  ): Promise<Either<RecurrenceError, RecurrenceOccurrence[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const recurrence = await this.recurrences.findById(input.workspaceId, input.recurrenceId);

    if (!recurrence) {
      return left(new ResourceNotFoundError('Conta fixa'));
    }

    const today = CalendarDate.fromUtcDate(this.clock.now());
    const from = today.startOfMonth();
    const to = today.addMonths(input.months).endOfMonth();

    const [materialized, skips] = await Promise.all([
      this.recurrences.materializedOccurrences(input.workspaceId, input.recurrenceId, from, to),
      this.recurrences.skips(input.recurrenceId),
    ]);

    const byDate = new Map(
      materialized.map((entry) => [entry.occurrenceDate.toString(), entry]),
    );
    const skipped = new Set(skips.map((date) => date.toString()));

    return right(
      recurrence.schedule.occurrencesBetween(from, to).map((occurrence) => {
        const key = occurrence.toString();
        const entry = byDate.get(key);

        if (entry) {
          return {
            date: key,
            transactionId: entry.transactionId,
            status: entry.isSettled ? ('SETTLED' as const) : ('MATERIALIZED' as const),
          };
        }

        return {
          date: key,
          transactionId: null,
          status: skipped.has(key) ? ('SKIPPED' as const) : ('SCHEDULED' as const),
        };
      }),
    );
  }
}

// -- Dispensa de ocorrencia ---------------------------------------------------

export interface SkipOccurrenceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  recurrenceId: UniqueEntityId;
  occurrenceDate: string;
  reason?: string;
}

/**
 * Dispensa uma ocorrencia sem quebrar a serie.
 *
 * "Este mes eu nao pago" e' diferente de "cancelei a assinatura": a primeira
 * pula uma data, a segunda desativa a serie. Sem a dispensa, o usuario
 * excluiria o lancamento e o job diario o recriaria na proxima madrugada.
 */
export class SkipOccurrenceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly recurrences: RecurrenceRepository,
  ) {}

  async execute(input: SkipOccurrenceInput): Promise<Either<RecurrenceError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const recurrence = await this.recurrences.findById(input.workspaceId, input.recurrenceId);

    if (!recurrence) {
      return left(new ResourceNotFoundError('Conta fixa'));
    }

    const occurrenceDate = CalendarDate.create(input.occurrenceDate);

    if (occurrenceDate.isLeft()) {
      return left(occurrenceDate.value);
    }

    // Dispensar uma data que a regra nao gera nao teria efeito nenhum e
    // deixaria o usuario achando que resolveu algo.
    const belongs = recurrence.schedule
      .occurrencesBetween(occurrenceDate.value, occurrenceDate.value)
      .some((occurrence) => occurrence.equals(occurrenceDate.value));

    if (!belongs) {
      return left(
        new InvalidValueError('Esta data nao e uma ocorrencia desta serie.', 'occurrenceDate'),
      );
    }

    await this.recurrences.addSkip(
      input.recurrenceId,
      occurrenceDate.value,
      input.reason?.trim() || null,
    );

    return right(undefined);
  }
}
