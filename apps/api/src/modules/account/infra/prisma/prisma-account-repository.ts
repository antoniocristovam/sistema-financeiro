import { Injectable } from '@nestjs/common';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { type Account } from '../../core/domain/entities/account';
import {
  type AccountRepository,
  type AccountWithCard,
} from '../../core/domain/repositories/account-repository';
import { type BillingCycle } from '../../core/domain/value-objects/billing-cycle';
import { AccountMapper } from './account-mapper';

/**
 * Repositorio de contas.
 *
 * Toda consulta filtra por `workspaceId` -- inclusive as que ja teriam o id
 * unico da conta. Buscar so pelo id abriria IDOR: o id de outra pessoa
 * responderia normalmente.
 *
 * A moeda vem do workspace, nao da conta: e' o workspace que define em que
 * moeda os centavos gravados devem ser interpretados.
 */
@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<AccountWithCard | null> {
    const raw = await this.tx.client.account.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: { creditCard: true, workspace: { select: { baseCurrency: true } } },
    });

    if (!raw) {
      return null;
    }

    return {
      account: AccountMapper.toDomain(raw, raw.workspace.baseCurrency),
      billingCycle: AccountMapper.cycleToDomain(raw.creditCard),
      creditCardLimitInCents: raw.creditCard?.limitInCents ?? null,
    };
  }

  async listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeArchived?: boolean } = {},
  ): Promise<AccountWithCard[]> {
    const rows = await this.tx.client.account.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        ...(options.includeArchived === true ? {} : { archivedAt: null }),
      },
      include: { creditCard: true, workspace: { select: { baseCurrency: true } } },
      // `id` como desempate: duas contas criadas no mesmo instante (o
      // onboarding cria todos os cartoes com o mesmo `now`) empatam em
      // `createdAt`, e sem terceiro criterio a ordem varia entre consultas.
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((raw) => ({
      account: AccountMapper.toDomain(raw, raw.workspace.baseCurrency),
      billingCycle: AccountMapper.cycleToDomain(raw.creditCard),
      creditCardLimitInCents: raw.creditCard?.limitInCents ?? null,
    }));
  }

  async countByWorkspace(workspaceId: UniqueEntityId): Promise<number> {
    return this.tx.client.account.count({
      where: { workspaceId: workspaceId.toValue(), archivedAt: null },
    });
  }

  async create(
    account: Account,
    billingCycle?: BillingCycle | null,
    limitInCents = 0,
  ): Promise<void> {
    await this.tx.client.account.create({
      data: {
        ...AccountMapper.toPrisma(account),
        ...(billingCycle
          ? {
              creditCard: {
                create: {
                  limitInCents,
                  closingDay: billingCycle.closingDay,
                  dueDay: billingCycle.dueDay,
                },
              },
            }
          : {}),
      },
    });
  }

  async save(
    account: Account,
    billingCycle?: BillingCycle | null,
    limitInCents?: number,
  ): Promise<void> {
    const data = AccountMapper.toPrisma(account);

    await this.tx.client.account.update({
      where: { id: data.id },
      data: {
        name: data.name,
        institution: data.institution,
        color: data.color,
        icon: data.icon,
        initialBalanceInCents: data.initialBalanceInCents,
        archivedAt: data.archivedAt,
        ...(billingCycle
          ? {
              creditCard: {
                update: {
                  closingDay: billingCycle.closingDay,
                  dueDay: billingCycle.dueDay,
                  ...(limitInCents === undefined ? {} : { limitInCents }),
                },
              },
            }
          : {}),
      },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    // `deleteMany` com os dois filtros: um `delete` por id apagaria a conta de
    // outro workspace se o id vazasse.
    await this.tx.client.account.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }
}
