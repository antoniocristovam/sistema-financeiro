import {
  NotificationType,
  notificationDedupeKey,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type Notifier } from '../../../../../shared/application/ports/notifier';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { type Either, left, right } from '../../../../../shared/either';
import { type CategoryRepository } from '../../../../category/core/domain/repositories/category-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { Budget } from '../../domain/entities/budget';
import {
  type BudgetRepository,
  type BudgetView,
} from '../../domain/repositories/budget-repository';
import { type BudgetProgress } from '../../domain/value-objects/budget-progress';

type BudgetError = AccessError | InvalidValueError | ResourceNotFoundError | ConflictError;

export interface BudgetWithProgress {
  view: BudgetView;
  progress: BudgetProgress;
}

export interface BudgetListResult {
  referenceMonth: MonthReference;
  items: BudgetWithProgress[];
  unbudgetedInCents: number;
}

/**
 * Sobra herdada do mes anterior.
 *
 * So existe com `rollover` ligado, e so o que SOBROU e' herdado -- estouro nao
 * vira divida do mes seguinte. Herdar o negativo puniria duas vezes pelo mesmo
 * gasto, e na pratica faria o usuario desligar o rollover em vez de usar.
 */
async function carryOverFor(
  budgets: BudgetRepository,
  workspaceId: UniqueEntityId,
  budget: Budget,
): Promise<Money> {
  const zero = Money.zero(budget.limit.currency);

  if (!budget.rollover) {
    return zero;
  }

  const previousMonth = budget.referenceMonth.add(-1);
  const previous = await budgets.findByCategoryAndMonth(
    workspaceId,
    budget.categoryId,
    previousMonth,
  );

  if (!previous) {
    return zero;
  }

  const consumed = await budgets.consumedFor(workspaceId, budget.categoryId, previousMonth);

  return previous
    .progressWith(Money.fromCents(consumed, budget.limit.currency))
    .rolloverToNextMonth();
}

// -- Listagem -----------------------------------------------------------------

export interface ListBudgetsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  month?: string;
}

export class ListBudgetsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly budgets: BudgetRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListBudgetsInput): Promise<Either<BudgetError, BudgetListResult>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    let referenceMonth = MonthReference.fromUtcDate(this.clock.now());

    if (input.month) {
      const parsed = MonthReference.create(input.month);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      referenceMonth = parsed.value;
    }

    const currency = authorized.value.workspace.baseCurrency;
    const views = await this.budgets.listByMonth(input.workspaceId, referenceMonth);

    const items: BudgetWithProgress[] = [];

    for (const view of views) {
      const carryOver = await carryOverFor(this.budgets, input.workspaceId, view.budget);

      items.push({
        view,
        progress: view.budget.progressWith(
          Money.fromCents(view.consumedInCents, currency),
          carryOver,
        ),
      });
    }

    return right({
      referenceMonth,
      items,
      unbudgetedInCents: await this.budgets.unbudgetedInMonth(input.workspaceId, referenceMonth),
    });
  }
}

// -- Criacao e edicao ---------------------------------------------------------

export interface CreateBudgetInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  categoryId: UniqueEntityId;
  referenceMonth: string;
  limitInCents: number;
  rollover: boolean;
}

export class CreateBudgetUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly budgets: BudgetRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(input: CreateBudgetInput): Promise<Either<BudgetError, BudgetWithProgress>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const month = MonthReference.create(input.referenceMonth);

    if (month.isLeft()) {
      return left(month.value);
    }

    const category = await this.categories.findById(input.workspaceId, input.categoryId);

    if (!category) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    // Orcamento de receita nao faz sentido: nao ha teto para quanto se ganha.
    if (category.type !== 'EXPENSE') {
      return left(
        new InvalidValueError('So categoria de despesa aceita orcamento.', 'categoryId'),
      );
    }

    const existing = await this.budgets.findByCategoryAndMonth(
      input.workspaceId,
      input.categoryId,
      month.value,
    );

    if (existing) {
      return left(new ConflictError('Ja existe um orcamento desta categoria neste mes.'));
    }

    const currency = authorized.value.workspace.baseCurrency;

    const budget = Budget.create({
      workspaceId: input.workspaceId,
      categoryId: input.categoryId,
      referenceMonth: month.value,
      limit: Money.fromCents(input.limitInCents, currency),
      rollover: input.rollover,
    });

    await this.budgets.create(budget);

    const views = await this.budgets.listByMonth(input.workspaceId, month.value);
    const view = views.find((entry) => entry.budget.id.equals(budget.id))!;

    return right({
      view,
      progress: budget.progressWith(
        Money.fromCents(view.consumedInCents, currency),
        await carryOverFor(this.budgets, input.workspaceId, budget),
      ),
    });
  }
}

export interface UpdateBudgetInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  budgetId: UniqueEntityId;
  limitInCents?: number;
  rollover?: boolean;
}

export class UpdateBudgetUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly budgets: BudgetRepository,
  ) {}

  async execute(input: UpdateBudgetInput): Promise<Either<BudgetError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const budget = await this.budgets.findById(input.workspaceId, input.budgetId);

    if (!budget) {
      return left(new ResourceNotFoundError('Orcamento'));
    }

    if (input.limitInCents !== undefined) {
      budget.changeLimit(
        Money.fromCents(input.limitInCents, authorized.value.workspace.baseCurrency),
      );
    }

    if (input.rollover !== undefined) {
      budget.setRollover(input.rollover);
    }

    await this.budgets.save(budget);

    return right(undefined);
  }
}

