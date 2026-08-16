import { Module } from '@nestjs/common';

import { AUDIT_LOGGER, type AuditLogger } from '../../../shared/application/ports/audit-logger';
import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/ports/unit-of-work';
import {
  ArchiveAccountUseCase,
  CreateAccountUseCase,
  DeleteAccountUseCase,
  ListAccountsUseCase,
  UpdateAccountUseCase,
} from '../../account/core/application/use-cases/manage-accounts';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../account/core/domain/repositories/account-repository';
import { PrismaAccountRepository } from '../../account/infra/prisma/prisma-account-repository';
import {
  ArchiveCategoryUseCase,
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  ListCategoriesUseCase,
  ReorderCategoriesUseCase,
  UpdateCategoryUseCase,
} from '../../category/core/application/use-cases/manage-categories';
import {
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from '../../category/core/domain/repositories/category-repository';
import { PrismaCategoryRepository } from '../../category/infra/prisma/prisma-category-repository';
import { AttachmentModule } from '../../attachment/infra/attachment.module';
import {
  ATTACHMENT_CLEANER,
  type AttachmentCleaner,
} from '../../transaction/core/application/ports/attachment-cleaner';
import {
  CreateTransactionUseCase,
  CreateTransferUseCase,
  DeleteTransactionUseCase,
  ListTransactionsUseCase,
  UpdateTransactionUseCase,
} from '../../transaction/core/application/use-cases/manage-transactions';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../../transaction/core/domain/repositories/transaction-repository';
import { PrismaTransactionRepository } from '../../transaction/infra/prisma/prisma-transaction-repository';
import { WorkspaceAccessService } from '../../workspace/core/application/services/workspace-access';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import { AccountsController } from './http/accounts.controller';
import { CategoriesController } from './http/categories.controller';
import { TransactionsController } from './http/transactions.controller';

/**
 * Livro-caixa: contas, categorias e lancamentos.
 *
 * Os tres vivem no mesmo modulo porque se referenciam o tempo todo -- criar um
 * lancamento valida conta E categoria, excluir categoria realoca lancamentos,
 * listar conta soma lancamentos. Separar em tres modulos so criaria imports
 * circulares entre eles.
 *
 * Casos de uso continuam classes puras, montadas por `useFactory`.
 */
@Module({
  imports: [AttachmentModule],
  controllers: [AccountsController, CategoriesController, TransactionsController],
  providers: [
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },

    {
      provide: WorkspaceAccessService,
      useFactory: (workspaces: WorkspaceRepository) => new WorkspaceAccessService(workspaces),
      inject: [WORKSPACE_REPOSITORY],
    },

    // -- Contas ---------------------------------------------------------------
    {
      provide: ListAccountsUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        accounts: AccountRepository,
        transactions: TransactionRepository,
      ) => new ListAccountsUseCase(access, accounts, transactions),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY, TRANSACTION_REPOSITORY],
    },
    {
      provide: CreateAccountUseCase,
      useFactory: (access: WorkspaceAccessService, accounts: AccountRepository, clock: Clock) =>
        new CreateAccountUseCase(access, accounts, clock),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY, CLOCK],
    },
    {
      provide: UpdateAccountUseCase,
      useFactory: (access: WorkspaceAccessService, accounts: AccountRepository) =>
        new UpdateAccountUseCase(access, accounts),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY],
    },
    {
      provide: ArchiveAccountUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        accounts: AccountRepository,
        audit: AuditLogger,
        clock: Clock,
      ) => new ArchiveAccountUseCase(access, accounts, audit, clock),
      inject: [WorkspaceAccessService, ACCOUNT_REPOSITORY, AUDIT_LOGGER, CLOCK],
    },
    {
      provide: DeleteAccountUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        accounts: AccountRepository,
        transactions: TransactionRepository,
        audit: AuditLogger,
        unitOfWork: UnitOfWork,
      ) => new DeleteAccountUseCase(access, accounts, transactions, audit, unitOfWork),
      inject: [
        WorkspaceAccessService,
        ACCOUNT_REPOSITORY,
        TRANSACTION_REPOSITORY,
        AUDIT_LOGGER,
        UNIT_OF_WORK,
      ],
    },

    // -- Categorias -----------------------------------------------------------
    {
      provide: ListCategoriesUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        categories: CategoryRepository,
        transactions: TransactionRepository,
      ) => new ListCategoriesUseCase(access, categories, transactions),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY, TRANSACTION_REPOSITORY],
    },
    {
      provide: CreateCategoryUseCase,
      useFactory: (access: WorkspaceAccessService, categories: CategoryRepository) =>
        new CreateCategoryUseCase(access, categories),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY],
    },
    {
      provide: UpdateCategoryUseCase,
      useFactory: (access: WorkspaceAccessService, categories: CategoryRepository) =>
        new UpdateCategoryUseCase(access, categories),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY],
    },
    {
      provide: ReorderCategoriesUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        categories: CategoryRepository,
        unitOfWork: UnitOfWork,
      ) => new ReorderCategoriesUseCase(access, categories, unitOfWork),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY, UNIT_OF_WORK],
    },
    {
      provide: ArchiveCategoryUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        categories: CategoryRepository,
        clock: Clock,
      ) => new ArchiveCategoryUseCase(access, categories, clock),
      inject: [WorkspaceAccessService, CATEGORY_REPOSITORY, CLOCK],
    },
    {
      provide: DeleteCategoryUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        categories: CategoryRepository,
        transactions: TransactionRepository,
        audit: AuditLogger,
        unitOfWork: UnitOfWork,
      ) => new DeleteCategoryUseCase(access, categories, transactions, audit, unitOfWork),
      inject: [
        WorkspaceAccessService,
        CATEGORY_REPOSITORY,
        TRANSACTION_REPOSITORY,
        AUDIT_LOGGER,
        UNIT_OF_WORK,
      ],
    },

    // -- Lancamentos ----------------------------------------------------------
    {
      provide: ListTransactionsUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        categories: CategoryRepository,
      ) => new ListTransactionsUseCase(access, transactions, categories),
      inject: [WorkspaceAccessService, TRANSACTION_REPOSITORY, CATEGORY_REPOSITORY],
    },
    {
      provide: CreateTransactionUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        accounts: AccountRepository,
        categories: CategoryRepository,
        clock: Clock,
      ) => new CreateTransactionUseCase(access, transactions, accounts, categories, clock),
      inject: [
        WorkspaceAccessService,
        TRANSACTION_REPOSITORY,
        ACCOUNT_REPOSITORY,
        CATEGORY_REPOSITORY,
        CLOCK,
      ],
    },
    {
      provide: CreateTransferUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        accounts: AccountRepository,
        unitOfWork: UnitOfWork,
      ) => new CreateTransferUseCase(access, transactions, accounts, unitOfWork),
      inject: [WorkspaceAccessService, TRANSACTION_REPOSITORY, ACCOUNT_REPOSITORY, UNIT_OF_WORK],
    },
    {
      provide: UpdateTransactionUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        categories: CategoryRepository,
        unitOfWork: UnitOfWork,
      ) => new UpdateTransactionUseCase(access, transactions, categories, unitOfWork),
      inject: [WorkspaceAccessService, TRANSACTION_REPOSITORY, CATEGORY_REPOSITORY, UNIT_OF_WORK],
    },
    {
      provide: DeleteTransactionUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        transactions: TransactionRepository,
        audit: AuditLogger,
        unitOfWork: UnitOfWork,
        attachments: AttachmentCleaner,
      ) => new DeleteTransactionUseCase(access, transactions, audit, unitOfWork, attachments),
      inject: [
        WorkspaceAccessService,
        TRANSACTION_REPOSITORY,
        AUDIT_LOGGER,
        UNIT_OF_WORK,
        ATTACHMENT_CLEANER,
      ],
    },
  ],
})
export class LedgerModule {}
