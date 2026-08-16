import { ApiErrorCode, ONBOARDING_TOTAL_STEPS } from '@finapp/contracts';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type AccountWithCard } from '../../../../account/core/domain/repositories/account-repository';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { type Category } from '../../../../category/core/domain/entities/category';
import { type CategoryRepository } from '../../../../category/core/domain/repositories/category-repository';
import { FinancialProfile } from '../../../../identity/core/domain/entities/financial-profile';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { type Workspace } from '../../../../workspace/core/domain/entities/workspace';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';

export class OnboardingIncompleteError extends DomainError {
  readonly code = ApiErrorCode.ONBOARDING_REQUIRED;
  readonly message: string;

  constructor(missingStep: number) {
    super();
    this.message = `Conclua o passo ${missingStep} do onboarding antes de finalizar.`;
  }
}

export interface OnboardingStateOutput {
  workspace: Workspace;
  profile: FinancialProfile;
  accounts: AccountWithCard[];
  selectedCategoryKeys: string[];
}

/**
 * Estado do wizard, para retoma-lo de onde parou.
 *
 * Devolve tambem o que ja foi criado (contas, cartoes, categorias) porque o
 * usuario que volta precisa VER o que ja preencheu -- um wizard retomavel que
 * mostra campos vazios parece que perdeu tudo.
 */
export class GetOnboardingStateUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
  ): Promise<Either<AccessError, OnboardingStateOutput>> {
    const authorized = await this.access.authorize(workspaceId, userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const { workspace } = authorized.value;

    const [profile, accounts, selectedCategoryKeys] = await Promise.all([
      this.users.findProfileByUserId(userId),
      this.accounts.listByWorkspace(workspaceId),
      this.categories.listCopiedSystemKeys(workspaceId),
    ]);

    return right({
      workspace,
      profile: profile ?? FinancialProfile.create({ userId, currency: workspace.baseCurrency }),
      accounts,
      selectedCategoryKeys,
    });
  }
}

/** Catalogo de sementes, para a tela de escolha de categorias. */
export class ListSeedCategoriesUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(): Promise<Either<never, Category[]>> {
    return right(await this.categories.listSystemSeeds());
  }
}

export interface CompleteOnboardingInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
}

/**
 * Conclusao do wizard.
 *
 * Confere que os passos OBRIGATORIOS foram cumpridos em vez de confiar no
 * contador: o front pode chamar direto, e um perfil sem conta nenhuma deixaria
 * o usuario num dashboard que nao tem o que mostrar.
 *
 * O passo 3 (cartoes) e' opcional de proposito -- quem nao usa cartao pula.
 */
export class CompleteOnboardingUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: CompleteOnboardingInput,
  ): Promise<Either<AccessError | OnboardingIncompleteError, FinancialProfile>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const profile =
      (await this.users.findProfileByUserId(input.userId)) ??
      FinancialProfile.create({
        userId: input.userId,
        currency: authorized.value.workspace.baseCurrency,
      });

    if (profile.isOnboardingComplete()) {
      // Idempotente: recarregar a tela de conclusao nao pode falhar.
      return right(profile);
    }

    const accountCount = await this.accounts.countByWorkspace(input.workspaceId);

    if (accountCount === 0) {
      return left(new OnboardingIncompleteError(2));
    }

    const categoryKeys = await this.categories.listCopiedSystemKeys(input.workspaceId);

    if (categoryKeys.length === 0) {
      return left(new OnboardingIncompleteError(4));
    }

    profile.completeOnboarding(this.clock.now());
    profile.advanceTo(ONBOARDING_TOTAL_STEPS);

    await this.users.saveProfile(profile);

    return right(profile);
  }
}