export interface DeleteBudgetInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  budgetId: UniqueEntityId;
}

export class DeleteBudgetUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly budgets: BudgetRepository,
  ) {}

  async execute(input: DeleteBudgetInput): Promise<Either<BudgetError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const budget = await this.budgets.findById(input.workspaceId, input.budgetId);

    if (!budget) {
      return left(new ResourceNotFoundError('Orcamento'));
    }

    // Os lancamentos ficam: o orcamento e' uma META sobre eles, nao o dono.
    await this.budgets.delete(input.workspaceId, input.budgetId);

    return right(undefined);
  }
}

// -- Copia de mes -------------------------------------------------------------

export interface CopyBudgetsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  from: string;
  to: string;
  overwrite: boolean;
}

/**
 * Copia os orcamentos de um mes para outro.
 *
 * Existe porque orcamento e' quase sempre o mesmo mes a mes, e recadastrar
 * doze categorias todo dia primeiro e' o tipo de trabalho que faz o usuario
 * abandonar a funcionalidade.
 */
export class CopyBudgetsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly budgets: BudgetRepository,
  ) {}

  async execute(input: CopyBudgetsInput): Promise<Either<BudgetError, { copied: number }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const from = MonthReference.create(input.from);
    const to = MonthReference.create(input.to);

    if (from.isLeft()) {
      return left(from.value);
    }

    if (to.isLeft()) {
      return left(to.value);
    }

    const [source, target] = await Promise.all([
      this.budgets.listByMonth(input.workspaceId, from.value),
      this.budgets.listByMonth(input.workspaceId, to.value),
    ]);

    const existing = new Map(
      target.map((entry) => [entry.budget.categoryId.toValue(), entry.budget]),
    );

    const toCreate: Budget[] = [];
    let copied = 0;

    for (const entry of source) {
      const already = existing.get(entry.budget.categoryId.toValue());

      if (already) {
        // Sem `overwrite`, o limite que o usuario ja ajustou no destino vence:
        // sobrescrever em silencio apagaria uma decisao consciente.
        if (!input.overwrite) {
          continue;
        }

        already.changeLimit(entry.budget.limit);
        already.setRollover(entry.budget.rollover);
        await this.budgets.save(already);
        copied += 1;
        continue;
      }

      toCreate.push(entry.budget.copyTo(to.value));
      copied += 1;
    }

    if (toCreate.length > 0) {
      await this.budgets.createMany(toCreate);
    }

    return right({ copied });
  }
}

// -- Alertas (job) ------------------------------------------------------------

export interface BudgetAlertReport {
  budgetsChecked: number;
  notificationsCreated: number;
}

/**
 * Avisa quando o orcamento chega a 80% e a 100%.
 *
 * **Uma vez por limiar, por mes** -- essa e' a regra que este job existe para
 * cumprir. Ela nao depende de controle em memoria: a tabela `budget_alerts`
 * tem indice unico `(budgetId, threshold)`, e como cada mes tem seu proprio
 * orcamento, "por mes" sai de graca.
 *
 * Sem isso, cada compra acima de 80% renderia um aviso novo -- quinze no mesmo
 * dia, e o usuario desligaria a notificacao inteira.
 */
export class CheckBudgetAlertsUseCase {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(reference?: MonthReference): Promise<BudgetAlertReport> {
    const month = reference ?? MonthReference.fromUtcDate(this.clock.now());
    const budgets = await this.budgets.findForAlertJob(month, 1_000);
    const report: BudgetAlertReport = { budgetsChecked: 0, notificationsCreated: 0 };

    for (const budget of budgets) {
      report.budgetsChecked += 1;

      const consumed = await this.budgets.consumedFor(
        budget.workspaceId,
        budget.categoryId,
        month,
      );

      const carryOver = await carryOverFor(this.budgets, budget.workspaceId, budget);
      const progress = budget.progressWith(
        Money.fromCents(consumed, budget.limit.currency),
        carryOver,
      );

      const alreadyNotified = await this.budgets.notifiedThresholds(budget.id);
      const thresholds = progress.thresholdsToNotify(alreadyNotified);

      for (const threshold of thresholds) {
        // O indice unico e' quem decide; duas execucoes simultaneas nao
        // conseguem passar as duas.
        if (!(await this.budgets.markThresholdNotified(budget.id, threshold))) {
          continue;
        }

        const members = await this.workspaces.listMembers(budget.workspaceId);
        const spent = formatMoney(progress.consumed, { locale: 'pt-BR' });
        const limit = formatMoney(progress.effectiveLimit, { locale: 'pt-BR' });

        report.notificationsCreated += await this.notifier.pushMany(
          members.map((member) => ({
            userId: member.userId,
            workspaceId: budget.workspaceId,
            type:
              threshold >= 100
                ? NotificationType.BUDGET_EXCEEDED
                : NotificationType.BUDGET_THRESHOLD_REACHED,
            title:
              threshold >= 100
                ? 'Orcamento estourado'
                : `Orcamento em ${progress.percent}%`,
            body: `${spent} de ${limit} em ${month.toString()}.`,
            data: {
              budgetId: budget.id.toValue(),
              month: month.toString(),
              threshold,
              percent: progress.percent,
            },
            dedupeKey: notificationDedupeKey(
              threshold >= 100
                ? NotificationType.BUDGET_EXCEEDED
                : NotificationType.BUDGET_THRESHOLD_REACHED,
              budget.id.toValue(),
              month.toString(),
              threshold,
            ),
          })),
        );
      }
    }

    return report;
  }
}
