import { z } from 'zod';

import { Locale, Theme } from './enums.js';
import {
  zCurrencyCode,
  zDisplayName,
  zEmail,
  zInstant,
  zPassword,
  zUuid,
} from './primitives.js';

/**
 * Contrato de autenticacao.
 *
 * O refresh token NAO aparece em nenhum schema de resposta de proposito: ele
 * trafega em cookie `httpOnly` `sameSite=strict`, fora do alcance do JavaScript.
 * Se ele aparecesse aqui, alguem acabaria guardando no localStorage.
 */

// -- Requests ----------------------------------------------------------------

export const registerBodySchema = z.object({
  name: zDisplayName,
  email: zEmail,
  password: zPassword,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: zEmail,
  password: z.string().min(1, 'Informe a senha.'),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: zEmail,
});

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z
  .object({
    token: z.string().min(1),
    password: zPassword,
    passwordConfirmation: z.string(),
  })
  .refine((body) => body.password === body.passwordConfirmation, {
    message: 'As senhas nao conferem.',
    path: ['passwordConfirmation'],
  });

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const verifyEmailBodySchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    password: zPassword,
    passwordConfirmation: z.string(),
  })
  .refine((body) => body.password === body.passwordConfirmation, {
    message: 'As senhas nao conferem.',
    path: ['passwordConfirmation'],
  })
  .refine((body) => body.password !== body.currentPassword, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['password'],
  });

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

// -- Responses ---------------------------------------------------------------

/**
 * So o access token volta no corpo. Vida curta (15 min) e guardado apenas em
 * memoria no cliente.
 */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authenticatedUserSchema = z.object({
  id: zUuid,
  name: z.string(),
  email: z.string().email(),
  locale: z.nativeEnum(Locale),
  currency: zCurrencyCode,
  theme: z.nativeEnum(Theme),
  emailVerifiedAt: zInstant.nullable(),
  /** Enquanto for nulo, toda navegacao redireciona para o wizard. */
  onboardingCompletedAt: zInstant.nullable(),
  /** Workspace pessoal, criado junto com a conta. */
  personalWorkspaceId: zUuid,
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const sessionSchema = z.object({
  user: authenticatedUserSchema,
  tokens: authTokensSchema,
});

export type Session = z.infer<typeof sessionSchema>;

export const updateProfileBodySchema = z.object({
  name: zDisplayName.optional(),
  locale: z.nativeEnum(Locale).optional(),
  theme: z.nativeEnum(Theme).optional(),
  currency: zCurrencyCode.optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
