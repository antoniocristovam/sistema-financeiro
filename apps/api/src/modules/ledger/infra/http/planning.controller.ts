import {
  copyBudgetsBodySchema,
  createBudgetBodySchema,
  createContributionBodySchema,
  createGoalBodySchema,
  listBudgetsQuerySchema,
  listGoalsQuerySchema,
  updateBudgetBodySchema,
  updateGoalBodySchema,
  type Budget as BudgetContract,
  type BudgetList,
  type CopyBudgetsBody,
  type CreateBudgetBody,
  type CreateContributionBody,
  type CreateGoalBody,
  type Goal as GoalContract,
  type GoalList,
  type GoalWithContributions,
  type ListBudgetsQuery,
  type ListGoalsQuery,
  type UpdateBudgetBody,
  type UpdateGoalBody,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  CopyBudgetsUseCase,
  CreateBudgetUseCase,
  DeleteBudgetUseCase,
  ListBudgetsUseCase,
  UpdateBudgetUseCase,
  type BudgetWithProgress,
} from '../../../budget/core/application/use-cases/manage-budgets';
import {
  ContributeToGoalUseCase,
  CreateGoalUseCase,
  DeleteGoalUseCase,
  GetGoalUseCase,
  ListGoalsUseCase,
  RemoveContributionUseCase,
  UpdateGoalUseCase,
  type GoalWithProjection,
} from '../../../goal/core/application/use-cases/manage-goals';
import { type ContributionView } from '../../../goal/core/domain/repositories/goal-repository';

function budgetToHttp(entry: BudgetWithProgress): BudgetContract {
  const { budget } = entry.view;
  const { progress } = entry;

  return {
    id: budget.id.toValue(),
    category: entry.view.category,
    referenceMonth: budget.referenceMonth.toString(),
    limitInCents: budget.limit.toCents(),
    rollover: budget.rollover,
    carryOverInCents: progress.carryOver.toCents(),
    effectiveLimitInCents: progress.effectiveLimit.toCents(),
    consumedInCents: progress.consumed.toCents(),
    remainingInCents: progress.remaining.toCents(),
    percent: progress.percent,
    band: progress.band,
  };
}

function goalToHttp(entry: GoalWithProjection): GoalContract {
  const { goal } = entry.view;
  const { projection } = entry;

  return {
    id: goal.id.toValue(),
    name: goal.name,
    targetAmountInCents: goal.targetAmount.toCents(),
    savedInCents: projection.saved.toCents(),
    remainingInCents: projection.remaining.toCents(),
    basisPoints: projection.basisPoints,
    deadline: goal.deadline?.toString() ?? null,
    icon: goal.icon,
    color: goal.color,
    linkedAccountId: goal.linkedAccountId?.toValue() ?? null,
    linkedAccountName: entry.view.linkedAccountName,
    achievedAt: goal.achievedAt?.toISOString() ?? null,
    archivedAt: goal.archivedAt?.toISOString() ?? null,
    monthlyAverageInCents: projection.monthlyAverage.toCents(),
    estimatedCompletion: projection.estimatedCompletion?.toString() ?? null,
    monthsRemaining: projection.monthsRemaining,
    requiredMonthlyInCents: projection.requiredMonthly?.toCents() ?? null,
    isOnTrack: projection.isOnTrack,
    contributionCount: entry.view.contributionCount,
    createdAt: goal.createdAt.toISOString(),
  };
}

