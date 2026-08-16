import { Module } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/ports/unit-of-work';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../account/core/domain/repositories/account-repository';
import { PrismaAccountRepository } from '../../account/infra/prisma/prisma-account-repository';
import {
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from '../../category/core/domain/repositories/category-repository';
import { PrismaCategoryRepository } from '../../category/infra/prisma/prisma-category-repository';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/core/domain/repositories/user-repository';
import { PrismaUserRepository } from '../../identity/infra/prisma/repositories/prisma-user-repository';
import { WorkspaceAccessService } from '../../workspace/core/application/services/workspace-access';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import {
  CompleteOnboardingUseCase,
  GetOnboardingStateUseCase,
  ListSeedCategoriesUseCase,
} from '../core/application/use-cases/onboarding-state';
import {
  AddCreditCardsStepUseCase,
  CreateFirstAccountStepUseCase,
  SaveIncomeStepUseCase,
  SelectCategoriesStepUseCase,
  SetSavingsTargetStepUseCase,
} from '../core/application/use-cases/onboarding-steps';
import { OnboardingController } from './http/onboarding.controller';

/** Composition root do onboarding. Casos de uso puros, montados por factory. */
@Module({
  controllers: [OnboardingController],
  providers: [
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },

    {
      provide: WorkspaceAccessService,
      useFactory: (workspaces: WorkspaceRepository) => new WorkspaceAccessService(workspaces),
      inject: [WORKSPACE_REPOSITORY],
    },

    {
      provide: GetOnboardingStateUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        users: UserRepository,
        accounts: AccountRepository,
        categories: CategoryRepository,
      ) => new GetOnboardingStateUseCase(access, users, accounts, categories),
      inject: [WorkspaceAccessService, USER_REPOSITORY, ACCOUNT_REPOSITORY, CATEGORY_REPOSITORY],
    },

    {
      provide: ListSeedCategoriesUseCase,
      useFactory: (categories: CategoryRepository) => new ListSeedCategoriesUseCase(categories),
      inject: [CATEGORY_REPOSITORY],
    },

    {
      provide: SaveIncomeStepUseCase,
      useFactory: (access: WorkspaceAccessService, users: UserRepository) =>
        new SaveIncomeStepUseCase(access, users),
      inject: [WorkspaceAccessService, USER_REPOSITORY],
    },

    {
      provide: CreateFirstAccountStepUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        accounts: AccountRepository,
        users: UserRepository,
        clock: Clock,
        unitOfWork: UnitOfWork,
      ) => new CreateFirstAccountStepUseCase(access, accounts, users, clock, unitOfWork),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY, USER_REPOSITORY, CLOCK, UNIT_OF_WORK],
    },

    {
      provide: AddCreditCardsStepUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        accounts: AccountRepository,
        users: UserRepository,
        clock: Clock,
        unitOfWork: UnitOfWork,
      ) => new AddCreditCardsStepUseCase(access, accounts, users, clock, unitOfWork),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY, USER_REPOSITORY, CLOCK, UNIT_OF_WORK],
    },

    {
      provide: SelectCategoriesStepUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        categories: CategoryRepository,
        users: UserRepository,
        unitOfWork: UnitOfWork,
      ) => new SelectCategoriesStepUseCase(access, categories, users, unitOfWork),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY, USER_REPOSITORY, UNIT_OF_WORK],
    },

    {
      provide: SetSavingsTargetStepUseCase,
      useFactory: (access: WorkspaceAccessService, users: UserRepository) =>
        new SetSavingsTargetStepUseCase(access, users),
      inject: [WorkspaceAccessService, USER_REPOSITORY],
    },

    {
      provide: CompleteOnboardingUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        users: UserRepository,
        accounts: AccountRepository,
        categories: CategoryRepository,
        clock: Clock,
      ) => new CompleteOnboardingUseCase(access, users, accounts, categories, clock),
      inject: [
        WorkspaceAccessService,
        USER_REPOSITORY,
        ACCOUNT_REPOSITORY,
        CATEGORY_REPOSITORY,
        CLOCK,
      ],
    },
  ],
})
export class OnboardingModule {}
