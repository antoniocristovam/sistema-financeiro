import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { type Invoice } from '../entities/invoice';

/** Uma linha da fatura, ja com o que a tela precisa mostrar. */
export interface InvoiceItemView {
  id: string;
  date: CalendarDate;
  description: string;
  amountInCents: number;
  category: { id: string; name: string; icon: string | null; color: string | null } | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
}

export interface InvoiceView {
  invoice: Invoice;
  cardName: string;
  itemCount: number;
}

/**
 * Porta do repositorio de faturas.
 *
 * O escopo continua sendo o workspace, mesmo a fatura pertencendo a um cartao:
 * o cartao e' uma conta, e conta e' escopada. Sem `workspaceId` na assinatura,
 * bastaria o id de uma fatura vazado para ler a divida de outra pessoa.
 *
 * `findDueForClosingJob` e' a excecao consciente -- o job diario roda sem
 * usuario e sem workspace, e por isso ela tem nome proprio.
 */
export interface InvoiceRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Invoice | null>;
  findViewById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<InvoiceView | null>;

  /** A fatura de um mes de competencia, se ja existir. */
  findByMonth(
    workspaceId: UniqueEntityId,
    creditCardId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<Invoice | null>;

  /**
   * Garante a fatura do mes, criando se necessario.
   *
   * Existe como operacao unica porque duas compras simultaneas no mesmo ciclo
   * disputariam a criacao: com `findByMonth` + `create` separados, uma das duas
   * perderia a corrida e estouraria por violacao de unicidade.
   */
  ensureForMonth(invoice: Invoice): Promise<Invoice>;

  listByCard(
    workspaceId: UniqueEntityId,
    creditCardId: UniqueEntityId,
    options: { months: number; upTo: MonthReference },
  ): Promise<InvoiceView[]>;

  /**
   * Todas as faturas AINDA NAO PAGAS, da mais antiga para a mais nova.
   *
   * Aberta e fechada juntas, de proposito: as duas comprometem limite. Filtrar
   * so as fechadas esconderia a fatura de um ciclo antigo que o fechamento
   * ainda nao processou -- e o limite apareceria livre com a divida de pe.
   */
  listUnpaid(workspaceId: UniqueEntityId, creditCardId: UniqueEntityId): Promise<Invoice[]>;

  items(workspaceId: UniqueEntityId, invoiceId: UniqueEntityId): Promise<InvoiceItemView[]>;

  /** Soma dos itens, direto no banco. O total nunca e' acumulado a mao. */
  sumItems(workspaceId: UniqueEntityId, invoiceId: UniqueEntityId): Promise<number>;

  save(invoice: Invoice): Promise<void>;

  /**
   * Faturas abertas cujo fechamento ja passou, de todos os workspaces.
   *
   * So para o job diario de fechamento.
   */
  findDueForClosingJob(today: CalendarDate, limit: number): Promise<Invoice[]>;

  /** Fechadas, nao pagas e vencendo na data -- para o lembrete. */
  findDueForReminderJob(dueDate: CalendarDate): Promise<Invoice[]>;

  /** O workspace dono da fatura. O job nao tem contexto e precisa descobrir. */
  workspaceOf(invoiceId: UniqueEntityId): Promise<UniqueEntityId | null>;
}

export const INVOICE_REPOSITORY = Symbol('InvoiceRepository');
