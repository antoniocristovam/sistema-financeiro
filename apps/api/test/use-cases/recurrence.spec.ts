import { NotificationType, RecurrenceFrequency, TransactionStatus } from '@finapp/contracts';
import { Money } from '@finapp/money';
import { beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../src/modules/account/core/domain/entities/account';
import { type AccountRepository } from '../../src/modules/account/core/domain/repositories/account-repository';
import { type CategoryRepository } from '../../src/modules/category/core/domain/repositories/category-repository';
import { type UserRepository } from '../../src/modules/identity/core/domain/repositories/user-repository';
import {
  CreateRecurrenceUseCase,
  DeleteRecurrenceUseCase,
  ListRecurrencesUseCase,
  SkipOccurrenceUseCase,
  UpdateRecurrenceUseCase,
} from '../../src/modules/transaction/core/application/use-cases/manage-recurrences';
import {
  MaterializeRecurrencesUseCase,
  SendRecurrenceRemindersUseCase,
} from '../../src/modules/transaction/core/application/use-cases/run-recurrence-jobs';
import { Recurrence } from '../../src/modules/transaction/core/domain/entities/recurrence';
import { type TransactionRepository } from '../../src/modules/transaction/core/domain/repositories/transaction-repository';
import { RecurrenceSchedule } from '../../src/modules/transaction/core/domain/value-objects/recurrence-schedule';
import { WorkspaceAccessService } from '../../src/modules/workspace/core/application/services/workspace-access';
import { Workspace } from '../../src/modules/workspace/core/domain/entities/workspace';
import { WorkspaceMember } from '../../src/modules/workspace/core/domain/entities/workspace-member';
import { Role } from '../../src/modules/workspace/core/domain/value-objects/role';
import { type WorkspaceRepository } from '../../src/modules/workspace/core/domain/repositories/workspace-repository';
import { UniqueEntityId } from '../../src/shared/domain/unique-entity-id';
import { CalendarDate } from '../../src/shared/domain/value-objects/calendar-date';
import {
  FakeAuditLogger,
  FakeClock,
  FakeMailService,
  InMemoryUserRepository,
  InMemoryWorkspaceRepository,
} from '../doubles/in-memory-repositories';
import {
  FakeNotifier,
  InMemoryAccountRepository,
  InMemoryCategoryRepository,
  InMemoryRecurrenceRepository,
  InMemoryTransactionRepositoryForJobs,
} from '../doubles/recurrence-doubles';
import { User } from '../../src/modules/identity/core/domain/entities/user';
import { Email } from '../../src/shared/domain/value-objects/email';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) throw new Error(`E-mail invalido: ${value}`);
  return result.value;
};

/** Cenario minimo: um workspace, um dono e uma conta corrente. */
function scenario() {
  const workspaces = new InMemoryWorkspaceRepository();
  const recurrences = new InMemoryRecurrenceRepository();
  const accounts = new InMemoryAccountRepository();
  const categories = new InMemoryCategoryRepository();
  const transactions = new InMemoryTransactionRepositoryForJobs();
  const users = new InMemoryUserRepository();
  const notifier = new FakeNotifier();
  const mail = new FakeMailService();
  const audit = new FakeAuditLogger();
  const clock = new FakeClock(new Date('2026-03-01T09:00:00Z'));

  const ownerId = new UniqueEntityId();
  const workspace = Workspace.create({ name: 'Casa', type: 'PERSONAL', baseCurrency: 'BRL' });
  const owner = WorkspaceMember.create({
    workspaceId: workspace.id,
    userId: ownerId,
    role: Role.owner(),
  });

  workspaces.items.push(workspace);
  workspaces.members.push(owner);

  const user = User.create(
    {
      name: 'Ana',
      email: email('ana@finapp.local'),
      passwordHash: 'x',
      locale: 'PT_BR',
      currency: 'BRL',
      theme: 'SYSTEM',
    },
    ownerId,
  );

  users.items.push(user);

  const account = Account.create({
    workspaceId: workspace.id,
    name: 'Conta corrente',
    type: 'CHECKING',
    initialBalance: Money.fromCents(0, 'BRL'),
  });

  accounts.add(account);

  const access = new WorkspaceAccessService(workspaces as unknown as WorkspaceRepository);

  return {
    workspaces,
    recurrences,
    accounts,
    categories,
    transactions,
    users,
    notifier,
    mail,
    audit,
    clock,
    access,
    workspace,
    ownerId,
    account,
    create: new CreateRecurrenceUseCase(
      access,
      recurrences,
      accounts as unknown as AccountRepository,
      categories as unknown as CategoryRepository,
      clock,
    ),
    update: new UpdateRecurrenceUseCase(
      access,
      recurrences,
      accounts as unknown as AccountRepository,
      categories as unknown as CategoryRepository,
      clock,
    ),
    list: new ListRecurrencesUseCase(access, recurrences, clock),
    remove: new DeleteRecurrenceUseCase(access, recurrences, audit),
    skip: new SkipOccurrenceUseCase(access, recurrences),
    materialize: new MaterializeRecurrencesUseCase(
      recurrences,
      transactions as unknown as TransactionRepository,
      workspaces as unknown as WorkspaceRepository,
      clock,
    ),
    reminders: new SendRecurrenceRemindersUseCase(
      recurrences,
      workspaces as unknown as WorkspaceRepository,
      users as unknown as UserRepository,
      notifier,
      mail,
      clock,
      'http://localhost:5173',
    ),
  };
}

