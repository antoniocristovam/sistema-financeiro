import { z } from 'zod';

import { AccountType, CategoryType } from './enums.js';
import {
  zBasisPoints,
  zCurrencyCode,
  zDayOfMonth,
  zDisplayName,
  zHexColor,
  zIconName,
  zInstant,
  zNonNegativeCents,
  zSignedCents,
  zUuid,
} from './primitives.js';

/**
 * Wizard de onboarding: 5 passos, retomavel.
 *
 * Cada passo e' salvo assim que o usuario avanca -- fechar o navegador no
 * passo 3 nao perde os dois primeiros. Por isso os passos sao endpoints
 * independentes, e nao um POST gigante no final.
 *
 * Enquanto `completedAt` for nulo, toda navegacao do app volta para o wizard.
 */

export const ONBOARDING_TOTAL_STEPS = 5;

export const OnboardingStep = {
  INCOME: 1,
  FIRST_ACCOUNT: 2,
  CREDIT_CARDS: 3,
  CATEGORIES: 4,
  SAVINGS_TARGET: 5,
} as const;

export type OnboardingStep = (typeof OnboardingStep)[keyof typeof OnboardingStep];

// -- Passo 1: renda -----------------------------------------------------------

export const incomeStepSchema = z.object({
  monthlyIncomeInCents: zNonNegativeCents,
  /** Dia em que o salario cai. Nulo para renda variavel. */
  payday: zDayOfMonth.nullable().default(null),
});

export type IncomeStepBody = z.infer<typeof incomeStepSchema>;

// -- Passo 2: primeira conta --------------------------------------------------

/** Cartao de credito nao entra aqui: ele tem passo proprio, com limite e datas. */
export const firstAccountStepSchema = z.object({
  name: zDisplayName,
  type: z.enum([
    AccountType.CHECKING,
    AccountType.SAVINGS,
    AccountType.CASH,
    AccountType.INVESTMENT,
  ]),
  /** Pode ser negativo: conta no vermelho e' um estado legitimo de abertura. */
  initialBalanceInCents: zSignedCents,
  institution: z.string().trim().max(120).optional(),
  color: zHexColor.optional(),
  icon: zIconName.optional(),
});

export type FirstAccountStepBody = z.infer<typeof firstAccountStepSchema>;

// -- Passo 3: cartoes (opcional) ---------------------------------------------

export const creditCardInputSchema = z
  .object({
    name: zDisplayName,
    limitInCents: zNonNegativeCents,
    closingDay: zDayOfMonth,
    dueDay: zDayOfMonth,
    institution: z.string().trim().max(120).optional(),
    color: zHexColor.optional(),
  })
  .refine((card) => card.closingDay !== card.dueDay, {
    message: 'Fechamento e vencimento nao podem cair no mesmo dia.',
    path: ['dueDay'],
  });

export const creditCardsStepSchema = z.object({
  cards: z.array(creditCardInputSchema).max(10, 'Maximo de 10 cartoes no onboarding.'),
});

export type CreditCardsStepBody = z.infer<typeof creditCardsStepSchema>;

// -- Passo 4: categorias ------------------------------------------------------

/**
 * Chaves das categorias semente escolhidas.
 *
 * Selecionar COPIA a categoria (e as subcategorias dela) para o workspace: a
 * semente do sistema nao e' editavel, e o usuario precisa poder renomear e
 * arquivar as proprias.
 */
export const categoriesStepSchema = z.object({
  systemKeys: z.array(z.string().min(1)).min(1, 'Escolha pelo menos uma categoria.'),
});

export type CategoriesStepBody = z.infer<typeof categoriesStepSchema>;

// -- Passo 5: meta de economia ------------------------------------------------

export const savingsTargetStepSchema = z.object({
  /** Pontos-base: 20% = 2000. Nulo para "nao quero definir agora". */
  savingsTargetPercent: zBasisPoints.nullable().default(null),
});

export type SavingsTargetStepBody = z.infer<typeof savingsTargetStepSchema>;

// -- Estado do wizard ---------------------------------------------------------

export const onboardingAccountSchema = z.object({
  id: zUuid,
  name: z.string(),
  type: z.nativeEnum(AccountType),
  initialBalanceInCents: z.number().int(),
  institution: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  creditCard: z
    .object({
      limitInCents: z.number().int(),
      closingDay: z.number().int(),
      dueDay: z.number().int(),
    })
    .nullable(),
});

export type OnboardingAccount = z.infer<typeof onboardingAccountSchema>;

export const seedCategorySchema = z.object({
  systemKey: z.string(),
  name: z.string(),
  type: z.nativeEnum(CategoryType),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  children: z.array(
    z.object({
      systemKey: z.string(),
      name: z.string(),
    }),
  ),
});

export type SeedCategory = z.infer<typeof seedCategorySchema>;

export const onboardingStateSchema = z.object({
  /** Ultimo passo concluido (0 = nao comecou). */
  completedStep: z.number().int().min(0).max(ONBOARDING_TOTAL_STEPS),
  totalSteps: z.literal(ONBOARDING_TOTAL_STEPS),
  completedAt: zInstant.nullable(),
  workspaceId: zUuid,
  baseCurrency: zCurrencyCode,

  monthlyIncomeInCents: z.number().int(),
  payday: z.number().int().nullable(),
  savingsTargetPercent: z.number().int().nullable(),

  accounts: z.array(onboardingAccountSchema),
  /** Chaves ja copiadas para o workspace. */
  selectedCategoryKeys: z.array(z.string()),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

/** Catalogo de sementes para a tela do passo 4. */
export const seedCatalogSchema = z.object({
  categories: z.array(seedCategorySchema),
});

export type SeedCatalog = z.infer<typeof seedCatalogSchema>;
