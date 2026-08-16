import {
  type Account,
  type AccountList,
  type Attachment,
  type AttachmentDownload,
  type AuthenticatedUser,
  type CategoryTree,
  type CreateAccountBody,
  type CreateCategoryBody,
  type CreateTransactionBody,
  type CreateTransferBody,
  type Budget,
  type BudgetList,
  type CopyBudgetsBody,
  type CreateBudgetBody,
  type CreateContributionBody,
  type CreateGoalBody,
  type CreateInstallmentPurchaseBody,
  type GoalList,
  type GoalWithContributions,
  type UpdateBudgetBody,
  type UpdateGoalBody,
  type CreateRecurrenceBody,
  type CreditCardList,
  type InstallmentPurchaseResult,
  type Invoice,
  type InvoiceWithItems,
  type PayInvoiceBody,
  type ListNotificationsQuery,
  type ListTransactionsQuery,
  type NotificationList,
  type Recurrence,
  type RecurrenceList,
  type RecurrenceOccurrence,
  type SkipOccurrenceBody,
  type UpdateRecurrenceBody,
  type ReorderCategoriesBody,
  type Transaction,
  type TransactionList,
  type UpdateAccountBody,
  type UpdateCategoryBody,
  type UpdateTransactionBody,
  type CategoriesStepBody,
  type CreditCardsStepBody,
  type FirstAccountStepBody,
  type IncomeStepBody,
  type LoginBody,
  type OnboardingState,
  type RegisterBody,
  type SavingsTargetStepBody,
  type SeedCatalog,
  type Session,
  type UpdateProfileBody,
  type Workspace,
} from '@finapp/contracts';

/**
 * Portas do lado do cliente.
 *
 * Componente nunca chama `fetch`: componente -> hook -> caso de uso -> gateway.
 * A interface fica aqui, na aplicacao; a implementacao HTTP mora em
 * `infra/gateways`. E' o que permite testar um caso de uso do front sem
 * levantar servidor nenhum.
 */

export interface AuthGateway {
  register(body: RegisterBody): Promise<Session>;
  signIn(body: LoginBody): Promise<Session>;
  /** Renova a sessao pelo cookie. Devolve `null` quando nao ha sessao viva. */
  restore(): Promise<Session | null>;
  signOut(): Promise<void>;
  me(): Promise<AuthenticatedUser>;
  updateProfile(body: UpdateProfileBody): Promise<AuthenticatedUser>;
  verifyEmail(token: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: {
    token: string;
    password: string;
    passwordConfirmation: string;
  }): Promise<void>;
}

export interface WorkspaceGateway {
  list(): Promise<Workspace[]>;
}

export interface OnboardingGateway {
  state(workspaceId: string): Promise<OnboardingState>;
  seedCategories(workspaceId: string): Promise<SeedCatalog>;
  saveIncome(workspaceId: string, body: IncomeStepBody): Promise<void>;
  createAccount(workspaceId: string, body: FirstAccountStepBody): Promise<{ id: string }>;
  saveCreditCards(workspaceId: string, body: CreditCardsStepBody): Promise<{ ids: string[] }>;
  saveCategories(workspaceId: string, body: CategoriesStepBody): Promise<void>;
  saveSavingsTarget(workspaceId: string, body: SavingsTargetStepBody): Promise<void>;
  complete(workspaceId: string): Promise<{ completedAt: string }>;
}

export interface AccountGateway {
  list(workspaceId: string, includeArchived?: boolean): Promise<AccountList>;
  create(workspaceId: string, body: CreateAccountBody): Promise<{ id: string }>;
  update(workspaceId: string, id: string, body: UpdateAccountBody): Promise<{ id: string }>;
  archive(workspaceId: string, id: string, archived: boolean): Promise<void>;
  remove(workspaceId: string, id: string): Promise<void>;
}

