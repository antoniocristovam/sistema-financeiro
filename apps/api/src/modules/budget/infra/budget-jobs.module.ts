import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { NOTIFIER, type Notifier } from '../../../shared/application/ports/notifier';
import { NotificationModule } from '../../notification/infra/notification.module';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import { CheckBudgetAlertsUseCase } from '../core/application/use-cases/manage-budgets';
import {
  BUDGET_REPOSITORY,
  type BudgetRepository,
} from '../core/domain/repositories/budget-repository';
import { PrismaBudgetRepository } from './prisma/prisma-budget-repository';
import { BUDGET_QUEUE, BudgetProcessor, BudgetScheduler } from './queue/budget-jobs';

/** Job de alerta de orcamento: 80% e 100%, uma vez cada, por mes. */
@Module({
  imports: [
    NotificationModule,
    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [BullModule.registerQueue({ name: BUDGET_QUEUE })]),
  ],
  providers: [
    { provide: BUDGET_REPOSITORY, useClass: PrismaBudgetRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },

    {
      provide: CheckBudgetAlertsUseCase,
      useFactory: (
        budgets: BudgetRepository,
        workspaces: WorkspaceRepository,
        notifier: Notifier,
        clock: Clock,
      ) => new CheckBudgetAlertsUseCase(budgets, workspaces, notifier, clock),
      inject: [BUDGET_REPOSITORY, WORKSPACE_REPOSITORY, NOTIFIER, CLOCK],
    },

    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [BudgetProcessor, BudgetScheduler]),
  ],
  exports: [CheckBudgetAlertsUseCase],
})
export class BudgetJobsModule {}
