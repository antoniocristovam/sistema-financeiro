import { z } from 'zod';

import { InvoiceStatus } from './enums.js';
import {
  zAmountInCents,
  zCalendarDate,
  zDescription,
  zInstant,
  zMonthReference,
  zNote,
  zUuid,
} from './primitives.js';

/** Teto de parcelas. Acima disso e' financiamento, nao compra parcelada. */
export const MAX_INSTALLMENTS = 48;

export const invoiceItemSchema = z.object({
  id: zUuid,
  date: zCalendarDate,
  description: z.string(),
  amountInCents: z.number().int(),
  category: z
    .object({ id: zUuid, name: z.string(), icon: z.string().nullable(), color: z.string().nullable() })
    .nullable(),
  /** Preenchidos so quando o item faz parte de uma compra parcelada. */
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
});

export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z.object({
  id: zUuid,
  creditCardId: zUuid,
  cardName: z.string(),
  referenceMonth: zMonthReference,
  closingDate: zCalendarDate,
  dueDate: zCalendarDate,
  totalInCents: z.number().int(),
  status: z.nativeEnum(InvoiceStatus),
  /** `true` quando fechada, nao paga e ja passou do vencimento. */
  isOverdue: z.boolean(),
  paidAt: zInstant.nullable(),
  /** O lancamento que de fato debitou a conta corrente. */
  paidWithTransactionId: zUuid.nullable(),
  itemCount: z.number().int().nonnegative(),
});

export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceWithItemsSchema = invoiceSchema.extend({
  items: z.array(invoiceItemSchema),
});

export type InvoiceWithItems = z.infer<typeof invoiceWithItemsSchema>;

export const listInvoicesQuerySchema = z.object({
  /** Quantos ciclos trazer, do mais recente para tras. */
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/**
 * Pagamento da fatura.
 *
 * O valor NAO vem do cliente: e' o total da fatura fechada. Aceitar um valor
 * arbitrario aqui abriria espaco para o pagamento nao bater com a divida e o
 * saldo do cartao ficar eternamente errado. Pagamento parcial e' outro
 * problema, com nome proprio, e nao cabe neste corpo.
 */
export const payInvoiceBodySchema = z.object({
  /** Conta de onde o dinheiro sai. Nunca o proprio cartao. */
  fromAccountId: zUuid,
  /** Quando o pagamento aconteceu. Ausente = hoje. */
  date: zCalendarDate.optional(),
  notes: zNote,
});

export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;

/**
 * Compra parcelada no cartao.
 *
 * O valor informado e' o TOTAL da compra, nao o da parcela -- e' o numero que
 * aparece na maquininha e o que o usuario lembra. As parcelas sao derivadas com
 * distribuicao de centavos: R$ 100,00 em 3x vira 33,34 / 33,33 / 33,33, e a
 * soma fecha exatamente com o total.
 */
export const createInstallmentPurchaseBodySchema = z.object({
  cardAccountId: zUuid,
  categoryId: zUuid.nullable().default(null),
  totalAmountInCents: zAmountInCents,
  installments: z.number().int().min(2, 'Parcelamento comeca em 2x.').max(MAX_INSTALLMENTS),
  /** Data da COMPRA. E' ela que decide em qual fatura a 1a parcela cai. */
  date: zCalendarDate,
  description: zDescription,
  notes: zNote,
});

export type CreateInstallmentPurchaseBody = z.infer<typeof createInstallmentPurchaseBodySchema>;

export const installmentPurchaseResultSchema = z.object({
  installmentGroupId: zUuid,
  installments: z.array(
    z.object({
      transactionId: zUuid,
      number: z.number().int(),
      amountInCents: z.number().int(),
      date: zCalendarDate,
      invoiceMonth: zMonthReference,
    }),
  ),
});

export type InstallmentPurchaseResult = z.infer<typeof installmentPurchaseResultSchema>;

/** Resumo do cartao para a tela de cartoes. */
export const creditCardSummarySchema = z.object({
  accountId: zUuid,
  name: z.string(),
  color: z.string().nullable(),
  limitInCents: z.number().int(),
  closingDay: z.number().int(),
  dueDay: z.number().int(),
  /** Fatura que ainda recebe compras. `null` se o cartao nunca foi usado. */
  openInvoice: invoiceSchema.nullable(),
  /** Fechadas e nao pagas, da mais antiga para a mais nova. */
  unpaidInvoices: z.array(invoiceSchema),
  /**
   * Limite comprometido: fatura aberta + fechadas nao pagas.
   *
   * A fatura paga sai da conta -- o limite volta. E' por isso que o numero nao
   * e' simplesmente "a soma de tudo que ja passou no cartao".
   */
  usedLimitInCents: z.number().int(),
  availableLimitInCents: z.number().int(),
});

export type CreditCardSummary = z.infer<typeof creditCardSummarySchema>;

export const creditCardListSchema = z.object({
  cards: z.array(creditCardSummarySchema),
  totalUsedInCents: z.number().int(),
  totalLimitInCents: z.number().int(),
});

export type CreditCardList = z.infer<typeof creditCardListSchema>;

/**
 * Parcelas de um valor total, em centavos inteiros.
 *
 * O resto e' distribuido nas PRIMEIRAS parcelas, que e' a convencao das
 * maquininhas brasileiras: R$ 100,00 em 3x vira 33,34 / 33,33 / 33,33. Somar
 * 33,33 tres vezes daria R$ 99,99 -- um centavo que some, e que reaparece como
 * divergencia entre a fatura do banco e a do app.
 */
export function splitInstallments(totalInCents: number, installments: number): number[] {
  const base = Math.floor(totalInCents / installments);
  const remainder = totalInCents - base * installments;

  return Array.from({ length: installments }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}
