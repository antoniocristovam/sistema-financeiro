import {
  participantKeyOf,
  type ShareType,
  splitAmountsClose,
  TransactionStatus,
  TransactionType,
} from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { type Either, left, right } from '../../../../../shared/either';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { Transaction } from '../../../../transaction/core/domain/entities/transaction';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { ExpenseSplit } from '../../domain/entities/expense-split';
import {
  type SettlementView,
  type SplitRepository,
} from '../../domain/repositories/split-repository';
import { SplitShares } from '../../domain/value-objects/split-shares';

type SplitError = AccessError | InvalidValueError | ResourceNotFoundError | ConflictError;

export interface ParticipantInput {
  participantUserId?: string;
  name: string;
  email?: string;
  shareValue?: number;
  isOwner: boolean;
}

export interface TransactionSplitsResult {
  transactionId: UniqueEntityId;
  amountInCents: number;
  ownerShareInCents: number;
  outstandingInCents: number;
  splits: ExpenseSplit[];
}

function summarize(
  transactionId: UniqueEntityId,
  amountInCents: number,
  splits: ExpenseSplit[],
): TransactionSplitsResult {
  const owner = splits.find((split) => split.isOwner);

  return {
    transactionId,
    amountInCents,
    // Sem divisao, tudo e' meu: o valor cheio E' a minha parte.
    ownerShareInCents: owner?.amount.toCents() ?? amountInCents,
    outstandingInCents: splits
      .filter((split) => !split.isOwner && !split.isSettled())
      .reduce((total, split) => total + split.amount.toCents(), 0),
    splits,
  };
}

// -- Divisao ------------------------------------------------------------------

export interface SplitTransactionInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
  shareType: ShareType;
  participants: ParticipantInput[];
}

/**
 * Divide uma despesa entre pessoas.
 *
 * As duas regras que se encontram aqui:
 *
 * - **Regra 6**: o valor CHEIO continua no lancamento e afeta o saldo -- ele
 *   saiu da conta de quem pagou. O que a divisao cria e' a informacao de quanto
 *   daquilo e' de cada um; a parte do dono e' a que entra em relatorio e
 *   orcamento.
 * - **Regra 7**: a soma das partes fecha EXATAMENTE com o valor. O calculo sai
 *   do `SplitShares`, que distribui os centavos de resto em vez de descarta-los.
 *
 * A divisao e' sempre substituida por inteiro: nao existe "editar so a parte do
 * Bruno", porque mexer numa linha isolada quebraria o fechamento das outras.
 */
export class SplitTransactionUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly splits: SplitRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: SplitTransactionInput,
  ): Promise<Either<SplitError, TransactionSplitsResult>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const transaction = await this.transactions.findById(
      input.workspaceId,
      input.transactionId,
    );

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    // So despesa se divide. Transferencia nem despesa e' (regra 4), e dividir
    // uma receita nao significa nada.
    if (transaction.type !== TransactionType.EXPENSE) {
      return left(new InvalidValueError('So despesa pode ser dividida.', 'transactionId'));
    }

    const owners = input.participants.filter((participant) => participant.isOwner);

    if (owners.length !== 1) {
      return left(
        new InvalidValueError(
          'A divisao precisa de exatamente uma pessoa marcada como quem pagou.',
          'participants',
        ),
      );
    }

    // Chave duplicada produziria dois saldos da mesma pessoa, cada um com
    // metade da divida.
    const keys = input.participants.map((participant) =>
      participantKeyOf({
        participantUserId: participant.participantUserId ?? null,
        email: participant.email ?? null,
        name: participant.name,
      }),
    );

    if (new Set(keys).size !== keys.length) {
      return left(
        new InvalidValueError('A mesma pessoa aparece duas vezes na divisao.', 'participants'),
      );
    }

    const computed = SplitShares.compute(
      transaction.amount,
      input.shareType,
      input.participants.map((participant, index) => ({
        key: String(index),
        ...(participant.shareValue !== undefined ? { value: participant.shareValue } : {}),
      })),
    );

    if (computed.isLeft()) {
      return left(new InvalidValueError(computed.value.message, 'participants'));
    }

    const amounts = input.participants.map(
      (_, index) => computed.value.find(String(index))!.amount,
    );

    /*
     * Rede de seguranca da regra 7.
     *
     * O `SplitShares` ja fecha por construcao; esta checagem existe para o dia
     * em que alguem mexer no calculo. Um centavo perdido aqui vira um relatorio
     * errado que ninguem consegue rastrear ate a origem.
     */
    if (
      !splitAmountsClose(
        transaction.amount.toCents(),
        amounts.map((amount) => amount.toCents()),
      )
    ) {
      return left(new ConflictError('A soma das partes nao fecha com o valor da despesa.'));
    }

    const entities: ExpenseSplit[] = [];

    for (const [index, participant] of input.participants.entries()) {
      let email: Email | null = null;

      if (participant.email) {
        const parsed = Email.create(participant.email);

        if (parsed.isLeft()) {
          return left(new InvalidValueError('E-mail invalido.', 'participants'));
        }

        email = parsed.value;
      }

      entities.push(
        ExpenseSplit.create({
          workspaceId: input.workspaceId,
          transactionId: input.transactionId,
          participantUserId: participant.participantUserId
            ? new UniqueEntityId(participant.participantUserId)
            : null,
          participantName: participant.name.trim(),
          participantEmail: email,
          shareType: input.shareType,
          shareValue: participant.shareValue ?? null,
          amount: amounts[index]!,
          isOwner: participant.isOwner,
        }),
      );
    }

    await this.unitOfWork.run(async () => {
      await this.splits.replaceForTransaction(input.workspaceId, input.transactionId, entities);
    });

    return right(summarize(input.transactionId, transaction.amount.toCents(), entities));
  }
}

