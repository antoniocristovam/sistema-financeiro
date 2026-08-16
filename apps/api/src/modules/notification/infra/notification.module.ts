import { Module } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { NOTIFIER } from '../../../shared/application/ports/notifier';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
} from '../core/application/use-cases/manage-notifications';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../core/domain/repositories/notification-repository';
import { NotificationsController } from './http/notifications.controller';
import { PrismaNotificationRepository } from './prisma/prisma-notification-repository';
import { RepositoryNotifier } from './repository-notifier';

/**
 * Avisos.
 *
 * Exporta o `NOTIFIER` para que os outros modulos (contas fixas hoje;
 * orcamento, fatura e meta nas proximas fases) avisem o usuario sem conhecer
 * nem o repositorio nem a entidade de aviso.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: NOTIFIER, useClass: RepositoryNotifier },

    {
      provide: ListNotificationsUseCase,
      useFactory: (notifications: NotificationRepository) =>
        new ListNotificationsUseCase(notifications),
      inject: [NOTIFICATION_REPOSITORY],
    },
    {
      provide: MarkNotificationsReadUseCase,
      useFactory: (notifications: NotificationRepository, clock: Clock) =>
        new MarkNotificationsReadUseCase(notifications, clock),
      inject: [NOTIFICATION_REPOSITORY, CLOCK],
    },
  ],
  exports: [NOTIFIER, NOTIFICATION_REPOSITORY],
})
export class NotificationModule {}
