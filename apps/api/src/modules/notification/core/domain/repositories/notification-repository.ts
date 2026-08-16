import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Notification } from '../entities/notification';

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * Porta do repositorio de avisos.
 *
 * O escopo aqui e' o USUARIO, nao o workspace -- a caixa e' pessoal. Toda
 * assinatura leva `userId` pelo mesmo motivo que as outras levam
 * `workspaceId`: sem id do dono no tipo, ler o aviso alheio vira um esquecimento
 * de `where`.
 */
export interface NotificationRepository {
  list(
    userId: UniqueEntityId,
    options: { onlyUnread: boolean; cursor?: string; limit: number },
  ): Promise<NotificationPage>;

  unreadCount(userId: UniqueEntityId): Promise<number>;

  /**
   * Cria o aviso, ou nao faz nada se a chave de deduplicacao ja existe.
   *
   * Devolve `true` so quando criou de fato. A checagem e' delegada ao indice
   * unico do banco em vez de um "select antes de inserir": dois workers rodando
   * o mesmo job passariam juntos pelo select e criariam dois avisos.
   */
  createIfAbsent(notification: Notification): Promise<boolean>;

  /** `ids` vazio = todas as nao lidas do usuario. Devolve quantas mudaram. */
  markRead(userId: UniqueEntityId, ids: UniqueEntityId[], at: Date): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NotificationRepository');
