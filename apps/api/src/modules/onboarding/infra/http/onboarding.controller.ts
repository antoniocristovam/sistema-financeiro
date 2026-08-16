import {
  categoriesStepSchema,
  creditCardsStepSchema,
  firstAccountStepSchema,
  incomeStepSchema,
  savingsTargetStepSchema,
  type CategoriesStepBody,
  type CreditCardsStepBody,
  type FirstAccountStepBody,
  type IncomeStepBody,
  type OnboardingState,
  type SavingsTargetStepBody,
  type SeedCatalog,
} from '@finapp/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { type UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  CompleteOnboardingUseCase,
  GetOnboardingStateUseCase,
  ListSeedCategoriesUseCase,
} from '../../core/application/use-cases/onboarding-state';
import {
  AddCreditCardsStepUseCase,
  CreateFirstAccountStepUseCase,
  SaveIncomeStepUseCase,
  SelectCategoriesStepUseCase,
  SetSavingsTargetStepUseCase,
} from '../../core/application/use-cases/onboarding-steps';
import { OnboardingPresenter } from './onboarding-presenter';

/**
 * Wizard de onboarding.
 *
 * O workspace vem no header `x-workspace-id` -- estas rotas operam DENTRO do
 * workspace ativo, ao contrario das de `/workspaces/:id`, que sao sobre o
 * workspace em si.
 *
 * Cada passo e' `PUT`: gravar o passo 1 duas vezes tem que dar o mesmo
 * resultado. O usuario que volta para revisar e salva de novo nao pode
 * duplicar nada.
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly getState: GetOnboardingStateUseCase,
    private readonly listSeeds: ListSeedCategoriesUseCase,
    private readonly saveIncome: SaveIncomeStepUseCase,
    private readonly createAccount: CreateFirstAccountStepUseCase,
    private readonly addCards: AddCreditCardsStepUseCase,
    private readonly selectCategories: SelectCategoriesStepUseCase,
    private readonly setSavings: SetSavingsTargetStepUseCase,
    private readonly complete: CompleteOnboardingUseCase,
  ) {}

  @Get()
  async state(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<OnboardingState> {
    const result = await this.getState.execute(workspaceId, user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return OnboardingPresenter.state(result.value);
  }

  /** Catalogo de categorias semente. Nao depende do workspace. */
  @Get('seed-categories')
  async seedCategories(): Promise<SeedCatalog> {
    const result = await this.listSeeds.execute();

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { categories: OnboardingPresenter.seedCatalog(result.value) };
  }

  @Put('income')
  @HttpCode(HttpStatus.NO_CONTENT)
  async income(
    @Body(new ZodValidationPipe(incomeStepSchema)) body: IncomeStepBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.saveIncome.execute({
      userId: user.id,
      workspaceId,
      monthlyIncomeInCents: body.monthlyIncomeInCents,
      payday: body.payday,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('accounts')
  async firstAccount(
    @Body(new ZodValidationPipe(firstAccountStepSchema)) body: FirstAccountStepBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ id: string }> {
    const result = await this.createAccount.execute({ userId: user.id, workspaceId, ...body });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { id: result.value.id.toValue() };
  }

  /** Passo opcional: lista vazia pula e avanca o wizard. */
  @Post('credit-cards')
  async creditCards(
    @Body(new ZodValidationPipe(creditCardsStepSchema)) body: CreditCardsStepBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ ids: string[] }> {
    const result = await this.addCards.execute({
      userId: user.id,
      workspaceId,
      cards: body.cards,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { ids: result.value.map((account) => account.id.toValue()) };
  }

  @Put('categories')
  @HttpCode(HttpStatus.NO_CONTENT)
  async categories(
    @Body(new ZodValidationPipe(categoriesStepSchema)) body: CategoriesStepBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.selectCategories.execute({
      userId: user.id,
      workspaceId,
      systemKeys: body.systemKeys,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Put('savings-target')
  @HttpCode(HttpStatus.NO_CONTENT)
  async savingsTarget(
    @Body(new ZodValidationPipe(savingsTargetStepSchema)) body: SavingsTargetStepBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<void> {
    const result = await this.setSavings.execute({
      userId: user.id,
      workspaceId,
      savingsTargetPercent: body.savingsTargetPercent,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('complete')
  async finish(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ completedAt: string }> {
    const result = await this.complete.execute({ userId: user.id, workspaceId });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { completedAt: result.value.onboardingCompletedAt!.toISOString() };
  }
}