type Scenario = ReturnType<typeof scenario>;

function seedRecurrence(
  s: Scenario,
  overrides: {
    startDate?: string;
    amountInCents?: number;
    reminderDaysBefore?: number | null;
    dayOfMonth?: number;
  } = {},
): Recurrence {
  const schedule = RecurrenceSchedule.create({
    frequency: RecurrenceFrequency.MONTHLY,
    dayOfMonth: overrides.dayOfMonth ?? 10,
    startDate: day(overrides.startDate ?? '2026-01-10'),
  });

  if (schedule.isLeft()) throw new Error('regra invalida');

  const recurrence = Recurrence.create({
    workspaceId: s.workspace.id,
    createdByUserId: s.ownerId,
    name: 'Aluguel',
    template: {
      accountId: s.account.id,
      categoryId: null,
      type: 'EXPENSE',
      amount: Money.fromCents(overrides.amountInCents ?? 210_000, 'BRL'),
      description: 'Aluguel',
      notes: null,
    },
    schedule: schedule.value,
    reminderDaysBefore: overrides.reminderDaysBefore ?? null,
  });

  s.recurrences.items.push(recurrence);

  return recurrence;
}

describe('CreateRecurrenceUseCase', () => {
  let s: Scenario;

  beforeEach(() => {
    s = scenario();
  });

  it('cria a serie e projeta a proxima ocorrencia', async () => {
    const result = await s.create.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      name: 'Aluguel',
      template: {
        type: 'EXPENSE',
        accountId: s.account.id.toValue(),
        categoryId: null,
        amountInCents: 210_000,
        description: 'Aluguel',
      },
      schedule: {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        dayOfMonth: 10,
        weekday: null,
        monthOfYear: null,
        startDate: '2026-03-10',
        endDate: null,
      },
      reminderDaysBefore: 3,
    });

    expect(result.isRight()).toBe(true);

    if (result.isRight()) {
      expect(result.value.nextOccurrence?.toString()).toBe('2026-03-10');
      expect(result.value.monthlyAmountInCents).toBe(210_000);
    }
  });

  it('recusa conta de OUTRO workspace', async () => {
    // O id existe, mas nao neste workspace: a resposta e' "nao encontrado", e
    // nunca uma serie apontando para conta alheia.
    const result = await s.create.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      name: 'Aluguel',
      template: {
        type: 'EXPENSE',
        accountId: new UniqueEntityId().toValue(),
        categoryId: null,
        amountInCents: 210_000,
        description: 'Aluguel',
      },
      schedule: {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        dayOfMonth: 10,
        weekday: null,
        monthOfYear: null,
        startDate: '2026-03-10',
        endDate: null,
      },
      reminderDaysBefore: null,
    });

    expect(result.isLeft()).toBe(true);
  });

  it('recusa regra que nunca gera ocorrencia', async () => {
    const result = await s.create.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      name: 'Nada',
      template: {
        type: 'EXPENSE',
        accountId: s.account.id.toValue(),
        categoryId: null,
        amountInCents: 1_000,
        description: 'Nada',
      },
      schedule: {
        frequency: RecurrenceFrequency.YEARLY,
        interval: 1,
        dayOfMonth: 10,
        weekday: null,
        monthOfYear: 12,
        startDate: '2026-03-10',
        // Termina antes de dezembro: a serie nunca dispararia.
        endDate: '2026-06-30',
      },
      reminderDaysBefore: null,
    });

    expect(result.isLeft()).toBe(true);
  });

  it('VIEWER nao cria conta fixa', async () => {
    const viewerId = new UniqueEntityId();

    s.workspaces.members.push(
      WorkspaceMember.create({
        workspaceId: s.workspace.id,
        userId: viewerId,
        role: Role.create('VIEWER'),
      }),
    );

    const result = await s.create.execute({
      workspaceId: s.workspace.id,
      userId: viewerId,
      name: 'Aluguel',
      template: {
        type: 'EXPENSE',
        accountId: s.account.id.toValue(),
        categoryId: null,
        amountInCents: 210_000,
        description: 'Aluguel',
      },
      schedule: {
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 1,
        dayOfMonth: 10,
        weekday: null,
        monthOfYear: null,
        startDate: '2026-03-10',
        endDate: null,
      },
      reminderDaysBefore: null,
    });

    expect(result.isLeft()).toBe(true);
  });
});

