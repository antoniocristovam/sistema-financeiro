import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';

/**
 * Roteamento de um lancamento para a fatura do cartao (regra 5).
 *
 * Compra no cartao NAO debita a conta na data da compra: ela entra na fatura
 * conforme o dia de fechamento, e o saldo da conta corrente so muda quando a
 * fatura e' paga.
 *
 * A porta existe para o modulo de lancamentos nao precisar conhecer ciclo de
 * faturamento, competencia nem fatura -- ele pergunta "onde isto cai" e recebe
 * um id, ou `null` quando a conta nao e' cartao.
 */
export interface InvoiceRouter {
  /**
   * Em qual fatura este lancamento cai. `null` quando a conta nao e' cartao.
   *
   * Cria a fatura do ciclo se ela ainda nao existir -- a primeira compra do mes
   * e' que a faz nascer.
   */
  routeFor(
    workspaceId: UniqueEntityId,
    accountId: UniqueEntityId,
    date: CalendarDate,
  ): Promise<UniqueEntityId | null>;

  /**
   * Recalcula o total da fatura a partir dos itens.
   *
   * Chamado depois de criar, editar ou excluir um lancamento de cartao. O total
   * e' sempre RECALCULADO, nunca somado incrementalmente: um incremento perdido
   * numa falha deixaria a fatura mentindo para sempre, sem nada que a corrija.
   */
  refresh(workspaceId: UniqueEntityId, invoiceId: UniqueEntityId): Promise<void>;
}

export const INVOICE_ROUTER = Symbol('InvoiceRouter');
