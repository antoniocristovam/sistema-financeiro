/**
 * Enums compartilhados entre API e web.
 *
 * Espelham 1:1 os enums do schema Prisma (`apps/api/prisma/schema.prisma`).
 * Sao `as const` + tipo derivado, e nao `enum` do TypeScript, porque enum de TS
 * gera runtime proprio e nao e' estruturalmente compativel com o enum gerado
 * pelo Prisma Client.
 */

export const WorkspaceType = { PERSONAL: 'PERSONAL', SHARED: 'SHARED' } as const;
export type WorkspaceType = (typeof WorkspaceType)[keyof typeof WorkspaceType];

export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const Theme = { LIGHT: 'LIGHT', DARK: 'DARK', SYSTEM: 'SYSTEM' } as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

export const Locale = { PT_BR: 'PT_BR', EN_US: 'EN_US' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

/** Mapa do enum Locale para a tag BCP-47 usada no `Intl`. */
export const LOCALE_TAG: Record<Locale, string> = {
  PT_BR: 'pt-BR',
  EN_US: 'en-US',
};

export const AccountType = {
  CHECKING: 'CHECKING',
  SAVINGS: 'SAVINGS',
  CASH: 'CASH',
  CREDIT_CARD: 'CREDIT_CARD',
  INVESTMENT: 'INVESTMENT',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const CategoryType = { INCOME: 'INCOME', EXPENSE: 'EXPENSE' } as const;
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType];

export const TransactionType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  TRANSFER: 'TRANSFER',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const TransactionStatus = { PENDING: 'PENDING', SETTLED: 'SETTLED' } as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

/** Perna de uma transferencia: SOURCE debita, DESTINATION credita. */
export const TransferLeg = { SOURCE: 'SOURCE', DESTINATION: 'DESTINATION' } as const;
export type TransferLeg = (typeof TransferLeg)[keyof typeof TransferLeg];

export const RecurrenceFrequency = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const;
export type RecurrenceFrequency = (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];

/** Escopo de edicao de uma serie recorrente. */
export const RecurrenceEditScope = {
  THIS_ONE: 'THIS_ONE',
  THIS_AND_FOLLOWING: 'THIS_AND_FOLLOWING',
  ALL: 'ALL',
} as const;
export type RecurrenceEditScope = (typeof RecurrenceEditScope)[keyof typeof RecurrenceEditScope];

export const InvoiceStatus = { OPEN: 'OPEN', CLOSED: 'CLOSED', PAID: 'PAID' } as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const ShareType = { EQUAL: 'EQUAL', PERCENT: 'PERCENT', FIXED: 'FIXED' } as const;
export type ShareType = (typeof ShareType)[keyof typeof ShareType];

export const SplitStatus = { PENDING: 'PENDING', SETTLED: 'SETTLED' } as const;
export type SplitStatus = (typeof SplitStatus)[keyof typeof SplitStatus];

export const ImportSource = { OFX: 'OFX', CSV: 'CSV' } as const;
export type ImportSource = (typeof ImportSource)[keyof typeof ImportSource];

export const ImportBatchStatus = {
  STAGED: 'STAGED',
  REVIEWING: 'REVIEWING',
  COMMITTED: 'COMMITTED',
  DISCARDED: 'DISCARDED',
  REVERTED: 'REVERTED',
} as const;
export type ImportBatchStatus = (typeof ImportBatchStatus)[keyof typeof ImportBatchStatus];

export const MatchStatus = {
  NEW: 'NEW',
  DUPLICATE: 'DUPLICATE',
  SIMILAR: 'SIMILAR',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

export const ImportDecision = { IMPORT: 'IMPORT', SKIP: 'SKIP', MERGE: 'MERGE' } as const;
export type ImportDecision = (typeof ImportDecision)[keyof typeof ImportDecision];

export const ExportFormat = { CSV: 'CSV', XLSX: 'XLSX', PDF: 'PDF' } as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const ExportJobStatus = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type ExportJobStatus = (typeof ExportJobStatus)[keyof typeof ExportJobStatus];

export const ReportType = {
  TRANSACTIONS: 'TRANSACTIONS',
  CATEGORY_SUMMARY: 'CATEGORY_SUMMARY',
  CASH_FLOW: 'CASH_FLOW',
  BUDGET_PERFORMANCE: 'BUDGET_PERFORMANCE',
  ANNUAL_TAX: 'ANNUAL_TAX',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];

export const NotificationType = {
  BUDGET_THRESHOLD_REACHED: 'BUDGET_THRESHOLD_REACHED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RECURRENCE_DUE_SOON: 'RECURRENCE_DUE_SOON',
  RECURRENCE_AMOUNT_DRIFT: 'RECURRENCE_AMOUNT_DRIFT',
  INVOICE_CLOSING: 'INVOICE_CLOSING',
  INVOICE_DUE: 'INVOICE_DUE',
  GOAL_REACHED: 'GOAL_REACHED',
  GOAL_OFF_TRACK: 'GOAL_OFF_TRACK',
  SPLIT_ASSIGNED: 'SPLIT_ASSIGNED',
  SETTLEMENT_RECORDED: 'SETTLEMENT_RECORDED',
  WORKSPACE_INVITATION: 'WORKSPACE_INVITATION',
  IMPORT_READY_FOR_REVIEW: 'IMPORT_READY_FOR_REVIEW',
  EXPORT_READY: 'EXPORT_READY',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const AuditAction = {
  MEMBER_INVITED: 'MEMBER_INVITED',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
  OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  WORKSPACE_DELETED: 'WORKSPACE_DELETED',
  ACCOUNT_ARCHIVED: 'ACCOUNT_ARCHIVED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  CATEGORY_DELETED: 'CATEGORY_DELETED',
  TRANSACTION_DELETED: 'TRANSACTION_DELETED',
  IMPORT_COMMITTED: 'IMPORT_COMMITTED',
  IMPORT_REVERTED: 'IMPORT_REVERTED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const TaxIncomeNature = {
  TRIBUTAVEL: 'TRIBUTAVEL',
  ISENTO: 'ISENTO',
  EXCLUSIVA: 'EXCLUSIVA',
} as const;
export type TaxIncomeNature = (typeof TaxIncomeNature)[keyof typeof TaxIncomeNature];

export const UserTokenType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;
export type UserTokenType = (typeof UserTokenType)[keyof typeof UserTokenType];

/**
 * Matriz de permissoes por papel.
 *
 * Mora em `contracts` porque a UI precisa esconder o que o papel nao pode fazer,
 * mas a decisao que vale e' a do caso de uso no backend. O front usa isso para
 * ergonomia, nunca como barreira de seguranca.
 */
export const WORKSPACE_PERMISSIONS = {
  'data:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'transaction:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'account:manage': ['OWNER', 'ADMIN'],
  'category:manage': ['OWNER', 'ADMIN'],
  'member:manage': ['OWNER', 'ADMIN'],
  'workspace:delete': ['OWNER'],
  'workspace:transfer-ownership': ['OWNER'],
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export type WorkspacePermission = keyof typeof WORKSPACE_PERMISSIONS;

export function roleHasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return (WORKSPACE_PERMISSIONS[permission] as readonly WorkspaceRole[]).includes(role);
}
