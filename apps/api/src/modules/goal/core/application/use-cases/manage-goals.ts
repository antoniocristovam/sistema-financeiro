import { NotificationType, notificationDedupeKey, TransactionStatus, TransferLeg } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type Notifier } from '../../../../../shared/application/ports/notifier';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Either, left, right } from '../../../../../shared/either';
import { AccountType } from '@finapp/contracts';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { Transaction } from '../../../../transaction/core/domain/entities/transaction';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { Goal } from '../../domain/entities/goal';
import {
  type ContributionView,
  type GoalRepository,
  type GoalView,
} from '../../domain/repositories/goal-repository';
import { type GoalProjectionResult } from '../../domain/value-objects/goal-projection';

type GoalError = AccessError | InvalidValueError | ResourceNotFoundError | ConflictError;

export interface GoalWithProjection {
  view: GoalView;
  projection: GoalProjectionResult;
}

// -- Listagem -----------------------------------------------------------------

export interface ListGoalsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  includeArchived: boolean;
}

export class ListGoalsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListGoalsInput): Promise<Either<GoalError, GoalWithProjection[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const views = await this.goals.listByWorkspace(input.workspaceId, {
      includeArchived: input.includeArchived,
    });

    if (views.length === 0) {
      return right([]);
    }

    const today = CalendarDate.fromUtcDate(this.clock.now());
    const currency = authorized.value.workspace.baseCurrency;

    // Uma consulta para todos os aportes: a projecao de dez metas nao pode
    // custar dez idas ao banco.
    const byGoal = await this.goals.contributionsOfMany(
      input.workspaceId,
      views.map((view) => view.goal.id),
    );

    return right(
      views.map((view) => ({
        view,
        projection: view.goal.project(
          (byGoal.get(view.goal.id.toValue()) ?? []).map((entry) => ({
            date: entry.date,
            amount: Money.fromCents(entry.amountInCents, currency),
          })),
          today,
        ),
      })),
    );
  }
}

export interface GetGoalInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  goalId: UniqueEntityId;
}

export class GetGoalUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: GetGoalInput,
  ): Promise<
    Either<GoalError, { view: GoalView; projection: GoalProjectionResult; contributions: ContributionView[] }>
  > {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const view = await this.goals.findViewById(input.workspaceId, input.goalId);

    if (!view) {
      return left(new ResourceNotFoundError('Meta'));
    }

    const currency = authorized.value.workspace.baseCurrency;
    const contributions = await this.goals.contributions(input.workspaceId, input.goalId);

    return right({
      view,
      contributions,
      projection: view.goal.project(
        contributions.map((entry) => ({
          date: entry.date,
          amount: Money.fromCents(entry.amountInCents, currency),
        })),
        CalendarDate.fromUtcDate(this.clock.now()),
      ),
    });
  }
}

// -- Criacao e edicao ---------------------------------------------------------

export interface CreateGoalInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  name: string;
  targetAmountInCents: number;
  deadline: string | null;
  icon: string | null;
  color: string | null;
  linkedAccountId: string | null;
}

export class CreateGoalUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(input: CreateGoalInput): Promise<Either<GoalError, UniqueEntityId>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    let deadline: CalendarDate | null = null;

    if (input.deadline) {
      const parsed = CalendarDate.create(input.deadline);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      deadline = parsed.value;
    }

    if (input.linkedAccountId) {
      const account = await this.accounts.findById(
        input.workspaceId,
        new UniqueEntityId(input.linkedAccountId),
      );

      if (!account) {
        return left(new ResourceNotFoundError('Conta'));
      }

      // Guardar dinheiro em cartao de credito nao existe: o aporte viraria uma
      // transferencia para uma conta de divida.
      if (account.account.type === AccountType.CREDIT_CARD) {
        return left(
          new InvalidValueError('Cartao de credito nao serve como conta de reserva.', 'linkedAccountId'),
        );
      }
    }

    const goal = Goal.create({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      targetAmount: Money.fromCents(
        input.targetAmountInCents,
        authorized.value.workspace.baseCurrency,
      ),
      deadline,
      icon: input.icon,
      color: input.color,
      linkedAccountId: input.linkedAccountId
        ? new UniqueEntityId(input.linkedAccountId)
        : null,
    });

    await this.goals.create(goal);

    return right(goal.id);
  }
}

export interface UpdateGoalInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  goalId: UniqueEntityId;
  name?: string;
  targetAmountInCents?: number;
  deadline?: string | null;
  icon?: string | null;
  color?: string | null;
  archived?: boolean;
}

