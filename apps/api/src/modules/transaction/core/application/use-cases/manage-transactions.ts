import {
  type TransactionStatus,
  type TransactionType,
  TransactionType as Type,
} from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Either, left, right } from '../../../../../shared/either';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { type AttachmentCleaner } from '../ports/attachment-cleaner';
import { type InvoiceRouter } from '../ports/invoice-router';
import { type CategoryRepository } from '../../../../category/core/domain/repositories/category-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { Transaction } from '../../domain/entities/transaction';
import {
  type TransactionPage,
  type TransactionRepository,
  type TransactionView,
} from '../../domain/repositories/transaction-repository';

type TransactionError =
  | AccessError
  | InvalidValueError
  | ResourceNotFoundError
  | ConflictError;

/**
 * Valida conta e categoria DENTRO do workspace.
 *
 * As duas checagens usam repositorios escopados: passar o id de uma conta de
 * outro workspace devolve "nao encontrado", nunca sucesso. E' a barreira contra
 * criar lancamento em conta alheia informando o id na mao.
 */
async function resolveTargets(
  accounts: AccountRepository,
  categories: CategoryRepository,
  workspaceId: UniqueEntityId,
  accountId: UniqueEntityId,
  categoryId: UniqueEntityId | null,
  expectedType: TransactionType,
): Promise<Either<TransactionError, void>> {
  const account = await accounts.findById(workspaceId, accountId);

  if (!account) {
    return left(new ResourceNotFoundError('Conta'));
  }

  if (!account.account.acceptsNewTransactions()) {
    return left(
      new ConflictError('Esta conta esta arquivada e nao aceita lancamentos novos.'),
    );
  }

  if (categoryId) {
    const category = await categories.findById(workspaceId, categoryId);

    if (!category) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    if (category.isArchived()) {
      return left(new ConflictError('Esta categoria esta arquivada.'));
    }

    // Categoria de despesa em uma receita inverteria o sinal no relatorio.
    const expected = expectedType === Type.INCOME ? 'INCOME' : 'EXPENSE';

    if (category.type !== expected) {
      return left(
        new InvalidValueError(
          `Esta categoria e de ${category.type === 'INCOME' ? 'receita' : 'despesa'}.`,
          'categoryId',
        ),
      );
    }
  }

  return right(undefined);
}

// -- Listagem -----------------------------------------------------------------

export interface ListTransactionsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  from?: string;
  to?: string;
  accountId?: UniqueEntityId;
  categoryId?: UniqueEntityId;
  type?: TransactionType;
  status?: TransactionStatus;
  search?: string;
  includeTransfers: boolean;
  cursor?: string;
  limit: number;
}

/**
 * Extrato paginado.
 *
 * Filtrar por categoria-MAE inclui as filhas: e' o drill-down do relatorio, e
 * quem clica em "Alimentacao" espera ver o mercado e o restaurante juntos.
 */
export class ListTransactionsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async execute(input: ListTransactionsInput): Promise<Either<TransactionError, TransactionPage>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    let categoryIds: UniqueEntityId[] | undefined;

    if (input.categoryId) {
      const children = await this.categories.listChildren(input.workspaceId, input.categoryId);
      categoryIds = [input.categoryId, ...children.map((child) => child.id)];
    }

    const from = input.from ? CalendarDate.create(input.from) : undefined;
    const to = input.to ? CalendarDate.create(input.to) : undefined;

    if (from?.isLeft() === true) {
      return left(from.value);
    }

    if (to?.isLeft() === true) {
      return left(to.value);
    }

    const page = await this.transactions.list(
      input.workspaceId,
      {
        ...(from?.isRight() === true ? { from: from.value } : {}),
        ...(to?.isRight() === true ? { to: to.value } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(categoryIds ? { categoryIds } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.search ? { search: input.search } : {}),
        includeTransfers: input.includeTransfers,
      },
      { ...(input.cursor ? { cursor: input.cursor } : {}), limit: input.limit },
    );

    return right(page);
  }
}

// -- Criacao ------------------------------------------------------------------

export interface CreateTransactionInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  type: 'INCOME' | 'EXPENSE';
  accountId: UniqueEntityId;
  categoryId: UniqueEntityId | null;
  amountInCents: number;
  date: string;
  description: string;
  status: TransactionStatus;
  notes?: string;
  counterpartyName?: string;
  counterpartyTaxId?: string;
}

