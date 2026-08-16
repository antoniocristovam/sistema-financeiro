import { Money } from '@finapp/money';
import { type Account as PrismaAccount, type CreditCard as PrismaCard } from '@prisma/client';

import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { Account } from '../../core/domain/entities/account';
import { BillingCycle } from '../../core/domain/value-objects/billing-cycle';

export class AccountMapper {
  static toDomain(raw: PrismaAccount, currency: string): Account {
    return Account.create(
      {
        workspaceId: new UniqueEntityId(raw.workspaceId),
        name: raw.name,
        type: raw.type,
        initialBalance: Money.fromCents(raw.initialBalanceInCents, currency),
        institution: raw.institution,
        color: raw.color,
        icon: raw.icon,
        archivedAt: raw.archivedAt,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static cycleToDomain(raw: PrismaCard | null): BillingCycle | null {
    if (!raw) {
      return null;
    }

    const cycle = BillingCycle.create(raw.closingDay, raw.dueDay);

    // Dados ja gravados: se o ciclo nao valida, o registro esta corrompido --
    // melhor estourar do que devolver uma conta de cartao sem ciclo, que faria
    // toda compra cair na fatura errada em silencio.
    if (cycle.isLeft()) {
      throw new Error(`Ciclo de fatura invalido no banco (cartao ${raw.accountId}).`);
    }

    return cycle.value;
  }

  static toPrisma(account: Account) {
    return {
      id: account.id.toValue(),
      workspaceId: account.workspaceId.toValue(),
      name: account.name,
      type: account.type,
      initialBalanceInCents: account.initialBalance.toCents(),
      institution: account.institution,
      color: account.color,
      icon: account.icon,
      archivedAt: account.archivedAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
