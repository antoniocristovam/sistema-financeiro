import { z } from 'zod';

import { AccountType } from './enums.js';
import {
  zDayOfMonth,
  zDisplayName,
  zHexColor,
  zIconName,
  zInstant,
  zNonNegativeCents,
  zSignedCents,
  zUuid,
} from './primitives.js';

/** Ciclo do cartao. So aparece quando o tipo e' CREDIT_CARD. */
export const creditCardDetailsSchema = z
  .object({
    limitInCents: zNonNegativeCents,
    closingDay: zDayOfMonth,
    dueDay: zDayOfMonth,
  })
  .refine((card) => card.closingDay !== card.dueDay, {
    message: 'Fechamento e vencimento nao podem cair no mesmo dia.',
    path: ['dueDay'],
  });

export const createAccountBodySchema = z
  .object({
    name: zDisplayName,
    type: z.nativeEnum(AccountType),
    /** Negativo e' valido: conta no vermelho na abertura. */
    initialBalanceInCents: zSignedCents.default(0),
    institution: z.string().trim().max(120).optional(),
    color: zHexColor.optional(),
    icon: zIconName.optional(),
    creditCard: creditCardDetailsSchema.optional(),
  })
  .superRefine((body, ctx) => {
    // O ciclo e' o que define em que fatura a compra cai (regra 5). Sem ele,
    // um cartao nao tem como saber quando fecha.
    if (body.type === AccountType.CREDIT_CARD && !body.creditCard) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creditCard'],
        message: 'Informe limite, fechamento e vencimento do cartao.',
      });
    }

    if (body.type !== AccountType.CREDIT_CARD && body.creditCard) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creditCard'],
        message: 'So conta do tipo cartao de credito tem ciclo de fatura.',
      });
    }
  });

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

/** O TIPO nao entra: mudar de conta corrente para cartao mudaria a semantica
 * de todo lancamento ja gravado nela. */
export const updateAccountBodySchema = z.object({
  name: zDisplayName.optional(),
  institution: z.string().trim().max(120).nullable().optional(),
  color: zHexColor.nullable().optional(),
  icon: zIconName.nullable().optional(),
  initialBalanceInCents: zSignedCents.optional(),
  creditCard: creditCardDetailsSchema.optional(),
});

export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const accountSchema = z.object({
  id: zUuid,
  name: z.string(),
  type: z.nativeEnum(AccountType),
  initialBalanceInCents: z.number().int(),
  /** Abertura + lancamentos LIQUIDADOS. */
  balanceInCents: z.number().int(),
  /** Inclui os pendentes. E' o "quanto vai sobrar se nada mudar". */
  projectedBalanceInCents: z.number().int(),
  institution: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  archivedAt: zInstant.nullable(),
  transactionCount: z.number().int().nonnegative(),
  creditCard: z
    .object({
      limitInCents: z.number().int(),
      closingDay: z.number().int(),
      dueDay: z.number().int(),
    })
    .nullable(),
  createdAt: zInstant,
});

export type Account = z.infer<typeof accountSchema>;

export const accountListSchema = z.object({
  accounts: z.array(accountSchema),
  /** Soma dos saldos, ignorando cartoes -- divida de cartao nao e' patrimonio. */
  totalBalanceInCents: z.number().int(),
});

export type AccountList = z.infer<typeof accountListSchema>;
