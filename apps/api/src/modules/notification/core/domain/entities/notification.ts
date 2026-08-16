import { type NotificationType } from '@finapp/contracts';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';

export interface NotificationProps {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId | null;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  /** Identidade do evento que gerou o aviso. `null` = aviso avulso, repetivel. */
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Aviso na caixa do usuario.
 *
 * Pertence ao USUARIO, nao ao workspace: quem recebe "o aluguel vence em tres
 * dias" e' a pessoa, e ela pode estar em varios workspaces. O `workspaceId`
 * fica junto so para o deep link levar a tela certa.
 */
export class Notification extends Entity<NotificationProps> {
  static create(
    props: Optional<NotificationProps, 'data' | 'dedupeKey' | 'readAt' | 'createdAt'>,
    id?: UniqueEntityId,
  ): Notification {
    return new Notification(
      {
        ...props,
        data: props.data ?? null,
        dedupeKey: props.dedupeKey ?? null,
        readAt: props.readAt ?? null,
        createdAt: props.createdAt ?? new Date(),
      },
      id,
    );
  }

  get userId(): UniqueEntityId {
    return this.props.userId;
  }

  get workspaceId(): UniqueEntityId | null {
    return this.props.workspaceId;
  }

  get type(): NotificationType {
    return this.props.type;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get data(): Record<string, unknown> | null {
    return this.props.data;
  }

  get dedupeKey(): string | null {
    return this.props.dedupeKey;
  }

  get readAt(): Date | null {
    return this.props.readAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isRead(): boolean {
    return this.props.readAt !== null;
  }

  /** Marcar como lida duas vezes nao mexe na data da primeira leitura. */
  markRead(at: Date): void {
    if (this.props.readAt === null) {
      this.props.readAt = at;
    }
  }
}
