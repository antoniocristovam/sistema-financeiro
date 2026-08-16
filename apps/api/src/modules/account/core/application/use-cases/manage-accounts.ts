import { AccountType } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { Account } from '../../domain/entities/account';
import {
  type AccountRepository,
  type AccountWithCard,
} from '../../domain/repositories/account-repository';
import { BillingCycle } from '../../domain/value-objects/billing-cycle';

type AccountError = AccessError | InvalidValueError | ResourceNotFoundError | ConflictError;

export interface CreditCardDetails {
  limitInCents: number;
  closingDay: number;
  dueDay: number;
}

// -- Listagem -----------------------------------------------------------------

/** Conta + saldo derivado. */
export interface AccountWithBalance extends AccountWithCard {
  settledInCents: number;
  projectedInCents: number;
  transactionCount: number;
}

/**
 * Contas do workspace, com saldo.
 *
 * O saldo e' DERIVADO dos lancamentos, nunca materializado numa coluna. Manter
 * uma coluna de saldo exigiria sincronia com toda insercao, edicao e exclusao;
 * o primeiro bug de sincronia deixa o saldo do app diferente do saldo do banco,
 * que e' o erro mais caro que este produto pode cometer.
 *
 * Uma consulta agregada traz todos de uma vez -- nao uma por conta.
 */
export class ListAccountsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
    options: { includeArchived?: boolean } = {},
  ): Promise<Either<AccessError, AccountWithBalance[]>> {
    const authorized = await this.access.authorize(workspaceId, userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const [entries, balances] = await Promise.all([
      this.accounts.listByWorkspace(workspaceId, options),
      this.transactions.balancesByAccount(workspaceId),
    ]);

    return right(
      entries.map((entry) => {
        const balance = balances.get(entry.account.id.toValue());
        const initial = entry.account.initialBalance.toCents();

        return {
          ...entry,
          settledInCents: initial + (balance?.settledInCents ?? 0),
          projectedInCents: initial + (balance?.projectedInCents ?? 0),
          transactionCount: balance?.transactionCount ?? 0,
        };
      }),
    );
  }
}

// -- Criacao ------------------------------------------------------------------

export interface CreateAccountInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  name: string;
  type: AccountType;
  initialBalanceInCents: number;
  institution?: string;
  color?: string;
  icon?: string;
  creditCard?: CreditCardDetails;
  ipAddress?: string;
}

export class CreateAccountUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateAccountInput): Promise<Either<AccountError, Account>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const currency = authorized.value.workspace.baseCurrency;
    const isCard = input.type === AccountType.CREDIT_CARD;

    let cycle: BillingCycle | null = null;

    if (isCard) {
      if (!input.creditCard) {
        return left(
          new InvalidValueError('Informe o ciclo de fatura do cartao.', 'creditCard'),
        );
      }

      const parsed = BillingCycle.create(input.creditCard.closingDay, input.creditCard.dueDay);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      cycle = parsed.value;
    }

    const now = this.clock.now();

    const account = Account.create({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      type: input.type,
      // Cartao abre em zero: a divida vive na fatura, nao no saldo (regra 5).
      initialBalance: Money.fromCents(isCard ? 0 : input.initialBalanceInCents, currency),
      institution: input.institution?.trim() ?? null,
      color: input.color ?? null,
      icon: input.icon ?? (isCard ? 'credit-card' : null),
      createdAt: now,
      updatedAt: now,
    });

    await this.accounts.create(account, cycle, input.creditCard?.limitInCents ?? 0);

    return right(account);
  }
}

// -- Edicao -------------------------------------------------------------------

export interface UpdateAccountInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  accountId: UniqueEntityId;
  name?: string;
  institution?: string | null;
  color?: string | null;
  icon?: string | null;
  initialBalanceInCents?: number;
  creditCard?: CreditCardDetails;
}

export class UpdateAccountUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(input: UpdateAccountInput): Promise<Either<AccountError, Account>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const entry = await this.accounts.findById(input.workspaceId, input.accountId);

    if (!entry) {
      return left(new ResourceNotFoundError('Conta'));
    }

    const { account } = entry;

    if (input.name !== undefined) {
      account.rename(input.name.trim());
    }

    if (input.institution !== undefined || input.color !== undefined || input.icon !== undefined) {
      account.updateAppearance({
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
      });

      if (input.institution !== undefined) {
        account.changeInstitution(input.institution);
      }
    }

    if (input.initialBalanceInCents !== undefined && !account.isCreditCard()) {
      account.changeInitialBalance(
        Money.fromCents(input.initialBalanceInCents, authorized.value.workspace.baseCurrency),
      );
    }

    let cycle: BillingCycle | null = null;

    if (input.creditCard) {
      if (!account.isCreditCard()) {
        return left(
          new InvalidValueError('So conta do tipo cartao tem ciclo de fatura.', 'creditCard'),
        );
      }

      const parsed = BillingCycle.create(input.creditCard.closingDay, input.creditCard.dueDay);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      cycle = parsed.value;
    }

    await this.accounts.save(account, cycle, input.creditCard?.limitInCents);

    return right(account);
  }
}

// -- Arquivar / desarquivar ---------------------------------------------------

export interface ArchiveAccountInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  accountId: UniqueEntityId;
  archived: boolean;
  ipAddress?: string;
}

/**
 * Arquivar em vez de excluir.
 *
 * Conta arquivada some das listas e nao recebe lancamento novo, mas o historico
 * continua inteiro -- e' o que permite fechar uma conta no banco sem perder o
 * extrato dos anos anteriores.
 */
export class ArchiveAccountUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(input: ArchiveAccountInput): Promise<Either<AccountError, Account>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const entry = await this.accounts.findById(input.workspaceId, input.accountId);

    if (!entry) {
      return left(new ResourceNotFoundError('Conta'));
    }

    if (input.archived) {
      entry.account.archive(this.clock.now());
    } else {
      entry.account.unarchive();
    }

    await this.accounts.save(entry.account);

    if (input.archived) {
      await this.audit.record({
        workspaceId: input.workspaceId.toValue(),
        actorUserId: input.userId.toValue(),
        action: 'ACCOUNT_ARCHIVED',
        entityType: 'Account',
        entityId: input.accountId.toValue(),
        metadata: { name: entry.account.name },
        ipAddress: input.ipAddress,
      });
    }

    return right(entry.account);
  }
}

// -- Exclusao -----------------------------------------------------------------

export interface DeleteAccountInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  accountId: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Exclusao definitiva.
 *
 * So passa se a conta estiver VAZIA. Apagar uma conta com lancamentos levaria
 * o historico junto e mudaria saldos de meses ja fechados -- por isso o caminho
 * para uma conta usada e' arquivar, e a mensagem diz isso.
 */
export class DeleteAccountUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: DeleteAccountInput): Promise<Either<AccountError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'account:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const entry = await this.accounts.findById(input.workspaceId, input.accountId);

    if (!entry) {
      return left(new ResourceNotFoundError('Conta'));
    }

    const count = await this.transactions.countByAccount(input.workspaceId, input.accountId);

    if (count > 0) {
      return left(
        new ConflictError(
          `Esta conta tem ${count} lancamento(s). Arquive-a em vez de excluir para preservar o historico.`,
        ),
      );
    }

    await this.unitOfWork.run(async () => {
      await this.accounts.delete(input.workspaceId, input.accountId);
    });

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.userId.toValue(),
      action: 'ACCOUNT_DELETED',
      entityType: 'Account',
      entityId: input.accountId.toValue(),
      metadata: { name: entry.account.name },
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}