export class UpdateGoalUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateGoalInput): Promise<Either<GoalError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const goal = await this.goals.findById(input.workspaceId, input.goalId);

    if (!goal) {
      return left(new ResourceNotFoundError('Meta'));
    }

    if (input.name !== undefined) {
      goal.rename(input.name.trim());
    }

    if (input.targetAmountInCents !== undefined) {
      goal.changeTarget(
        Money.fromCents(input.targetAmountInCents, authorized.value.workspace.baseCurrency),
      );

      /*
       * Aumentar o alvo REABRE a meta.
       *
       * Sem isto, uma meta concluida que ganha um alvo maior continuaria
       * marcada como atingida -- com barra em 100% e um valor que nao chegou
       * la. A reabertura e' decidida pela propria entidade.
       */
      goal.clearAchievement();
    }

    if (input.deadline !== undefined) {
      if (input.deadline === null) {
        goal.changeDeadline(null);
      } else {
        const parsed = CalendarDate.create(input.deadline);

        if (parsed.isLeft()) {
          return left(parsed.value);
        }

        goal.changeDeadline(parsed.value);
      }
    }

    if (input.icon !== undefined || input.color !== undefined) {
      goal.restyle({
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      });
    }

    if (input.archived !== undefined) {
      if (input.archived) {
        goal.archive(this.clock.now());
      } else {
        goal.unarchive();
      }
    }

    await this.goals.save(goal);

    return right(undefined);
  }
}

export interface DeleteGoalInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  goalId: UniqueEntityId;
}

/**
 * Excluir a meta NAO desfaz as transferencias que os aportes geraram.
 *
 * O dinheiro foi mesmo para a conta de reserva; apagar a meta em novembro nao
 * pode reescrever o extrato de marco. Os lancamentos apenas perdem o vinculo.
 */
export class DeleteGoalUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
  ) {}

  async execute(input: DeleteGoalInput): Promise<Either<GoalError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const goal = await this.goals.findById(input.workspaceId, input.goalId);

    if (!goal) {
      return left(new ResourceNotFoundError('Meta'));
    }

    await this.goals.delete(input.workspaceId, input.goalId);

    return right(undefined);
  }
}

// -- Aporte -------------------------------------------------------------------

export interface ContributeInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  goalId: UniqueEntityId;
  amountInCents: number;
  date?: string;
  note?: string;
  fromAccountId?: string;
}

/**
 * Aporte na meta.
 *
 * Com conta vinculada, o aporte e' uma TRANSFERENCIA de verdade (regra 4): o
 * dinheiro sai da conta corrente e entra na reserva, e nao aparece como despesa
 * -- guardar dinheiro nao e' gastar.
 *
 * Sem conta vinculada, o aporte e' so um registro de progresso. E' o caso da
 * meta cujo dinheiro mora fora do app (um CDB no banco, por exemplo), e forcar
 * uma transferencia ali inventaria movimento que nao aconteceu.
 */
