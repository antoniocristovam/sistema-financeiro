import { type TransactionStatus, type TransactionType } from '@finapp/contracts';

import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Transaction } from '../entities/transaction';

export interface TransactionFilters {
  from?: CalendarDate;
  to?: CalendarDate;
  accountId?: UniqueEntityId;
  /** Categoria-mae inclui as filhas: e' o drill-down do relatorio. */
  categoryIds?: UniqueEntityId[];
  type?: TransactionType;
  status?: TransactionStatus;
  search?: string;
  includeTransfers?: boolean;
}

/** Dados de exibicao que acompanham o lancamento na listagem. */
export interface TransactionView {
  transaction: Transaction;
  account: { id: string; name: string; color: string | null };
  category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    parentName: string | null;
  } | null;
  createdBy: { id: string; name: string };
  transferCounterpartAccount: { id: string; name: string } | null;
  installmentTotal: number | null;
  attachmentCount: number;
  splitCount: number;
  /** A parte do dono. Igual ao valor cheio quando nao ha divisao (regra 6). */
  ownerShareInCents: number;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
  summary: { incomeInCents: number; expenseInCents: number; netInCents: number };
}

/** Saldo derivado de uma conta. Nunca materializado. */
export interface AccountBalance {
  accountId: string;
  /** So os lancamentos LIQUIDADOS. */
  settledInCents: number;
  /** Inclui os pendentes. */
  projectedInCents: number;
  transactionCount: number;
}

/**
 * Porta do repositorio de lancamentos.
 *
 * Toda assinatura recebe `workspaceId` -- inclusive as que ja tem o id unico do
 * lancamento. Nao existe `findById(id)` sem escopo: essa ausencia e' a barreira
 * contra IDOR, e ela e' de TIPO, entao esquecer o filtro nao compila.
 */
export interface TransactionRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Transaction | null>;
  findViewById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<TransactionView | null>;
  /** As duas pernas de uma transferencia. */
  findPair(workspaceId: UniqueEntityId, transferPairId: UniqueEntityId): Promise<Transaction[]>;

  list(
    workspaceId: UniqueEntityId,
    filters: TransactionFilters,
    pagination: { cursor?: string; limit: number },
  ): Promise<TransactionPage>;

  create(transaction: Transaction): Promise<void>;
  /**
   * Cria, ou nao faz nada se a ocorrencia ja existe.
   *
   * Devolve `true` so quando gravou. E' o que torna a materializacao das contas
   * fixas idempotente: a decisao fica com o indice unico
   * `(recurrenceId, occurrenceDate)`, e nao com um "select antes de inserir"
   * que duas execucoes simultaneas atravessariam juntas.
   */
  createIfAbsent(transaction: Transaction): Promise<boolean>;
  /** As duas pernas de uma transferencia, na mesma transacao de banco. */
  createMany(transactions: Transaction[]): Promise<void>;

  /**
   * O grupo de parcelamento e suas parcelas, tudo ou nada.
   *
   * Uma so operacao porque as parcelas nao existem sem o grupo: gravar as doze
   * e falhar no grupo deixaria doze lancamentos soltos que a tela nao consegue
   * reconhecer como uma compra unica.
   */
  createInstallmentGroup(
    group: {
      id: UniqueEntityId;
      workspaceId: UniqueEntityId;
      description: string;
      totalAmountInCents: number;
      totalInstallments: number;
      firstDueDate: CalendarDate;
    },
    installments: Transaction[],
  ): Promise<void>;
  save(transaction: Transaction): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;
  /** Apaga o PAR inteiro: meia transferencia deixaria o saldo errado. */
  deleteTransferPair(workspaceId: UniqueEntityId, transferPairId: UniqueEntityId): Promise<void>;

  /** Saldos derivados de todas as contas do workspace, em uma consulta. */
  balancesByAccount(workspaceId: UniqueEntityId): Promise<Map<string, AccountBalance>>;

  countByAccount(workspaceId: UniqueEntityId, accountId: UniqueEntityId): Promise<number>;
  countByCategory(workspaceId: UniqueEntityId, categoryIds: UniqueEntityId[]): Promise<number>;
  /** Contagem por categoria, em uma consulta -- evita N+1 na tela de categorias. */
  countGroupedByCategory(workspaceId: UniqueEntityId): Promise<Map<string, number>>;
  /** Realocacao em massa, para excluir uma categoria sem orfanar lancamento. */
  reassignCategory(
    workspaceId: UniqueEntityId,
    fromCategoryIds: UniqueEntityId[],
    toCategoryId: UniqueEntityId | null,
  ): Promise<number>;
}

export const TRANSACTION_REPOSITORY = Symbol('TransactionRepository');