export interface GetTransactionSplitsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
}

export class GetTransactionSplitsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly transactions: TransactionRepository,
    private readonly splits: SplitRepository,
  ) {}

  async execute(
    input: GetTransactionSplitsInput,
  ): Promise<Either<SplitError, TransactionSplitsResult>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const transaction = await this.transactions.findById(
      input.workspaceId,
      input.transactionId,
    );

    if (!transaction) {
      return left(new ResourceNotFoundError('Lancamento'));
    }

    const splits = await this.splits.listByTransaction(input.workspaceId, input.transactionId);

    return right(summarize(input.transactionId, transaction.amount.toCents(), splits));
  }
}

export interface RemoveSplitInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  transactionId: UniqueEntityId;
}

/**
 * Desfaz a divisao.
 *
 * O lancamento continua intacto -- ele nunca mudou. O que sai e' a informacao
 * de rateio, e com ela o orcamento volta a contar o valor cheio, que passa a
 * ser inteiramente meu de novo.
 */
export class RemoveSplitUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly splits: SplitRepository,
  ) {}

  async execute(input: RemoveSplitInput): Promise<Either<SplitError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    await this.splits.deleteForTransaction(input.workspaceId, input.transactionId);

    return right(undefined);
  }
}

// -- Saldos -------------------------------------------------------------------

export interface BalanceEntry {
  participantKey: string;
  participantUserId: string | null;
  participantName: string;
  participantEmail: string | null;
  netInCents: number;
  owedToMeInCents: number;
  owedByMeInCents: number;
  pendingSplitCount: number;
}

export interface ListBalancesInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
}

/**
 * Quem deve quanto a quem.
 *
 * O saldo e' LIQUIDO por pessoa: o que eu paguei e ela ainda nao acertou, menos
 * o que ela pagou e eu ainda nao acertei. Mostrar as duas pontas separadas
 * faria o usuario subtrair de cabeca toda vez -- e e' justamente a compensacao
 * que evita dois pagamentos cruzados pelo mesmo grupo de despesas.
 */
export class ListSplitBalancesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly splits: SplitRepository,
  ) {}

  async execute(input: ListBalancesInput): Promise<Either<SplitError, BalanceEntry[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const outstanding = await this.splits.listOutstanding(input.workspaceId);
    const me = input.userId.toValue();
    const byKey = new Map<string, BalanceEntry>();

    const entryFor = (
      key: string,
      seed: {
        participantUserId: string | null;
        participantName: string;
        participantEmail: string | null;
      },
    ): BalanceEntry => {
      const existing = byKey.get(key);

      if (existing) {
        return existing;
      }

      const created: BalanceEntry = {
        participantKey: key,
        ...seed,
        netInCents: 0,
        owedToMeInCents: 0,
        owedByMeInCents: 0,
        pendingSplitCount: 0,
      };

      byKey.set(key, created);

      return created;
    };

    for (const entry of outstanding) {
      const { split } = entry;
      const participantId = split.participantUserId?.toValue() ?? null;

      if (entry.ownerUserId === me) {
        // Eu paguei: a parte pendente dela e' credito meu.
        if (participantId === me) {
          continue;
        }

        const target = entryFor(split.participantKey(), {
          participantUserId: participantId,
          participantName: split.participantName,
          participantEmail: split.participantEmail?.value ?? null,
        });

        target.owedToMeInCents += split.amount.toCents();
        target.netInCents += split.amount.toCents();
        target.pendingSplitCount += 1;
        continue;
      }

      /*
       * Outra pessoa pagou e a parte pendente e' MINHA: divida minha.
       *
       * A contraparte aqui e' o DONO da despesa, nao o participante -- por isso
       * a chave usada e' a dele. Trocar as duas inverteria o sinal, e o usuario
       * veria como credito o que e' divida.
       */
      if (participantId === me) {
        const ownerKey = participantKeyOf({
          participantUserId: entry.ownerUserId,
          name: entry.ownerName,
        });

        const target = entryFor(ownerKey, {
          participantUserId: entry.ownerUserId,
          participantName: entry.ownerName,
          participantEmail: null,
        });

        target.owedByMeInCents += split.amount.toCents();
        target.netInCents -= split.amount.toCents();
        target.pendingSplitCount += 1;
      }
    }

    return right([...byKey.values()].sort((a, b) => b.netInCents - a.netInCents));
  }
}