describe('ListRecurrencesUseCase', () => {
  it('soma o comprometimento mensal so das DESPESAS ativas', async () => {
    const s = scenario();

    seedRecurrence(s, { amountInCents: 210_000 });

    const semanal = RecurrenceSchedule.create({
      frequency: RecurrenceFrequency.WEEKLY,
      weekday: 1,
      startDate: day('2026-01-05'),
    });

    if (semanal.isLeft()) throw new Error('regra invalida');

    s.recurrences.items.push(
      Recurrence.create({
        workspaceId: s.workspace.id,
        createdByUserId: s.ownerId,
        name: 'Salario',
        template: {
          accountId: s.account.id,
          categoryId: null,
          type: 'INCOME',
          amount: Money.fromCents(500_000, 'BRL'),
          description: 'Salario',
          notes: null,
        },
        schedule: semanal.value,
      }),
    );

    const result = await s.list.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      includeInactive: false,
    });

    expect(result.isRight()).toBe(true);

    if (result.isRight()) {
      // A receita semanal NAO entra: o painel responde "quanto do mes ja esta
      // comprometido", nao "qual e' o meu saldo recorrente".
      expect(result.value.monthlyCommittedInCents).toBe(210_000);
      expect(result.value.items).toHaveLength(2);
    }
  });
});

describe('SkipOccurrenceUseCase', () => {
  it('recusa data que nao pertence a serie', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s);

    const result = await s.skip.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      recurrenceId: recurrence.id,
      // A serie e' todo dia 10.
      occurrenceDate: '2026-03-11',
    });

    expect(result.isLeft()).toBe(true);
    expect(s.recurrences.skipList).toHaveLength(0);
  });

  it('dispensar duas vezes a mesma data nao duplica', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s);

    for (let i = 0; i < 2; i += 1) {
      await s.skip.execute({
        workspaceId: s.workspace.id,
        userId: s.ownerId,
        recurrenceId: recurrence.id,
        occurrenceDate: '2026-03-10',
      });
    }

    expect(s.recurrences.skipList).toHaveLength(1);
  });
});

describe('DeleteRecurrenceUseCase', () => {
  it('registra na trilha e NAO apaga os lancamentos ja gerados', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s);

    await s.materialize.execute(day('2026-03-01'));
    const geradosAntes = s.transactions.items.length;

    const result = await s.remove.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      recurrenceId: recurrence.id,
    });

    expect(result.isRight()).toBe(true);
    expect(s.recurrences.items).toHaveLength(0);
    // O historico e' historico: o aluguel de marco aconteceu.
    expect(s.transactions.items).toHaveLength(geradosAntes);
    expect(s.audit.has('RECURRENCE_DELETED')).toBe(true);
  });
});

describe('MaterializeRecurrencesUseCase', () => {
  it('cria os lancamentos da janela como PENDENTES', async () => {
    const s = scenario();
    seedRecurrence(s);

    const report = await s.materialize.execute(day('2026-03-01'));

    expect(report.transactionsCreated).toBe(2);
    expect(s.transactions.items.map((item) => item.date.toString())).toEqual([
      '2026-03-10',
      '2026-04-10',
    ]);
    expect(
      s.transactions.items.every((item) => item.status === TransactionStatus.PENDING),
    ).toBe(true);
  });

  it('e IDEMPOTENTE: rodar de novo nao duplica nada', async () => {
    /*
     * O caso que este teste protege e' real: retry da fila, deploy no meio da
     * execucao, duas instancias subindo juntas. Duplicar aqui significa duas
     * contas de aluguel no extrato do usuario.
     */
    const s = scenario();
    seedRecurrence(s);

    const primeira = await s.materialize.execute(day('2026-03-01'));
    const segunda = await s.materialize.execute(day('2026-03-01'));

    expect(primeira.transactionsCreated).toBe(2);
    expect(segunda.transactionsCreated).toBe(0);
    expect(s.transactions.items).toHaveLength(2);
  });

  it('nao recria ocorrencia dispensada mesmo com a janela zerada', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s);

    await s.skip.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      recurrenceId: recurrence.id,
      occurrenceDate: '2026-03-10',
    });

    await s.materialize.execute(day('2026-03-01'));

    expect(s.transactions.items.map((item) => item.date.toString())).toEqual(['2026-04-10']);
  });

  it('serie inativa nao gera nada', async () => {
    const s = scenario();
    seedRecurrence(s).deactivate();

    const report = await s.materialize.execute(day('2026-03-01'));

    expect(report.transactionsCreated).toBe(0);
  });

  it('avanca a janela mesmo sem criar nada, para nao ressuscitar o excluido', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s);

    await s.materialize.execute(day('2026-03-01'));

    expect(recurrence.materializedUntil?.toString()).toBe('2026-04-30');
  });
});

