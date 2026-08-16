import { z } from 'zod';

import { RecurrenceFrequency, TransactionType } from './enums.js';
import {
  zAmountInCents,
  zBooleanQueryParam,
  zCalendarDate,
  zDayOfMonth,
  zDescription,
  zInstant,
  zNote,
  zShortLabel,
  zUuid,
} from './primitives.js';

/** Ate onde o job materializa ocorrencias a frente. */
export const MATERIALIZATION_WINDOW_DAYS = 60;

/** Teto do lembrete: avisar com mais de 30 dias e' ruido, nao lembrete. */
export const MAX_REMINDER_DAYS_BEFORE = 30;

/**
 * O lancamento que a recorrencia repete.
 *
 * TRANSFER fica de fora: transferencia cria DUAS pernas, e uma recorrencia que
 * gerasse meia transferencia deixaria o saldo errado todo mes (regra 4).
 */
export const recurrenceTemplateSchema = z.object({
  type: z.enum([TransactionType.INCOME, TransactionType.EXPENSE]),
  accountId: zUuid,
  categoryId: zUuid.nullable().default(null),
  amountInCents: zAmountInCents,
  description: zDescription,
  notes: zNote,
});

export type RecurrenceTemplate = z.infer<typeof recurrenceTemplateSchema>;

/**
 * Regra de repeticao.
 *
 * Os campos de periodicidade sao opcionais e mutuamente relevantes: `weekday`
 * so vale para WEEKLY, `dayOfMonth` para MONTHLY/YEARLY, `monthOfYear` so para
 * YEARLY. O `superRefine` abaixo recusa combinacao sem sentido em vez de
 * ignorar o campo em silencio -- "todo dia 10, na terca-feira" e' quase sempre
 * um formulario mal preenchido, e ignorar metade da regra geraria uma serie que
 * o usuario nao pediu.
 *
 * Quando o campo cabe mas nao veio, o servidor deriva de `startDate`.
 */
const scheduleShape = {
  frequency: z.nativeEnum(RecurrenceFrequency),
  interval: z.number().int().min(1).max(52).default(1),
  dayOfMonth: zDayOfMonth.nullable().default(null),
  weekday: z.number().int().min(0, 'Dia da semana invalido (0 = domingo).').max(6).nullable().default(null),
  monthOfYear: z.number().int().min(1).max(12).nullable().default(null),
  startDate: zCalendarDate,
  endDate: zCalendarDate.nullable().default(null),
};

function checkSchedule(
  value: {
    frequency: RecurrenceFrequency;
    dayOfMonth: number | null;
    weekday: number | null;
    monthOfYear: number | null;
    startDate: string;
    endDate: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.endDate !== null && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'A data final precisa ser depois da inicial.',
    });
  }

  if (value.frequency === RecurrenceFrequency.WEEKLY) {
    if (value.dayOfMonth !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayOfMonth'],
        message: 'Repeticao semanal usa dia da semana, nao dia do mes.',
      });
    }

    if (value.monthOfYear !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monthOfYear'],
        message: 'Repeticao semanal nao tem mes.',
      });
    }

    return;
  }

  if (value.weekday !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weekday'],
      message: 'Dia da semana so vale para repeticao semanal.',
    });
  }

  if (value.frequency === RecurrenceFrequency.MONTHLY && value.monthOfYear !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['monthOfYear'],
      message: 'Mes so vale para repeticao anual.',
    });
  }
}

export const createRecurrenceBodySchema = z
  .object({
    name: zShortLabel,
    template: recurrenceTemplateSchema,
    ...scheduleShape,
    /** Nulo = sem lembrete. */
    reminderDaysBefore: z
      .number()
      .int()
      .min(0)
      .max(MAX_REMINDER_DAYS_BEFORE, `O lembrete pode ter no maximo ${MAX_REMINDER_DAYS_BEFORE} dias de antecedencia.`)
      .nullable()
      .default(null),
  })
  .superRefine(checkSchedule);

