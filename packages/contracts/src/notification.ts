import { z } from 'zod';

import { NotificationType } from './enums.js';
import { cursorPaginationQuerySchema } from './pagination.js';
import { zBooleanQueryParam, zInstant, zUuid } from './primitives.js';

export const notificationSchema = z.object({
  id: zUuid,
  type: z.nativeEnum(NotificationType),
  title: z.string(),
  body: z.string(),
  workspaceId: zUuid.nullable(),
  /**
   * Carga do deep link, especifica por tipo (ex.: `{ recurrenceId, date }`).
   *
   * Fica solta de proposito: cada tipo novo de aviso traria um campo novo, e o
   * contrato inteiro seria versionado por causa de um link.
   */
  data: z.record(z.unknown()).nullable(),
  readAt: zInstant.nullable(),
  createdAt: zInstant,
});

export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = cursorPaginationQuerySchema.extend({
  onlyUnread: zBooleanQueryParam(false),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  /** Nao lidas no total, nao apenas nesta pagina: e' o numero do sininho. */
  unreadCount: z.number().int().nonnegative(),
});

export type NotificationList = z.infer<typeof notificationListSchema>;

export const markNotificationsReadBodySchema = z.object({
  /** Vazio ou ausente = marca todas como lidas. */
  ids: z.array(zUuid).max(200).optional(),
});

export type MarkNotificationsReadBody = z.infer<typeof markNotificationsReadBodySchema>;

/**
 * Chave de deduplicacao de um aviso.
 *
 * A regra e' "uma vez por evento", nao "uma vez por execucao": o job diario
 * pode rodar de novo depois de uma falha, e o usuario nao pode receber o mesmo
 * lembrete duas vezes. A chave e' deterministica, entao a segunda tentativa
 * esbarra no indice unico do banco em vez de criar um segundo aviso.
 *
 * O orcamento usa o mesmo mecanismo com o limiar e o mes na chave -- e' assim
 * que "avisar uma vez por limiar por mes" e' cumprido.
 */
export function notificationDedupeKey(
  type: NotificationType,
  ...parts: readonly (string | number)[]
): string {
  return [type, ...parts].join(':');
}
