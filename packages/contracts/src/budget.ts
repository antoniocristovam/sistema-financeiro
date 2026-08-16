import { z } from 'zod';

import {
  zAmountInCents,
  zBooleanQueryParam,
  zMonthReference,
  zUuid,
} from './primitives.js';

/** Limiares que geram aviso, uma vez cada, por mes. */
export const BUDGET_ALERT_THRESHOLDS = [80, 100] as const;

export const budgetBandSchema = z.enum(['OK', 'NEAR', 'OVER']);
export type BudgetBand = z.infer<typeof budgetBandSchema>;

export const createBudgetBodySchema = z.object({
  categoryId: zUuid,
  referenceMonth: zMonthReference,
  limitInCents: zAmountInCents,
  /** Sobra do mes anterior soma ao limite deste mes. */
  rollover: z.boolean().default(false),
});

export type CreateBudgetBody = z.infer<typeof createBudgetBodySchema>;

export const updateBudgetBodySchema = z.object({
  limitInCents: zAmountInCents.optional(),
  rollover: z.boolean().optional(),
});

export type UpdateBudgetBody = z.infer<typeof updateBudgetBodySchema>;

export const listBudgetsQuerySchema = z.object({
  /** Ausente = mes corrente. */
  month: zMonthReference.optional(),
});

export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;

/** Copia os orcamentos de um mes para outro. */
export const copyBudgetsBodySchema = z
  .object({
    from: zMonthReference,
    to: zMonthReference,
    /** Sobrescreve os limites que ja existirem no destino. */
    overwrite: z.boolean().default(false),
  })
  .refine((body) => body.from !== body.to, {
    message: 'Escolha meses diferentes.',
    path: ['to'],
  });

export type CopyBudgetsBody = z.infer<typeof copyBudgetsBodySchema>;

export const budgetSchema = z.object({
  id: zUuid,
  category: z.object({
    id: zUuid,
    name: z.string(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    parentName: z.string().nullable(),
  }),
  referenceMonth: zMonthReference,
  limitInCents: z.number().int(),
  rollover: z.boolean(),
  /** Sobra herdada do mes anterior. Zero quando `rollover` esta desligado. */
  carryOverInCents: z.number().int(),
  /** Limite + sobra herdada. E' contra ele que o consumo e' medido. */
  effectiveLimitInCents: z.number().int(),
  /**
   * Quanto ja foi gasto.
   *
   * Em despesa dividida e' a MINHA PARTE, nunca o valor cheio (regra 6): o
   * valor cheio saiu da conta e afeta o saldo, mas o orcamento mede o que e'
   * meu.
   */
  consumedInCents: z.number().int(),
  remainingInCents: z.number().int(),
  /** Truncado para baixo: 79,9% e' 79%, e nao dispara o alerta de 80%. */
  percent: z.number().int(),
  band: budgetBandSchema,
});

export type Budget = z.infer<typeof budgetSchema>;

export const budgetListSchema = z.object({
  referenceMonth: zMonthReference,
  items: z.array(budgetSchema),
  totalLimitInCents: z.number().int(),
  totalConsumedInCents: z.number().int(),
  /**
   * Gasto do mes FORA de qualquer orcamento.
   *
   * Sem este numero, um usuario com tres orcamentos em dia acharia que esta
   * indo bem enquanto gasta sem controle em todas as outras categorias.
   */
  unbudgetedInCents: z.number().int(),
});

export type BudgetList = z.infer<typeof budgetListSchema>;

export const listGoalsQuerySchema = z.object({
  includeArchived: zBooleanQueryParam(false),
});

export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;
