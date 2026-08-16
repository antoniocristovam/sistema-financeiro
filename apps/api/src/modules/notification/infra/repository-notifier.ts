import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type NotificationRequest,
  type Notifier,
} from '../../../shared/application/ports/notifier';
import { Notification } from '../core/domain/entities/notification';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../core/domain/repositories/notification-repository';

/**
 * Implementacao da porta `Notifier` sobre o repositorio de avisos.
 *
 * A traducao e' fina de proposito: quem avisa (recorrencia, orcamento, fatura)
 * so precisa dizer O QUE aconteceu e para quem, e nunca monta uma entidade.
 */
@Injectable()
export class RepositoryNotifier implements Notifier {
  private readonly logger = new Logger(RepositoryNotifier.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: NotificationRepository,
  ) {}

  push(request: NotificationRequest): Promise<boolean> {
    return this.notifications.createIfAbsent(
      Notification.create({
        userId: request.userId,
        workspaceId: request.workspaceId,
        type: request.type,
        title: request.title,
        body: request.body,
        data: request.data ?? null,
        dedupeKey: request.dedupeKey ?? null,
      }),
    );
  }

  /**
   * Um aviso que falha nao derruba o lote.
   *
   * O job que chama isto ja fez o trabalho util (materializou lancamento,
   * calculou orcamento); perder um aviso por causa de outro seria trocar um
   * problema pequeno por um grande.
   */
  async pushMany(requests: readonly NotificationRequest[]): Promise<number> {
    let created = 0;

    for (const request of requests) {
      try {
        if (await this.push(request)) {
          created += 1;
        }
      } catch (error) {
        this.logger.error(
          `Falha ao criar aviso ${request.type} para ${request.userId.toValue()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return created;
  }
}
