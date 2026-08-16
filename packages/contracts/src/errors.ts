import { z } from 'zod';

/**
 * Envelope de erro da API.
 *
 * Codigo estavel + mensagem legivel + detalhes por campo. O front decide o que
 * fazer pelo CODIGO, nunca pela mensagem -- mensagem muda com tradução, codigo
 * nao.
 */

export const ApiErrorCode = {
  // 400
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  // 401
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSED: 'TOKEN_REUSED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  // 403
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  NOT_WORKSPACE_MEMBER: 'NOT_WORKSPACE_MEMBER',
  ONBOARDING_REQUIRED: 'ONBOARDING_REQUIRED',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  // 409
  EMAIL_ALREADY_USED: 'EMAIL_ALREADY_USED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  // 422 - regras de negocio
  SPLIT_DOES_NOT_CLOSE: 'SPLIT_DOES_NOT_CLOSE',
  CATEGORY_DEPTH_EXCEEDED: 'CATEGORY_DEPTH_EXCEEDED',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  ACCOUNT_IN_USE: 'ACCOUNT_IN_USE',
  LAST_OWNER: 'LAST_OWNER',
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  IMPORT_ALREADY_COMMITTED: 'IMPORT_ALREADY_COMMITTED',
  IMPORT_NOT_REVERTIBLE: 'IMPORT_NOT_REVERTIBLE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  // 500
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** Um problema em um campo especifico do corpo enviado. */
export const fieldIssueSchema = z.object({
  /** Caminho do campo: `['participants', 0, 'shareValue']`. */
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export type FieldIssue = z.infer<typeof fieldIssueSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** Preenchido quando `code` e' VALIDATION_FAILED. */
  issues: z.array(fieldIssueSchema).optional(),
  /** Correlaciona com o log do servidor. */
  traceId: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
