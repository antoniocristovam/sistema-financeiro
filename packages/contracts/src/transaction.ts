import { z } from 'zod';

import { TransactionStatus, TransactionType, TransferLeg } from './enums.js';
import { cursorPaginationQuerySchema } from './pagination.js';
import {
  zAmountInCents,
  zBooleanQueryParam,
  zCalendarDate,
  zDescription,
  zInstant,
  zNote,
  zUuid,
} from './primitives.js';

/**
 * Criacao de receita ou despesa.
 *
 * TRANSFER nao entra aqui: ela tem endpoint proprio, porque cria DUAS pernas de
 * uma vez. Aceitar `type: TRANSFER` neste corpo abriria a porta para meia
 * transferencia -- dinheiro que saiu de uma conta e nao chegou em lugar nenhum.
 */
export const createTransactionBodySchema = z.object({
  type: z.enum([TransactionType.INCOME, TransactionType.EXPENSE]),
  accountId: zUuid,
  categoryId: zUuid.nullable().default(null),
  /** Sempre POSITIVO. O sinal vem do `type`. */
  amountInCents: zAmountInCents,
  date: zCalendarDate,
  description: zDescription,
  status: z.nativeEnum(TransactionStatus).default(TransactionStatus.SETTLED),
  notes: zNote,
  counterpartyName: z.string().trim().max(160).optional(),
  counterpartyTaxId: z.string().trim().max(20).optional(),
});

export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;

/** Transferencia entre contas: gera as duas pernas em uma transacao de banco. */
export const createTransferBodySchema = z
  .object({
    fromAccountId: zUuid,
    toAccountId: zUuid,
    amountInCents: zAmountInCents,
    date: zCalendarDate,
    description: zDescription,
    notes: zNote,
  })
  .refine((body) => body.fromAccountId !== body.toAccountId, {
    message: 'A conta de origem e a de destino precisam ser diferentes.',
    path: ['toAccountId'],
  });

export type CreateTransferBody = z.infer<typeof createTransferBodySchema>;

export const updateTransactionBodySchema = z.object({
  categoryId: zUuid.nullable().optional(),
  amountInCents: zAmountInCents.optional(),
  date: zCalendarDate.optional(),
  description: zDescription.optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  notes: zNote,
  counterpartyName: z.string().trim().max(160).nullable().optional(),
  counterpartyTaxId: z.string().trim().max(20).nullable().optional(),
});

export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

/** Filtros do extrato. */
export const listTransactionsQuerySchema = cursorPaginationQuerySchema.extend({
  from: zCalendarDate.optional(),
  to: zCalendarDate.optional(),
  accountId: zUuid.optional(),
  /** Categoria-mae ja inclui as filhas: e' o drill-down do relatorio. */
  categoryId: zUuid.optional(),
  type: z.nativeEnum(TransactionType).optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  /** Busca por descricao. */
  search: z.string().trim().max(120).optional(),
  /**
   * Inclui as duas pernas das transferencias.
   *
   * Padrao FALSE nas telas de fluxo: transferencia nao e' receita nem despesa
   * (regra 4), e mostra-la no meio do extrato de gastos faz o usuario achar
   * que gastou o dobro.
   */
  includeTransfers: zBooleanQueryParam(true),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionSchema = z.object({
  id: zUuid,
  type: z.nativeEnum(TransactionType),
  amountInCents: z.number().int(),
  /** Efeito no saldo: negativo sai, positivo entra. */
  signedAmountInCents: z.number().int(),
  date: zCalendarDate,
  description: z.string(),
  status: z.nativeEnum(TransactionStatus),
  notes: z.string().nullable(),
  counterpartyName: z.string().nullable(),

  account: z.object({ id: zUuid, name: z.string(), color: z.string().nullable() }),
  category: z
    .object({
      id: zUuid,
      name: z.string(),
      icon: z.string().nullable(),
      color: z.string().nullable(),
      parentName: z.string().nullable(),
    })
    .nullable(),

  /** Quem lancou. Aparece na listagem de workspace compartilhado. */
  createdBy: z.object({ id: zUuid, name: z.string() }),

  transferLeg: z.nativeEnum(TransferLeg).nullable(),
  transferPairId: zUuid.nullable(),
  /** Conta do outro lado da transferencia. */
  transferCounterpartAccount: z.object({ id: zUuid, name: z.string() }).nullable(),

  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  recurrenceId: zUuid.nullable(),
  invoiceId: zUuid.nullable(),
  /** Quantos comprovantes o lancamento tem. Alimenta o clipe na listagem. */
  attachmentCount: z.number().int().nonnegative(),

  createdAt: zInstant,
});

export type Transaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
  /**
   * Totais do periodo FILTRADO, nao da pagina.
   *
   * Transferencia fica fora dos dois: ela nao e' entrada nem saida de
   * patrimonio, so troca de bolso (regra 4).
   */
  summary: z.object({
    incomeInCents: z.number().int(),
    expenseInCents: z.number().int(),
    netInCents: z.number().int(),
  }),
});

export type TransactionList = z.infer<typeof transactionListSchema>;