export class ContributeToGoalUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly notifier: Notifier,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: ContributeInput): Promise<Either<GoalError, { achieved: boolean }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const goal = await this.goals.findById(input.workspaceId, input.goalId);

    if (!goal) {
      return left(new ResourceNotFoundError('Meta'));
    }

    if (goal.isArchived()) {
      return left(new ConflictError('Esta meta esta arquivada.'));
    }

    let date = CalendarDate.fromUtcDate(this.clock.now());

    if (input.date) {
      const parsed = CalendarDate.create(input.date);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      date = parsed.value;
    }

    const currency = authorized.value.workspace.baseCurrency;
    const amount = Money.fromCents(input.amountInCents, currency);
    const contributionId = new UniqueEntityId();
    let transactionId: UniqueEntityId | null = null;
    let legs: Transaction[] = [];

    if (goal.hasLinkedAccount()) {
      if (!input.fromAccountId) {
        return left(
          new InvalidValueError('Informe de qual conta o dinheiro sai.', 'fromAccountId'),
        );
      }

      const source = await this.accounts.findById(
        input.workspaceId,
        new UniqueEntityId(input.fromAccountId),
      );

      if (!source) {
        return left(new ResourceNotFoundError('Conta'));
      }

      if (source.account.id.equals(goal.linkedAccountId!)) {
        return left(
          new InvalidValueError(
            'A conta de origem precisa ser diferente da conta da meta.',
            'fromAccountId',
          ),
        );
      }

      const transferPairId = new UniqueEntityId();
      const common = {
        workspaceId: input.workspaceId,
        createdByUserId: input.userId,
        type: 'TRANSFER' as const,
        amount,
        date,
        description: `Aporte: ${goal.name}`,
        status: TransactionStatus.SETTLED,
        notes: input.note?.trim() ?? null,
        transferPairId,
      };

      const outgoing = Transaction.create({
        ...common,
        accountId: source.account.id,
        transferLeg: TransferLeg.SOURCE,
      });

      const incoming = Transaction.create({
        ...common,
        accountId: goal.linkedAccountId!,
        transferLeg: TransferLeg.DESTINATION,
      });

      if (outgoing.isLeft()) {
        return left(outgoing.value);
      }

      if (incoming.isLeft()) {
        return left(incoming.value);
      }

      legs = [outgoing.value, incoming.value];
      transactionId = outgoing.value.id;
    } else if (input.fromAccountId) {
      return left(
        new InvalidValueError(
          'Esta meta nao tem conta de reserva: o aporte e apenas um registro.',
          'fromAccountId',
        ),
      );
    }

    await this.unitOfWork.run(async () => {
      if (legs.length > 0) {
        await this.transactions.createMany(legs);
      }

      await this.goals.addContribution({
        id: contributionId,
        goalId: goal.id,
        amountInCents: input.amountInCents,
        date,
        note: input.note?.trim() ?? null,
        createdByUserId: input.userId,
        transactionId,
      });
    });

    // O total e' relido do banco: somar em memoria erraria se dois aportes
    // chegassem juntos.
    const contributions = await this.goals.contributions(input.workspaceId, goal.id);
    const saved = contributions.reduce((total, entry) => total + entry.amountInCents, 0);
    const achieved = saved >= goal.targetAmount.toCents() && !goal.isAchieved();

    if (achieved) {
      goal.markAchieved(this.clock.now());
      await this.goals.save(goal);

      const members = await this.workspaces.listMembers(input.workspaceId);

      await this.notifier.pushMany(
        members.map((member) => ({
          userId: member.userId,
          workspaceId: input.workspaceId,
          type: NotificationType.GOAL_REACHED,
          title: `Meta alcancada: ${goal.name}`,
          body: `Voce chegou aos ${goal.targetAmount.toCents() / 100} reais planejados.`,
          data: { goalId: goal.id.toValue() },
          // Uma vez por meta: reabrir e bater de novo avisa outra vez, porque a
          // chave leva o instante da conquista.
          dedupeKey: notificationDedupeKey(
            NotificationType.GOAL_REACHED,
            goal.id.toValue(),
            goal.achievedAt?.toISOString() ?? '',
          ),
        })),
      );
    }

    return right({ achieved });
  }
}

export interface RemoveContributionInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  goalId: UniqueEntityId;
  contributionId: UniqueEntityId;
}

/**
 * Remove um aporte.
 *
 * Quando o aporte gerou transferencia, ela e' desfeita junto -- o par inteiro.
 * Deixar a transferencia de pe faria o dinheiro continuar na reserva sem
 * nenhum aporte que o explique, e o saldo da meta divergiria do saldo da conta.
 */
export class RemoveContributionUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly goals: GoalRepository,
    private readonly transactions: TransactionRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: RemoveContributionInput): Promise<Either<GoalError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const goal = await this.goals.findById(input.workspaceId, input.goalId);

    if (!goal) {
      return left(new ResourceNotFoundError('Meta'));
    }

    const removed = await this.goals.removeContribution(
      input.workspaceId,
      input.goalId,
      input.contributionId,
    );

    if (!removed) {
      return left(new ResourceNotFoundError('Aporte'));
    }

    if (removed.transactionId) {
      const transaction = await this.transactions.findById(
        input.workspaceId,
        new UniqueEntityId(removed.transactionId),
      );

      if (transaction?.transferPairId) {
        await this.unitOfWork.run(async () => {
          await this.transactions.deleteTransferPair(
            input.workspaceId,
            transaction.transferPairId!,
          );
        });
      }
    }

    // Tirar dinheiro pode desfazer a conquista: a barra volta para baixo de
    // 100%, e manter a medalha seria mentir.
    if (goal.isAchieved()) {
      const contributions = await this.goals.contributions(input.workspaceId, goal.id);
      const saved = contributions.reduce((total, entry) => total + entry.amountInCents, 0);

      if (saved < goal.targetAmount.toCents()) {
        goal.clearAchievement();
        await this.goals.save(goal);
      }
    }

    return right(undefined);
  }
}
