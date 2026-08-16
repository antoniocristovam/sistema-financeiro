import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Account } from '../entities/account';
import { type BillingCycle } from '../value-objects/billing-cycle';

/** Conta + os dados do cartao, quando ela e um cartao de credito. */
export interface AccountWithCard {
  account: Account;
  billingCycle: BillingCycle | null;
  creditCardLimitInCents: number | null;
}

/**
 * Porta do repositorio de contas.
 *
 * TODA assinatura recebe `workspaceId`. Nao existe `findById(id)` sem escopo --
 * essa ausencia e' a barreira contra IDOR, e ela e' de tipo: nao da para
 * esquecer o filtro porque o metodo nem compila sem ele.
 */
export interface AccountRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<AccountWithCard | null>;
  listByWorkspace(
    workspaceId: UniqueEntityId,
    options?: { includeArchived?: boolean },
  ): Promise<AccountWithCard[]>;
  countByWorkspace(workspaceId: UniqueEntityId): Promise<number>;

  create(
    account: Account,
    billingCycle?: BillingCycle | null,
    limitInCents?: number,
  ): Promise<void>;
  save(
    account: Account,
    billingCycle?: BillingCycle | null,
    limitInCents?: number,
  ): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
