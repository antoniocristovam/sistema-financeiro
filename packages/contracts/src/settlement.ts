import { z } from 'zod';

import { ShareType, SplitStatus } from './enums.js';
import {
  zAmountInCents,
  zCalendarDate,
  zDisplayName,
  zEmail,
  zInstant,
  zUuid,
} from './primitives.js';

/**
 * Uma linha da divisao, como a tela ve.
 *
 * `amountInCents` e' a parte DESTA pessoa -- nao o valor cheio da despesa. O
 * valor cheio continua no lancamento, e e' ele que mexe no saldo (regra 6).
 */
export const expenseSplitSchema = z.object({
  id: zUuid,
  transactionId: zUuid,
  participantUserId: zUuid.nullable(),
  participantName: z.string(),
  participantEmail: z.string().nullable(),
  shareType: z.nativeEnum(ShareType),
  shareValue: z.number().int().nullable(),
  amountInCents: z.number().int(),
  isOwner: z.boolean(),
  status: z.nativeEnum(SplitStatus),
  settledAt: zInstant.nullable(),
});

export type ExpenseSplit = z.infer<typeof expenseSplitSchema>;

export const transactionSplitsSchema = z.object({
  transactionId: zUuid,
  /** Valor CHEIO da despesa: o que saiu da conta. */
  amountInCents: z.number().int(),
  /** A parte de quem pagou. E' esta que entra em relatorio e orcamento. */
  ownerShareInCents: z.number().int(),
  /** Quanto ainda esta para receber das outras pessoas. */
  outstandingInCents: z.number().int(),
  splits: z.array(expenseSplitSchema),
});

export type TransactionSplits = z.infer<typeof transactionSplitsSchema>;

/**
 * Saldo com uma pessoa.
 *
 * Positivo = ela me deve. Negativo = eu devo a ela. O numero e' LIQUIDO: as
 * despesas que eu paguei menos as que ela pagou, menos o que ja foi acertado.
 * Mostrar duas colunas separadas ("ela me deve X, eu devo Y") faria o usuario
 * fazer a subtracao de cabeca toda vez.
 */
export const splitBalanceSchema = z.object({
  /** Chave estavel da pessoa: id de usuario, ou e-mail/nome de quem nao tem conta. */
  participantKey: z.string(),
  participantUserId: zUuid.nullable(),
  participantName: z.string(),
  participantEmail: z.string().nullable(),
  /** Positivo: recebo. Negativo: pago. */
  netInCents: z.number().int(),
  /** Quanto esta pessoa me deve, antes de compensar. */
  owedToMeInCents: z.number().int(),
  /** Quanto eu devo a ela. */
  owedByMeInCents: z.number().int(),
  pendingSplitCount: z.number().int().nonnegative(),
});

export type SplitBalance = z.infer<typeof splitBalanceSchema>;

export const splitBalanceListSchema = z.object({
  balances: z.array(splitBalanceSchema),
  /** Soma do que tenho a receber (so os positivos). */
  totalToReceiveInCents: z.number().int(),
  /** Soma do que tenho a pagar (so os negativos, em modulo). */
  totalToPayInCents: z.number().int(),
});

export type SplitBalanceList = z.infer<typeof splitBalanceListSchema>;

/**
 * Registro de acerto.
 *
 * `createTransaction` decide se o dinheiro que voltou vira lancamento. Nem
 * sempre vira: quando o acerto acontece em especie ou fora das contas
 * cadastradas, registrar um lancamento inventaria um movimento que a conta
 * nunca viu.
 */
export const createSettlementBodySchema = z
  .object({
    /** Chave da pessoa, como vem do saldo. */
    participantKey: z.string().min(1),
    participantUserId: zUuid.optional(),
    participantName: zDisplayName,
    participantEmail: zEmail.optional(),
    /** Sempre POSITIVO. A direcao vem de `direction`. */
    amountInCents: zAmountInCents,
    /** RECEIVED: recebi dela. PAID: paguei a ela. */
    direction: z.enum(['RECEIVED', 'PAID']),
    date: zCalendarDate.optional(),
    note: z.string().trim().max(255).optional(),
    /** Conta onde o dinheiro entrou ou de onde saiu. */
    accountId: zUuid.optional(),
    createTransaction: z.boolean().default(false),
  })
  .refine((body) => !body.createTransaction || body.accountId !== undefined, {
    message: 'Informe a conta para registrar o lancamento.',
    path: ['accountId'],
  });

export type CreateSettlementBody = z.infer<typeof createSettlementBodySchema>;

export const settlementSchema = z.object({
  id: zUuid,
  fromName: z.string(),
  fromUserId: zUuid.nullable(),
  toName: z.string(),
  toUserId: zUuid.nullable(),
  amountInCents: z.number().int(),
  date: zCalendarDate,
  note: z.string().nullable(),
  transactionId: zUuid.nullable(),
  /** Quantas linhas de divisao este acerto quitou. */
  settledSplitCount: z.number().int().nonnegative(),
  createdAt: zInstant,
});

export type Settlement = z.infer<typeof settlementSchema>;

export const settlementListSchema = z.object({
  items: z.array(settlementSchema),
});

export type SettlementList = z.infer<typeof settlementListSchema>;

/**
 * Chave estavel de um participante.
 *
 * Quem tem conta e' identificado pelo id. Quem nao tem e' identificado pelo
 * e-mail, e so pelo nome quando nem e-mail ha -- nesse caso "Joao" e "joao"
 * sao a mesma pessoa, e essa normalizacao evita dois saldos para o mesmo
 * vizinho.
 */
export function participantKeyOf(participant: {
  participantUserId?: string | null;
  email?: string | null;
  name: string;
}): string {
  if (participant.participantUserId) {
    return `user:${participant.participantUserId}`;
  }

  if (participant.email) {
    return `email:${participant.email.trim().toLowerCase()}`;
  }

  return `name:${participant.name.trim().toLowerCase()}`;
}