export class CreateTransactionUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly accounts: AccountRepository,
    private readonly categories: CategoryRepository,
    private readonly clock: Clock,
    private readonly invoices: InvoiceRouter,
  ) {}

  async execute(
    input: CreateTransactionInput,
  ): Promise<Either<TransactionError, TransactionView>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const date = CalendarDate.create(input.date);

    if (date.isLeft()) {
      return left(date.value);
    }

    const targets = await resolveTargets(
      this.accounts,
      this.categories,
      input.workspaceId,
      input.accountId,
      input.categoryId,
      input.type,
    );

    if (targets.isLeft()) {
      return left(targets.value);
    }

    const now = this.clock.now();

    const transaction = Transaction.create({
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      createdByUserId: input.userId,
      type: input.type,
      amount: Money.fromCents(input.amountInCents, authorized.value.workspace.baseCurrency),
      date: date.value,
      description: input.description.trim(),
      status: input.status,
      notes: input.notes?.trim() ?? null,
      counterpartyName: input.counterpartyName?.trim() ?? null,
      counterpartyTaxId: input.counterpartyTaxId?.trim() ?? null,
      createdAt: now,
      updatedAt: now,
    });

    if (transaction.isLeft()) {
      return left(transaction.value);
    }

    /*
     * Regra 5: compra no cartao nao debita a conta na data da compra.
     *
     * O roteador devolve a fatura do ciclo -- e `null` quando a conta nao e'
     * cartao, que e' o caminho de toda despesa comum. Sem esta ligacao, a
     * compra apareceria como saida imediata e o usuario veria o dinheiro
     * deixar a conta corrente semanas antes de ele realmente sair.
     */
    const invoiceId = await this.invoices.routeFor(
      input.workspaceId,
      input.accountId,
      date.value,
    );

    if (invoiceId) {
      transaction.value.attachToInvoice(invoiceId);
    }

    await this.transactions.create(transaction.value);

    if (invoiceId) {
      await this.invoices.refresh(input.workspaceId, invoiceId);
    }

    const view = await this.transactions.findViewById(input.workspaceId, transaction.value.id);

    return right(view!);
  }
}

// -- Transferencia ------------------------------------------------------------

export interface CreateTransferInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  fromAccountId: UniqueEntityId;
  toAccountId: UniqueEntityId;
  amountInCents: number;
  date: string;
  description: string;
  notes?: string;
}

/**
 * Transferencia entre contas (regra 4).
 *
 * Gera as DUAS pernas em uma transacao de banco. Meia transferencia -- dinheiro
 * que saiu de uma conta e nao chegou na outra -- e' pior do que transferencia
 * nenhuma: some do saldo e nao aparece em lugar algum.
 *
 * Nenhuma das pernas leva categoria, e as duas ficam fora do relatorio de
 * fluxo: o patrimonio nao mudou, so trocou de bolso.
 */
export class CreateTransferUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly accounts: AccountRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: CreateTransferInput,
  ): Promise<Either<TransactionError, { sourceId: string; destinationId: string }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const date = CalendarDate.create(input.date);

    if (date.isLeft()) {
      return left(date.value);
    }

    for (const accountId of [input.fromAccountId, input.toAccountId]) {
      const account = await this.accounts.findById(input.workspaceId, accountId);

      if (!account) {
        return left(new ResourceNotFoundError('Conta'));
      }

      if (!account.account.acceptsNewTransactions()) {
        return left(new ConflictError('Conta arquivada nao aceita lancamentos novos.'));
      }
    }

    const pair = Transaction.createTransfer({
      workspaceId: input.workspaceId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      createdByUserId: input.userId,
      amount: Money.fromCents(input.amountInCents, authorized.value.workspace.baseCurrency),
      date: date.value,
      description: input.description.trim(),
      notes: input.notes?.trim() ?? null,
    });

    if (pair.isLeft()) {
      return left(pair.value);
    }

    await this.unitOfWork.run(async () => {
      await this.transactions.createMany([pair.value.source, pair.value.destination]);
    });

    return right({
      sourceId: pair.value.source.id.toValue(),
      destinationId: pair.value.destination.id.toValue(),
    });
  }
}

// -- Edicao -------------------------------------------------------------------

export interface UpdateTransactionInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
  categoryId?: UniqueEntityId | null;
  amountInCents?: number;
  date?: string;
  description?: string;
  status?: TransactionStatus;
  notes?: string;
  counterpartyName?: string | null;
  counterpartyTaxId?: string | null;
}