function contributionToHttp(entry: ContributionView) {
  return {
    id: entry.id,
    amountInCents: entry.amountInCents,
    date: entry.date.toString(),
    note: entry.note,
    transactionId: entry.transactionId,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Planejamento: orcamentos e metas.
 *
 * Os dois no mesmo controller porque respondem a mesma pergunta em direcoes
 * opostas -- quanto posso gastar neste mes, e quanto preciso guardar ate la.
 */
@Controller()
export class PlanningController {
  constructor(
    private readonly listBudgets: ListBudgetsUseCase,
    private readonly createBudget: CreateBudgetUseCase,
    private readonly updateBudget: UpdateBudgetUseCase,
    private readonly deleteBudget: DeleteBudgetUseCase,
    private readonly copyBudgets: CopyBudgetsUseCase,
    private readonly listGoals: ListGoalsUseCase,
    private readonly getGoal: GetGoalUseCase,
    private readonly createGoal: CreateGoalUseCase,
    private readonly updateGoal: UpdateGoalUseCase,
    private readonly deleteGoal: DeleteGoalUseCase,
    private readonly contribute: ContributeToGoalUseCase,
    private readonly removeContribution: RemoveContributionUseCase,
  ) {}

  // -- Orcamentos -------------------------------------------------------------

  @Get('budgets')
  async budgets(
    @Query(new ZodValidationPipe(listBudgetsQuerySchema)) query: ListBudgetsQuery,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<BudgetList> {
    const result = await this.listBudgets.execute({
      workspaceId,
      userId: user.id,
      ...(query.month ? { month: query.month } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const items = result.value.items.map(budgetToHttp);

    return {
      referenceMonth: result.value.referenceMonth.toString(),
      items,
      totalLimitInCents: items.reduce((sum, item) => sum + item.effectiveLimitInCents, 0),
      totalConsumedInCents: items.reduce((sum, item) => sum + item.consumedInCents, 0),
      unbudgetedInCents: result.value.unbudgetedInCents,
    };
  }

  @Post('budgets')
  async createBudgetRoute(
    @Body(new ZodValidationPipe(createBudgetBodySchema)) body: CreateBudgetBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<BudgetContract> {
    const result = await this.createBudget.execute({
      workspaceId,
      userId: user.id,
      categoryId: new UniqueEntityId(body.categoryId),
      referenceMonth: body.referenceMonth,
      limitInCents: body.limitInCents,
      rollover: body.rollover,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return budgetToHttp(result.value);
  }

  @Patch('budgets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateBudgetRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateBudgetBodySchema)) body: UpdateBudgetBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.updateBudget.execute({
      workspaceId,
      userId: user.id,
      budgetId: new UniqueEntityId(id),
      ...(body.limitInCents !== undefined ? { limitInCents: body.limitInCents } : {}),
      ...(body.rollover !== undefined ? { rollover: body.rollover } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Delete('budgets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBudgetRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.deleteBudget.execute({
      workspaceId,
      userId: user.id,
      budgetId: new UniqueEntityId(id),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('budgets/copy')
  async copy(
    @Body(new ZodValidationPipe(copyBudgetsBodySchema)) body: CopyBudgetsBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ copied: number }> {
    const result = await this.copyBudgets.execute({
      workspaceId,
      userId: user.id,
      from: body.from,
      to: body.to,
      overwrite: body.overwrite,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  // -- Metas ------------------------------------------------------------------

  @Get('goals')
  async goals(
    @Query(new ZodValidationPipe(listGoalsQuerySchema)) query: ListGoalsQuery,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<GoalList> {
    const result = await this.listGoals.execute({
      workspaceId,
      userId: user.id,
      includeArchived: query.includeArchived,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const items = result.value.map(goalToHttp);

    return {
      items,
      totalTargetInCents: items.reduce((sum, item) => sum + item.targetAmountInCents, 0),
      totalSavedInCents: items.reduce((sum, item) => sum + item.savedInCents, 0),
    };
  }

  @Get('goals/:id')
  async goal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<GoalWithContributions> {
    const result = await this.getGoal.execute({
      workspaceId,
      userId: user.id,
      goalId: new UniqueEntityId(id),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      ...goalToHttp({ view: result.value.view, projection: result.value.projection }),
      contributions: result.value.contributions.map(contributionToHttp),
    };
  }

  @Post('goals')
  async createGoalRoute(
    @Body(new ZodValidationPipe(createGoalBodySchema)) body: CreateGoalBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ id: string }> {
    const result = await this.createGoal.execute({
      workspaceId,
      userId: user.id,
      name: body.name,
      targetAmountInCents: body.targetAmountInCents,
      deadline: body.deadline,
      icon: body.icon,
      color: body.color,
      linkedAccountId: body.linkedAccountId,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.toValue() };
  }

  @Patch('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateGoalRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateGoalBodySchema)) body: UpdateGoalBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.updateGoal.execute({
      workspaceId,
      userId: user.id,
      goalId: new UniqueEntityId(id),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.targetAmountInCents !== undefined
        ? { targetAmountInCents: body.targetAmountInCents }
        : {}),
      ...(body.deadline !== undefined ? { deadline: body.deadline } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Delete('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGoalRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.deleteGoal.execute({
      workspaceId,
      userId: user.id,
      goalId: new UniqueEntityId(id),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('goals/:id/contributions')
  async contributeRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createContributionBodySchema)) body: CreateContributionBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ achieved: boolean }> {
    const result = await this.contribute.execute({
      workspaceId,
      userId: user.id,
      goalId: new UniqueEntityId(id),
      amountInCents: body.amountInCents,
      ...(body.date ? { date: body.date } : {}),
      ...(body.note ? { note: body.note } : {}),
      ...(body.fromAccountId ? { fromAccountId: body.fromAccountId } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  @Delete('goals/:id/contributions/:contributionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeContributionRoute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contributionId', new ParseUUIDPipe()) contributionId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.removeContribution.execute({
      workspaceId,
      userId: user.id,
      goalId: new UniqueEntityId(id),
      contributionId: new UniqueEntityId(contributionId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }
}
