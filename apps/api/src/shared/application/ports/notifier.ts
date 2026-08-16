import { type NotificationType } from '@finapp/contracts';

import { type UniqueEntityId } from '../../domain/unique-entity-id';

export interface NotificationRequest {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /**
   * Identidade do EVENTO. Duas chamadas com a mesma chave para o mesmo usuario
   * produzem um aviso so.
   */
  dedupeKey?: string;
}

/**
 * Emissao de avisos.
 *
 * Porta compartilhada porque quem avisa nao e' um modulo so: recorrencia avisa
 * conta a vencer, orcamento avisa limiar atingido, fatura avisa fechamento,
 * meta avisa conclusao. Todos precisam do mesmo mecanismo de deduplicacao e
 * nenhum deles precisa saber como o aviso e' gravado ou entregue.
 */
export interface Notifier {
  /**
   * Devolve `true` quando o aviso foi criado agora e `false` quando ja existia.
   *
   * O retorno importa: e' ele que decide se o e-mail sai. Sem isso, uma
   * reexecucao do job diario nao duplicaria o aviso na tela mas mandaria o
   * segundo e-mail assim mesmo.
   */
  push(request: NotificationRequest): Promise<boolean>;

  /** Um lote inteiro, para avisar todos os membros de um workspace. */
  pushMany(requests: readonly NotificationRequest[]): Promise<number>;
}

export const NOTIFIER = Symbol('Notifier');
