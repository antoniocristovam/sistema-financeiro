import { type Clock } from '../../../../../shared/application/ports/clock';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, right } from '../../../../../shared/either';
import {
  type NotificationPage,
  type NotificationRepository,
} from '../../domain/repositories/notification-repository';

export interface ListNotificationsInput {
  userId: string;
  onlyUnread: boolean;
  cursor?: string;
  limit: number;
}

/**
 * Caixa de avisos do usuario.
 *
 * Nao passa por `WorkspaceAccessService`: o aviso e' pessoal e o escopo e' o
 * proprio usuario autenticado. Nao existe "ler os avisos de outra pessoa" nem
 * para o dono do workspace, entao nao ha papel a consultar.
 */
export class ListNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(input: ListNotificationsInput): Promise<Either<never, NotificationPage>> {
    const page = await this.notifications.list(new UniqueEntityId(input.userId), {
      onlyUnread: input.onlyUnread,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit,
    });

    return right(page);
  }
}

export interface MarkNotificationsReadInput {
  userId: string;
  /** Vazio ou ausente = todas as nao lidas. */
  ids?: string[];
}

export class MarkNotificationsReadUseCase {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: MarkNotificationsReadInput,
  ): Promise<Either<never, { updated: number; unreadCount: number }>> {
    const userId = new UniqueEntityId(input.userId);

    const updated = await this.notifications.markRead(
      userId,
      (input.ids ?? []).map((id) => new UniqueEntityId(id)),
      this.clock.now(),
    );

    return right({ updated, unreadCount: await this.notifications.unreadCount(userId) });
  }
}
