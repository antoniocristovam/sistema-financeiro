import {
  listNotificationsQuerySchema,
  markNotificationsReadBodySchema,
  type ListNotificationsQuery,
  type MarkNotificationsReadBody,
  type Notification as NotificationContract,
  type NotificationList,
} from '@finapp/contracts';
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import { type Notification } from '../../core/domain/entities/notification';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
} from '../../core/application/use-cases/manage-notifications';

function toHttp(notification: Notification): NotificationContract {
  return {
    id: notification.id.toValue(),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    workspaceId: notification.workspaceId?.toValue() ?? null,
    data: notification.data,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Caixa de avisos.
 *
 * Sem `x-workspace-id`: a caixa e' do USUARIO e atravessa os workspaces dele.
 * Quem esta em dois workspaces ve os avisos dos dois numa lista so, e cada
 * aviso carrega o `workspaceId` do deep link.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly listNotifications: ListNotificationsUseCase,
    private readonly markRead: MarkNotificationsReadUseCase,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
    @CurrentUser() user: CurrentUserData,
  ): Promise<NotificationList> {
    const result = await this.listNotifications.execute({
      userId: user.id.toValue(),
      onlyUnread: query.onlyUnread,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });

    const page = result.value;

    return {
      items: page.items.map(toHttp),
      nextCursor: page.nextCursor,
      unreadCount: page.unreadCount,
    };
  }

  /** Sem `ids`, marca todas -- e' o "limpar" do sininho. */
  @Patch('read')
  async read(
    @Body(new ZodValidationPipe(markNotificationsReadBodySchema))
    body: MarkNotificationsReadBody,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ updated: number; unreadCount: number }> {
    const result = await this.markRead.execute({
      userId: user.id.toValue(),
      ...(body.ids ? { ids: body.ids } : {}),
    });

    return result.value;
  }
}
