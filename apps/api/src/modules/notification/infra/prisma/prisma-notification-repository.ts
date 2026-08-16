import { type NotificationType } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';
import { type Prisma, type Notification as PrismaNotification } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { Notification } from '../../core/domain/entities/notification';
import {
  type NotificationPage,
  type NotificationRepository,
} from '../../core/domain/repositories/notification-repository';

function toDomain(raw: PrismaNotification): Notification {
  return Notification.create(
    {
      userId: new UniqueEntityId(raw.userId),
      workspaceId: raw.workspaceId ? new UniqueEntityId(raw.workspaceId) : null,
      type: raw.type as NotificationType,
      title: raw.title,
      body: raw.body,
      data: (raw.data as Record<string, unknown> | null) ?? null,
      dedupeKey: raw.dedupeKey,
      readAt: raw.readAt,
      createdAt: raw.createdAt,
    },
    new UniqueEntityId(raw.id),
  );
}

/**
 * Cursor de `createdAt|id`.
 *
 * O id entra como desempate porque dois avisos criados pelo mesmo job
 * compartilham o instante ate o milissegundo -- sem ele, a pagina seguinte
 * repetiria ou pularia justamente os avisos do lote.
 */
function encodeCursor(notification: Notification): string {
  return Buffer.from(
    `${notification.createdAt.toISOString()}|${notification.id.toValue()}`,
  ).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [instant, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');

  if (!instant || !id) {
    return null;
  }

  const createdAt = new Date(instant);

  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async list(
    userId: UniqueEntityId,
    options: { onlyUnread: boolean; cursor?: string; limit: number },
  ): Promise<NotificationPage> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const where: Prisma.NotificationWhereInput = {
      userId: userId.toValue(),
      ...(options.onlyUnread ? { readAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const [raws, unreadCount] = await Promise.all([
      this.tx.client.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // Um a mais para saber se ha proxima pagina sem um COUNT separado.
        take: options.limit + 1,
      }),
      this.unreadCount(userId),
    ]);

    const items = raws.slice(0, options.limit).map(toDomain);

    return {
      items,
      nextCursor: raws.length > options.limit ? encodeCursor(items.at(-1)!) : null,
      unreadCount,
    };
  }

  unreadCount(userId: UniqueEntityId): Promise<number> {
    return this.tx.client.notification.count({
      where: { userId: userId.toValue(), readAt: null },
    });
  }

  /**
   * Sem excecao no caminho normal: `skipDuplicates` deixa o indice
   * `(userId, dedupeKey)` decidir sem sujar o log com um erro do Prisma toda
   * vez que um aviso ja enviado e' reapresentado.
   */
  async createIfAbsent(notification: Notification): Promise<boolean> {
    const result = await this.tx.client.notification.createMany({
      skipDuplicates: true,
      data: [
        {
          id: notification.id.toValue(),
          userId: notification.userId.toValue(),
          workspaceId: notification.workspaceId?.toValue() ?? null,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          data: (notification.data ?? undefined) as Prisma.InputJsonValue | undefined,
          dedupeKey: notification.dedupeKey,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        },
      ],
    });

    return result.count === 1;
  }

  async markRead(userId: UniqueEntityId, ids: UniqueEntityId[], at: Date): Promise<number> {
    const result = await this.tx.client.notification.updateMany({
      where: {
        userId: userId.toValue(),
        readAt: null,
        ...(ids.length > 0 ? { id: { in: ids.map((id) => id.toValue()) } } : {}),
      },
      data: { readAt: at },
    });

    return result.count;
  }
}