export interface CategoryGateway {
  tree(workspaceId: string, includeArchived?: boolean): Promise<CategoryTree>;
  create(workspaceId: string, body: CreateCategoryBody): Promise<{ id: string }>;
  update(workspaceId: string, id: string, body: UpdateCategoryBody): Promise<{ id: string }>;
  reorder(workspaceId: string, body: ReorderCategoriesBody): Promise<void>;
  archive(workspaceId: string, id: string, archived: boolean): Promise<void>;
  remove(workspaceId: string, id: string, reassignToId?: string): Promise<{ reassigned: number }>;
}

export interface TransactionGateway {
  list(workspaceId: string, query: Partial<ListTransactionsQuery>): Promise<TransactionList>;
  create(workspaceId: string, body: CreateTransactionBody): Promise<Transaction>;
  transfer(
    workspaceId: string,
    body: CreateTransferBody,
  ): Promise<{ sourceId: string; destinationId: string }>;
  update(workspaceId: string, id: string, body: UpdateTransactionBody): Promise<Transaction>;
  remove(workspaceId: string, id: string): Promise<void>;
}

export type { Account };

export interface AttachmentGateway {
  list(workspaceId: string, transactionId: string): Promise<Attachment[]>;
  upload(
    workspaceId: string,
    transactionId: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<Attachment>;
  downloadUrl(
    workspaceId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload>;
  remove(workspaceId: string, transactionId: string, attachmentId: string): Promise<void>;
}

export interface RecurrenceGateway {
  list(workspaceId: string, includeInactive?: boolean): Promise<RecurrenceList>;
  create(workspaceId: string, body: CreateRecurrenceBody): Promise<Recurrence>;
  update(workspaceId: string, id: string, body: UpdateRecurrenceBody): Promise<Recurrence>;
  remove(workspaceId: string, id: string): Promise<void>;
  occurrences(workspaceId: string, id: string): Promise<RecurrenceOccurrence[]>;
  skip(workspaceId: string, id: string, body: SkipOccurrenceBody): Promise<void>;
}

/**
 * Avisos.
 *
 * Sem `workspaceId` em nenhuma assinatura: a caixa e' do usuario e atravessa os
 * workspaces dele.
 */
export interface NotificationGateway {
  list(query?: Partial<ListNotificationsQuery>): Promise<NotificationList>;
  markRead(ids?: string[]): Promise<{ updated: number; unreadCount: number }>;
}

/**
 * Cartoes e faturas.
 *
 * Nao ha metodo para "comprar no cartao": a compra e' um lancamento comum, e
 * quem decide a fatura e' o servidor (regra 5). So o parcelamento tem forma
 * propria, porque cria N lancamentos em N faturas de uma vez.
 */
export interface CardGateway {
  list(workspaceId: string): Promise<CreditCardList>;
  invoices(workspaceId: string, cardId: string, months?: number): Promise<Invoice[]>;
  invoice(workspaceId: string, invoiceId: string): Promise<InvoiceWithItems>;
  pay(
    workspaceId: string,
    invoiceId: string,
    body: PayInvoiceBody,
  ): Promise<{ transactionId: string }>;
  installments(
    workspaceId: string,
    body: CreateInstallmentPurchaseBody,
  ): Promise<InstallmentPurchaseResult>;
}

export interface BudgetGateway {
  list(workspaceId: string, month?: string): Promise<BudgetList>;
  create(workspaceId: string, body: CreateBudgetBody): Promise<Budget>;
  update(workspaceId: string, id: string, body: UpdateBudgetBody): Promise<void>;
  remove(workspaceId: string, id: string): Promise<void>;
  copy(workspaceId: string, body: CopyBudgetsBody): Promise<{ copied: number }>;
}

export interface GoalGateway {
  list(workspaceId: string, includeArchived?: boolean): Promise<GoalList>;
  get(workspaceId: string, id: string): Promise<GoalWithContributions>;
  create(workspaceId: string, body: CreateGoalBody): Promise<{ id: string }>;
  update(workspaceId: string, id: string, body: UpdateGoalBody): Promise<void>;
  remove(workspaceId: string, id: string): Promise<void>;
  contribute(
    workspaceId: string,
    id: string,
    body: CreateContributionBody,
  ): Promise<{ achieved: boolean }>;
  removeContribution(workspaceId: string, id: string, contributionId: string): Promise<void>;
}
