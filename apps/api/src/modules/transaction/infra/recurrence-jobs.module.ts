import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '../../../config/env';
import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { MAIL_SERVICE, type MailService } from '../../../shared/application/ports/mail-service';
import { NOTIFIER, type Notifier } from '../../../shared/application/ports/notifier';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/core/domain/repositories/user-repository';
import { PrismaUserRepository } from '../../identity/infra/prisma/repositories/prisma-user-repository';
import { NotificationModule } from '../../notification/infra/notification.module';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import {
  MaterializeRecurrencesUseCase,
  SendRecurrenceRemindersUseCase,
} from '../core/application/use-cases/run-recurrence-jobs';
import {
  RECURRENCE_REPOSITORY,
  type RecurrenceRepository,
} from '../core/domain/repositories/recurrence-repository';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../core/domain/repositories/transaction-repository';
import { PrismaRecurrenceRepository } from './prisma/prisma-recurrence-repository';
import { PrismaTransactionRepository } from './prisma/prisma-transaction-repository';
import {
  RECURRENCE_QUEUE,
  RecurrenceProcessor,
  RecurrenceScheduler,
} from './queue/recurrence-jobs';

/**
 * Os jobs diarios das contas fixas.
 *
 * Modulo separado do `LedgerModule` porque a natureza e' outra: aqui nao ha
 * requisicao, usuario nem workspace no contexto. Manter os dois juntos
 * convidaria um caso de uso de request a injetar por engano o repositorio que
 * atravessa workspaces.
 *
 * O processador e o agendador so entram quando `QUEUE_WORKER_ENABLED` esta
 * ligado: os testes de integracao sobem a app inteira, e um worker ativo
 * processaria os dados do teste no meio da suite. Os casos de uso continuam
 * registrados nos dois casos -- e' assim que o teste chama a rotina diretamente,
 * sem depender do Redis.
 */
@Module({
  imports: [
    NotificationModule,
    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [BullModule.registerQueue({ name: RECURRENCE_QUEUE })]),
  ],
  providers: [
    { provide: RECURRENCE_REPOSITORY, useClass: PrismaRecurrenceRepository },
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },

    {
      provide: MaterializeRecurrencesUseCase,
      useFactory: (
        recurrences: RecurrenceRepository,
        transactions: TransactionRepository,
        workspaces: WorkspaceRepository,
        clock: Clock,
      ) => new MaterializeRecurrencesUseCase(recurrences, transactions, workspaces, clock),
      inject: [RECURRENCE_REPOSITORY, TRANSACTION_REPOSITORY, WORKSPACE_REPOSITORY, CLOCK],
    },
    {
      provide: SendRecurrenceRemindersUseCase,
      useFactory: (
        recurrences: RecurrenceRepository,
        workspaces: WorkspaceRepository,
        users: UserRepository,
        notifier: Notifier,
        mail: MailService,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new SendRecurrenceRemindersUseCase(
          recurrences,
          workspaces,
          users,
          notifier,
          mail,
          clock,
          config.get('WEB_URL', { infer: true }),
        ),
      inject: [
        RECURRENCE_REPOSITORY,
        WORKSPACE_REPOSITORY,
        USER_REPOSITORY,
        NOTIFIER,
        MAIL_SERVICE,
        CLOCK,
        ConfigService,
      ],
    },

    ...(process.env.QUEUE_WORKER_ENABLED === 'false'
      ? []
      : [RecurrenceProcessor, RecurrenceScheduler]),
  ],
  exports: [MaterializeRecurrencesUseCase, SendRecurrenceRemindersUseCase],
})
export class RecurrenceJobsModule {}
