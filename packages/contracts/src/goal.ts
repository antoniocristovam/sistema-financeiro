import { z } from 'zod';

import {
  zAmountInCents,
  zCalendarDate,
  zHexColor,
  zIconName,
  zInstant,
  zMonthReference,
  zShortLabel,
  zUuid,
} from './primitives.js';

export const createGoalBodySchema = z
  .object({
    name: zShortLabel,
    targetAmountInCents: zAmountInCents,
    deadline: zCalendarDate.nullable().default(null),
    icon: zIconName.nullable().default(null),
    color: zHexColor.nullable().default(null),
    /**
     * Conta de reserva.
     *
     * Com ela, o aporte vira uma TRANSFERENCIA de verdade: o dinheiro sai da
     * conta corrente e entra na reserva. Sem ela, o aporte e' so um registro de
     * progresso -- util para meta cujo dinheiro mora fora do app.
     */
    linkedAccountId: zUuid.nullable().default(null),
  })
  .strict();

export type CreateGoalBody = z.infer<typeof createGoalBodySchema>;

export const updateGoalBodySchema = z.object({
  name: zShortLabel.optional(),
  targetAmountInCents: zAmountInCents.optional(),
  deadline: zCalendarDate.nullable().optional(),
  icon: zIconName.nullable().optional(),
  color: zHexColor.nullable().optional(),
  archived: z.boolean().optional(),
});

export type UpdateGoalBody = z.infer<typeof updateGoalBodySchema>;

/**
 * Aporte.
 *
 * `fromAccountId` so e' aceito quando a meta tem conta vinculada -- e' a conta
 * de onde o dinheiro sai. Sem vinculo nao ha transferencia a criar, e aceitar a
 * origem daria a entender que o saldo vai mudar quando ele nao vai.
 */
export const createContributionBodySchema = z.object({
  amountInCents: zAmountInCents,
  date: zCalendarDate.optional(),
  note: z.string().trim().max(255).optional(),
  fromAccountId: zUuid.optional(),
});

export type CreateContributionBody = z.infer<typeof createContributionBodySchema>;

export const goalContributionSchema = z.object({
  id: zUuid,
  amountInCents: z.number().int(),
  date: zCalendarDate,
  note: z.string().nullable(),
  /** Preenchido quando o aporte gerou uma transferencia real. */
  transactionId: zUuid.nullable(),
  createdBy: z.object({ id: zUuid, name: z.string() }),
  createdAt: zInstant,
});

export type GoalContribution = z.infer<typeof goalContributionSchema>;

export const goalSchema = z.object({
  id: zUuid,
  name: z.string(),
  targetAmountInCents: z.number().int(),
  savedInCents: z.number().int(),
  remainingInCents: z.number().int(),
  /** Pontos-base do alvo. 10000 = 100%. */
  basisPoints: z.number().int(),
  deadline: zCalendarDate.nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  linkedAccountId: zUuid.nullable(),
  linkedAccountName: z.string().nullable(),
  achievedAt: zInstant.nullable(),
  archivedAt: zInstant.nullable(),
  /** Media mensal dos ultimos tres meses de aporte. */
  monthlyAverageInCents: z.number().int(),
  /** `null` quando nao ha ritmo: sem aporte nao da para estimar do nada. */
  estimatedCompletion: zMonthReference.nullable(),
  monthsRemaining: z.number().int().nullable(),
  /** Quanto por mes para bater o prazo. `null` quando nao ha prazo. */
  requiredMonthlyInCents: z.number().int().nullable(),
  /** `null` quando nao ha prazo ou nao ha ritmo para comparar. */
  isOnTrack: z.boolean().nullable(),
  contributionCount: z.number().int().nonnegative(),
  createdAt: zInstant,
});

export type Goal = z.infer<typeof goalSchema>;

export const goalWithContributionsSchema = goalSchema.extend({
  contributions: z.array(goalContributionSchema),
});

export type GoalWithContributions = z.infer<typeof goalWithContributionsSchema>;

export const goalListSchema = z.object({
  items: z.array(goalSchema),
  totalTargetInCents: z.number().int(),
  totalSavedInCents: z.number().int(),
});

export type GoalList = z.infer<typeof goalListSchema>;
