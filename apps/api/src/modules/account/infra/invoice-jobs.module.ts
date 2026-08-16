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
import {
  CloseInvoicesUseCase,
  SendInvoiceRemindersUseCase,
} from '../core/application/use-cases/manage-invoices';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from '../core/domain/repositories/invoice-repository';
import { PrismaInvoiceRepository } from './prisma/prisma-invoice-repository';
import { INVOICE_QUEUE, InvoiceProcessor, InvoiceScheduler } from './queue/invoice-jobs';

/**
 * Jobs diarios das faturas: fechamento e lembrete de vencimento.
 *
 * Separado do modulo HTTP pelo mesmo motivo das contas fixas -- aqui nao ha
 * requisicao nem usuario, e o fechamento atravessa workspaces.
 */
@Module({
  imports: [
    NotificationModule,
    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [BullModule.registerQueue({ name: INVOICE_QUEUE })]),
  ],
  providers: [
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },

    {
      provide: CloseInvoicesUseCase,
      useFactory: (invoices: InvoiceRepository, clock: Clock) =>
        new CloseInvoicesUseCase(invoices, clock),
      inject: [INVOICE_REPOSITORY, CLOCK],
    },
    {
      provide: SendInvoiceRemindersUseCase,
      useFactory: (
        invoices: InvoiceRepository,
        workspaces: WorkspaceRepository,
        notifier: Notifier,
        clock: Clock,
      ) => new SendInvoiceRemindersUseCase(invoices, workspaces, notifier, clock),
      inject: [INVOICE_REPOSITORY, WORKSPACE_REPOSITORY, NOTIFIER, CLOCK],
    },

    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [InvoiceProcessor, InvoiceScheduler]),
  ],
  exports: [CloseInvoicesUseCase, SendInvoiceRemindersUseCase],
})
export class InvoiceJobsModule {}
