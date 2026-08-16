import {
  type CreateRecurrenceBody,
  type ListNotificationsQuery,
  type NotificationList,
  type Recurrence,
  type RecurrenceList,
  type RecurrenceOccurrence,
  type SkipOccurrenceBody,
  type UpdateRecurrenceBody,
} from '@finapp/contracts';

import {
  type NotificationGateway,
  type RecurrenceGateway,
} from '../../application/gateways';
import { type HttpClient } from '../http/http-client';

export class HttpRecurrenceGateway implements RecurrenceGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, includeInactive = false): Promise<RecurrenceList> {
    return this.http.get<RecurrenceList>(
      `/recurrences?includeInactive=${String(includeInactive)}`,
      { workspaceId },
    );
  }

  create(workspaceId: string, body: CreateRecurrenceBody): Promise<Recurrence> {
    return this.http.post<Recurrence>('/recurrences', body, { workspaceId });
  }

  update(workspaceId: string, id: string, body: UpdateRecurrenceBody): Promise<Recurrence> {
    return this.http.patch<Recurrence>(`/recurrences/${id}`, body, { workspaceId });
  }

  remove(workspaceId: string, id: string): Promise<void> {
    return this.http.delete<void>(`/recurrences/${id}`, { workspaceId });
  }

  occurrences(workspaceId: string, id: string): Promise<RecurrenceOccurrence[]> {
    return this.http.get<RecurrenceOccurrence[]>(`/recurrences/${id}/occurrences`, {
      workspaceId,
    });
  }

  skip(workspaceId: string, id: string, body: SkipOccurrenceBody): Promise<void> {
    return this.http.post<void>(`/recurrences/${id}/skips`, body, { workspaceId });
  }
}

/**
 * Avisos.
 *
 * Nenhum metodo recebe `workspaceId`: a caixa e' do USUARIO e atravessa os
 * workspaces dele. Mandar o cabecalho aqui daria a entender que o sininho muda
 * quando se troca de workspace -- e nao muda.
 */
export class HttpNotificationGateway implements NotificationGateway {
  constructor(private readonly http: HttpClient) {}

  list(query: Partial<ListNotificationsQuery> = {}): Promise<NotificationList> {
    const search = new URLSearchParams();

    if (query.onlyUnread !== undefined) {
      search.set('onlyUnread', String(query.onlyUnread));
    }

    if (query.cursor) {
      search.set('cursor', query.cursor);
    }

    if (query.limit !== undefined) {
      search.set('limit', String(query.limit));
    }

    const suffix = search.toString();

    return this.http.get<NotificationList>(`/notifications${suffix ? `?${suffix}` : ''}`);
  }

  markRead(ids?: string[]): Promise<{ updated: number; unreadCount: number }> {
    return this.http.patch<{ updated: number; unreadCount: number }>(
      '/notifications/read',
      ids ? { ids } : {},
    );
  }
}