// -- Acertos ------------------------------------------------------------------

export interface RecordSettlementInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  participantKey: string;
  participantUserId?: string;
  participantName: string;
  participantEmail?: string;
  amountInCents: number;
  direction: 'RECEIVED' | 'PAID';
  date?: string;
  note?: string;
  accountId?: string;
  createTransaction: boolean;
}

/**
 * Registra um acerto de contas.
 *
 * Duas coisas acontecem, e elas sao independentes de proposito:
 *
 * 1. As divisoes pendentes daquela pessoa sao quitadas, da mais antiga para a
 *    mais nova, ate o valor acabar. Acerto parcial deixa o resto pendente --
 *    e' o comportamento certo para quem paga "por alto" e fecha o resto depois.
 * 2. Opcionalmente, o movimento vira lancamento. So opcionalmente: acerto em
 *    especie ou por fora das contas cadastradas nao pode inventar um movimento
 *    que a conta nunca viu.
 */
export class RecordSettlementUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly splits: SplitRepository,
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: RecordSettlementInput,
  ): Promise<Either<SplitError, { settlementId: string; settledSplits: number }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    let date = CalendarDate.fromUtcDate(this.clock.now());

    if (input.date) {
      const parsed = CalendarDate.create(input.date);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      date = parsed.value;
    }

    const currency = authorized.value.workspace.baseCurrency;
    const settlementId = new UniqueEntityId();
    const received = input.direction === 'RECEIVED';

    /*
     * O historico guarda NOMES, nao ids.
     *
     * O acerto e' lido meses depois, quando o participante pode nem ter mais
     * conta. Guardar o e-mail no lugar do nome deixava a linha ilegivel:
     * "Bruno -> ana@exemplo.com" nao e' uma frase que alguem entenda.
     */
    const me = await this.users.findById(input.userId);
    const userName = me?.name ?? authorized.value.workspace.name;
    let transaction: Transaction | null = null;

    if (input.createTransaction) {
      if (!input.accountId) {
        return left(
          new InvalidValueError('Informe a conta para registrar o lancamento.', 'accountId'),
        );
      }

      const account = await this.accounts.findById(
        input.workspaceId,
        new UniqueEntityId(input.accountId),
      );

      if (!account) {
        return left(new ResourceNotFoundError('Conta'));
      }

      const created = Transaction.create({
        workspaceId: input.workspaceId,
        accountId: account.account.id,
        categoryId: null,
        createdByUserId: input.userId,
        type: received ? TransactionType.INCOME : TransactionType.EXPENSE,
        amount: Money.fromCents(input.amountInCents, currency),
        date,
        description: received
          ? `Acerto recebido de ${input.participantName}`
          : `Acerto pago a ${input.participantName}`,
        status: TransactionStatus.SETTLED,
        notes: input.note?.trim() ?? null,
        counterpartyName: input.participantName,
      });

      if (created.isLeft()) {
        return left(created.value);
      }

      transaction = created.value;
    }

    const participantUserId = input.participantUserId
      ? new UniqueEntityId(input.participantUserId)
      : null;

    let settledSplits = 0;

    await this.unitOfWork.run(async () => {
      if (transaction) {
        await this.transactions.create(transaction);
      }

      /*
       * Quem paga e quem recebe dependem da direcao.
       *
       * Guardar sempre "eu -> ela" perderia a informacao de quem quitou o que,
       * e o historico deixaria de fazer sentido para os dois lados.
       */
      await this.splits.createSettlement({
        id: settlementId,
        workspaceId: input.workspaceId,
        fromUserId: received ? participantUserId : input.userId,
        fromName: received ? input.participantName : userName,
        fromEmail: received ? (input.participantEmail ?? null) : null,
        toUserId: received ? input.userId : participantUserId,
        toName: received ? userName : input.participantName,
        toEmail: received ? null : (input.participantEmail ?? null),
        amountInCents: input.amountInCents,
        date,
        note: input.note?.trim() ?? null,
        transactionId: transaction?.id ?? null,
      });

      settledSplits = await this.splits.settleOutstanding(
        input.workspaceId,
        input.participantKey,
        input.amountInCents,
        settlementId,
        this.clock.now(),
      );
    });

    return right({ settlementId: settlementId.toValue(), settledSplits });
  }
}

export interface ListSettlementsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  limit: number;
}

export class ListSettlementsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly splits: SplitRepository,
  ) {}

  async execute(input: ListSettlementsInput): Promise<Either<SplitError, SettlementView[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    return right(await this.splits.listSettlements(input.workspaceId, input.limit));
  }
}