describe('SendRecurrenceRemindersUseCase', () => {
  it('avisa com a antecedencia configurada e manda o e-mail', async () => {
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3 });

    const report = await s.reminders.execute(day('2026-03-07'));

    expect(report.notificationsCreated).toBe(1);
    expect(report.emailsSent).toBe(1);
    expect(s.mail.sent[0]?.to).toBe('ana@finapp.local');
    expect(s.notifier.byType(NotificationType.RECURRENCE_DUE_SOON)).toHaveLength(1);
  });

  it('NAO conta e-mail que o servidor recusou', async () => {
    /*
     * O envio engole a falha de proposito -- SMTP fora do ar nao pode derrubar
     * o job. Sem o retorno booleano, o relatorio dizia "1 e-mail enviado"
     * justamente no dia em que nenhum saiu. Aconteceu de verdade num passo a
     * passo: o aviso apareceu na tela, o log dizia 1 e-mail, e o Mailpit estava
     * vazio.
     */
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3 });
    s.mail.failNext = true;

    const report = await s.reminders.execute(day('2026-03-07'));

    expect(report.notificationsCreated).toBe(1);
    expect(report.emailsSent).toBe(0);
  });

  it('nao avisa fora da antecedencia', async () => {
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3 });

    const report = await s.reminders.execute(day('2026-03-05'));

    expect(report.notificationsCreated).toBe(0);
  });

  it('reexecucao NAO manda o mesmo lembrete duas vezes', async () => {
    /*
     * A dedupe e' por evento (`tipo:serie:data`), nao por execucao. Sem isso a
     * tela nao duplicaria nada -- mas a caixa de entrada duplicaria, que e' o
     * lado que o usuario percebe.
     */
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3 });

    await s.reminders.execute(day('2026-03-07'));
    const segunda = await s.reminders.execute(day('2026-03-07'));

    expect(segunda.notificationsCreated).toBe(0);
    expect(segunda.emailsSent).toBe(0);
    expect(s.mail.sent).toHaveLength(1);
  });

  it('nao lembra de ocorrencia dispensada', async () => {
    const s = scenario();
    const recurrence = seedRecurrence(s, { reminderDaysBefore: 3 });

    await s.skip.execute({
      workspaceId: s.workspace.id,
      userId: s.ownerId,
      recurrenceId: recurrence.id,
      occurrenceDate: '2026-03-10',
    });

    const report = await s.reminders.execute(day('2026-03-07'));

    expect(report.notificationsCreated).toBe(0);
  });

  it('avisa reajuste quando o valor destoa da media paga', async () => {
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3, amountInCents: 235_000 });
    s.recurrences.settled = [210_000, 210_000, 210_000];

    const report = await s.reminders.execute(day('2026-03-07'));

    expect(report.driftAlerts).toBe(1);
    expect(s.notifier.byType(NotificationType.RECURRENCE_AMOUNT_DRIFT)).toHaveLength(1);
  });

  it('nao inventa reajuste sem historico', async () => {
    const s = scenario();
    seedRecurrence(s, { reminderDaysBefore: 3, amountInCents: 235_000 });
    s.recurrences.settled = [];

    const report = await s.reminders.execute(day('2026-03-07'));

    expect(report.driftAlerts).toBe(0);
  });

  it('avisa TODOS os membros do workspace', async () => {
    const s = scenario();
    const outroId = new UniqueEntityId();

    s.workspaces.members.push(
      WorkspaceMember.create({
        workspaceId: s.workspace.id,
        userId: outroId,
        role: Role.create('MEMBER'),
      }),
    );

    s.users.items.push(
      User.create(
        {
          name: 'Bruno',
          email: email('bruno@finapp.local'),
          passwordHash: 'x',
          locale: 'PT_BR',
          currency: 'BRL',
          theme: 'SYSTEM',
        },
        outroId,
      ),
    );

    seedRecurrence(s, { reminderDaysBefore: 1 });

    const report = await s.reminders.execute(day('2026-03-09'));

    expect(report.notificationsCreated).toBe(2);
    expect(report.emailsSent).toBe(2);
  });
});