export type CreateRecurrenceBody = z.infer<typeof createRecurrenceBodySchema>;

/**
 * Edicao.
 *
 * A periodicidade vem inteira ou nao vem: alterar so `dayOfMonth` de uma regra
 * semanal produziria um estado que nenhum dos dois lados sabe interpretar.
 */
export const updateRecurrenceBodySchema = z.object({
  name: zShortLabel.optional(),
  template: recurrenceTemplateSchema.partial().optional(),
  schedule: z.object(scheduleShape).superRefine(checkSchedule).optional(),
  reminderDaysBefore: z.number().int().min(0).max(MAX_REMINDER_DAYS_BEFORE).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateRecurrenceBody = z.infer<typeof updateRecurrenceBodySchema>;

export const listRecurrencesQuerySchema = z.object({
  includeInactive: zBooleanQueryParam(false),
});

export type ListRecurrencesQuery = z.infer<typeof listRecurrencesQuerySchema>;

/** Dispensa uma ocorrencia sem quebrar a serie. */
export const skipOccurrenceBodySchema = z.object({
  occurrenceDate: zCalendarDate,
  reason: z.string().trim().max(255).optional(),
});

export type SkipOccurrenceBody = z.infer<typeof skipOccurrenceBodySchema>;

export const recurrenceOccurrenceSchema = z.object({
  date: zCalendarDate,
  /** Preenchido quando o job ja materializou o lancamento. */
  transactionId: zUuid.nullable(),
  status: z.enum(['SCHEDULED', 'MATERIALIZED', 'SETTLED', 'SKIPPED']),
});

export type RecurrenceOccurrence = z.infer<typeof recurrenceOccurrenceSchema>;

export const recurrenceSchema = z.object({
  id: zUuid,
  name: z.string(),
  template: recurrenceTemplateSchema.extend({
    accountName: z.string(),
    categoryName: z.string().nullable(),
  }),
  frequency: z.nativeEnum(RecurrenceFrequency),
  interval: z.number().int(),
  dayOfMonth: z.number().int().nullable(),
  weekday: z.number().int().nullable(),
  monthOfYear: z.number().int().nullable(),
  startDate: zCalendarDate,
  endDate: zCalendarDate.nullable(),
  reminderDaysBefore: z.number().int().nullable(),
  isActive: z.boolean(),
  /** Proxima ocorrencia a partir de hoje. `null` quando a serie acabou. */
  nextOccurrence: zCalendarDate.nullable(),
  /** Quanto esta serie compromete por mes, normalizado. */
  monthlyAmountInCents: z.number().int(),
  createdAt: zInstant,
});

export type Recurrence = z.infer<typeof recurrenceSchema>;

export const recurrenceListSchema = z.object({
  items: z.array(recurrenceSchema),
  /** Soma normalizada das ativas: o comprometimento mensal do workspace. */
  monthlyCommittedInCents: z.number().int(),
});

export type RecurrenceList = z.infer<typeof recurrenceListSchema>;

/**
 * Quanto uma serie custa por mes, em centavos.
 *
 * Semanal nao e' "4x por mes": um ano tem 52 semanas e 12 meses, entao o fator
 * certo e' 52/12. Usar 4 subestimaria o compromisso anual em quase um mes
 * inteiro de despesa -- e' a conta que faz o total do painel fechar.
 *
 * Divide em centavos inteiros: dinheiro nunca vira float (regra 1).
 */
export function monthlyEquivalentInCents(
  amountInCents: number,
  frequency: RecurrenceFrequency,
  interval: number,
): number {
  const periods = Math.max(1, interval);

  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      return Math.round((amountInCents * 52) / (12 * periods));
    case RecurrenceFrequency.MONTHLY:
      return Math.round(amountInCents / periods);
    case RecurrenceFrequency.YEARLY:
      return Math.round(amountInCents / (12 * periods));
  }
}
