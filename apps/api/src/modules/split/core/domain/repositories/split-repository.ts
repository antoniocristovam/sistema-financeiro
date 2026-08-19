import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type ExpenseSplit } from '../entities/expense-split';

/** Uma linha de divisao pendente, com o contexto que o saldo precisa. */
export interface OutstandingSplit {
  split: ExpenseSplit;
  transactionDescription: string;
  transactionDate: CalendarDate;
  /** Quem pagou a despesa. E' a contraparte de quem deve. */
  ownerUserId: string;
  ownerName: string;
}

export interface SettlementRecord {
  id: UniqueEntityId;
  workspaceId: UniqueEntityId;
  fromUserId: UniqueEntityId | null;
  fromName: string;
  fromEmail: string | null;
  toUserId: UniqueEntityId | null;
  toName: string;
  toEmail: string | null;
  amountInCents: number;
  date: CalendarDate;
  note: string | null;
  transactionId: UniqueEntityId | null;
}

export interface SettlementView extends SettlementRecord {
  settledSplitCount: number;
  createdAt: Date;
}

/**
 * Porta do repositorio de divisoes e acertos.
 *
 * As duas coisas moram juntas porque uma nao existe sem a outra: o acerto so
 * faz sentido contra as divisoes que ele quita, e quitar sem registrar o acerto
 * deixaria o saldo mudando sem nada que explique por que.
 */
export interface SplitRepository {
  listByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<ExpenseSplit[]>;

  /**
   * Substitui a divisao inteira de um lancamento.
   *
   * Nao existe "editar um participante": o rateio e' um conjunto que fecha com
   * o valor cheio (regra 7), e mexer numa linha isolada quebraria o fechamento.
   * Trocar tudo de uma vez e' o que mantem a soma exata.
   */
  replaceForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
    splits: ExpenseSplit[],
  ): Promise<void>;

  deleteForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<void>;

  /** Divisoes PENDENTES do workspace, para montar os saldos. */
  listOutstanding(workspaceId: UniqueEntityId): Promise<OutstandingSplit[]>;

  /**
   * Quita as divisoes pendentes de uma pessoa, da mais antiga para a mais nova,
   * ate o valor acabar.
   *
   * Devolve quantas linhas foram quitadas. Um acerto parcial deixa o restante
   * pendente -- e' o comportamento certo para quem paga "por alto" e acerta o
   * resto depois.
   */
  settleOutstanding(
    workspaceId: UniqueEntityId,
    participantKey: string,
    amountInCents: number,
    settlementId: UniqueEntityId,
    now: Date,
  ): Promise<number>;

  createSettlement(settlement: SettlementRecord): Promise<void>;
  listSettlements(workspaceId: UniqueEntityId, limit: number): Promise<SettlementView[]>;
}

export const SPLIT_REPOSITORY = Symbol('SplitRepository');