export class UpdateTransactionUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly categories: CategoryRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly invoices: InvoiceRouter,
  ) {}

  async execute(
    input: UpdateTransactionInput,
  ): Promise<Either<TransactionError, TransactionView>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const transaction = await this.transactions.findById(input.workspaceId, input.transactionId);

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    const currency = authorized.value.workspace.baseCurrency;

    if (input.categoryId !== undefined) {
      if (input.categoryId !== null) {
        const category = await this.categories.findById(input.workspaceId, input.categoryId);

        if (!category) {
          return left(new ResourceNotFoundError('Categoria'));
        }

        const expected = transaction.isIncome() ? 'INCOME' : 'EXPENSE';

        if (!transaction.isTransfer() && category.type !== expected) {
          return left(
            new InvalidValueError('Categoria de tipo incompativel com o lancamento.', 'categoryId'),
          );
        }
      }

      const recategorized = transaction.recategorize(input.categoryId);

      if (recategorized.isLeft()) {
        return left(recategorized.value);
      }
    }

    let date: CalendarDate | undefined;

    if (input.date !== undefined) {
      const parsed = CalendarDate.create(input.date);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      date = parsed.value;
    }

    const edited = transaction.edit({
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.amountInCents !== undefined
        ? { amount: Money.fromCents(input.amountInCents, currency) }
        : {}),
      ...(date ? { date } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      ...(input.counterpartyName !== undefined
        ? { counterpartyName: input.counterpartyName }
        : {}),
    });

    if (edited.isLeft()) {
      return left(edited.value);
    }

    if (input.status !== undefined) {
      if (input.status === 'SETTLED') {
        transaction.settle();
      } else {
        transaction.markPending();
      }
    }

    await this.unitOfWork.run(async () => {
      await this.transactions.save(transaction);

      /*
       * Editar uma perna de transferencia atualiza a OUTRA junto.
       *
       * As duas pernas descrevem o mesmo movimento: deixar valores ou datas
       * diferentes faria o dinheiro sumir de uma conta em um dia e aparecer na
       * outra em outro, com valores que nao batem.
       */
      if (transaction.isTransfer() && transaction.transferPairId) {
        const pair = await this.transactions.findPair(
          input.workspaceId,
          transaction.transferPairId,
        );

        for (const leg of pair) {
          if (leg.id.equals(transaction.id)) {
            continue;
          }

          leg.edit({
            ...(input.description !== undefined
              ? { description: input.description.trim() }
              : {}),
            ...(input.amountInCents !== undefined
              ? { amount: Money.fromCents(input.amountInCents, currency) }
              : {}),
            ...(date ? { date } : {}),
          });

          if (input.status !== undefined) {
            if (input.status === 'SETTLED') leg.settle();
            else leg.markPending();
          }

          await this.transactions.save(leg);
        }
      }
    });

    // Mudar o valor de uma compra de cartao muda a fatura. O total e'
    // recalculado a partir dos itens, nunca ajustado pela diferenca.
    if (transaction.invoiceId) {
      await this.invoices.refresh(input.workspaceId, transaction.invoiceId);
    }

    const view = await this.transactions.findViewById(input.workspaceId, transaction.id);

    return right(view!);
  }
}

// -- Exclusao -----------------------------------------------------------------

export interface DeleteTransactionInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Exclusao de lancamento.
 *
 * Duas regras se encontram aqui:
 *
 * - Apagar uma perna de transferencia apaga o PAR: metade de uma transferencia
 *   deixaria uma conta com dinheiro a menos e nenhuma com dinheiro a mais.
 * - **Regra 8**: os comprovantes somem do MinIO junto. O cascade do banco
 *   apaga as LINHAS de anexo, mas o objeto no storage nao tem cascade -- sem
 *   esta limpeza, cada lancamento excluido deixaria um arquivo orfao pagando
 *   armazenamento para sempre.
 */
export class DeleteTransactionUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly attachments: AttachmentCleaner,
    private readonly invoices: InvoiceRouter,
  ) {}

  async execute(input: DeleteTransactionInput): Promise<Either<TransactionError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const transaction = await this.transactions.findById(input.workspaceId, input.transactionId);

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    /*
     * Os objetos saem ANTES da linha da transacao.
     *
     * Depois do delete, o cascade ja levou as linhas de anexo e nao ha mais
     * como descobrir quais chaves existiam -- o arquivo ficaria orfao no
     * storage sem nenhum registro apontando para ele.
     */
    let removedFiles = await this.attachments.purgeForTransaction(
      input.workspaceId,
      input.transactionId,
    );

    // Transferencia: a outra perna pode ter comprovante proprio.
    if (transaction.isTransfer() && transaction.transferPairId) {
      const pair = await this.transactions.findPair(
        input.workspaceId,
        transaction.transferPairId,
      );

      for (const leg of pair) {
        if (!leg.id.equals(transaction.id)) {
          removedFiles += await this.attachments.purgeForTransaction(
            input.workspaceId,
            leg.id,
          );
        }
      }
    }

    await this.unitOfWork.run(async () => {
      if (transaction.isTransfer() && transaction.transferPairId) {
        await this.transactions.deleteTransferPair(
          input.workspaceId,
          transaction.transferPairId,
        );
        return;
      }

      await this.transactions.delete(input.workspaceId, input.transactionId);
    });

    /*
     * Excluir uma compra encolhe a fatura.
     *
     * Fora da transacao de banco de proposito: a linha ja sumiu, e o total e'
     * derivado dos itens restantes. Se este recalculo falhar, a proxima compra
     * ou o fechamento corrigem -- o inverso (recalcular dentro e falhar depois)
     * deixaria a fatura contando um item que nao existe mais.
     */
    if (transaction.invoiceId) {
      await this.invoices.refresh(input.workspaceId, transaction.invoiceId);
    }

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.userId.toValue(),
      action: 'TRANSACTION_DELETED',
      entityType: 'Transaction',
      entityId: input.transactionId.toValue(),
      metadata: {
        description: transaction.description,
        amountInCents: transaction.amount.toCents(),
        wasTransfer: transaction.isTransfer(),
        removedFiles,
      },
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}
