import { SplitStatus } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';
import { Money } from '@finapp/money';
import { type ExpenseSplit as PrismaSplit } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { Email } from '../../../../shared/domain/value-objects/email';
import { ExpenseSplit } from '../../core/domain/entities/expense-split';
import {
  type OutstandingSplit,
  type SettlementRecord,
  type SettlementView,
  type SplitRepository,
} from '../../core/domain/repositories/split-repository';

function toDomain(raw: PrismaSplit, currency: string): ExpenseSplit {
  let email: Email | null = null;

  if (raw.participantEmail) {
    const parsed = Email.create(raw.participantEmail);

    // Dado JA gravado: se a entidade recusa, o registro esta inconsistente.
    if (parsed.isRight()) {
      email = parsed.value;
    }
  }

  return ExpenseSplit.create(
    {
      workspaceId: new UniqueEntityId(raw.workspaceId),
      transactionId: new UniqueEntityId(raw.transactionId),
      participantUserId: raw.participantUserId
        ? new UniqueEntityId(raw.participantUserId)
        : null,
      participantName: raw.participantName,
      participantEmail: email,
      shareType: raw.shareType,
      shareValue: raw.shareValue,
      amount: Money.fromCents(raw.amountInCents, currency),
      isOwner: raw.isOwner,
      status: raw.status,
      settledAt: raw.settledAt,
      settlementId: raw.settlementId ? new UniqueEntityId(raw.settlementId) : null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
    new UniqueEntityId(raw.id),
  );
}

@Injectable()
export class PrismaSplitRepository implements SplitRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  private async currencyOf(workspaceId: UniqueEntityId): Promise<string> {
    const workspace = await this.tx.client.workspace.findUnique({
      where: { id: workspaceId.toValue() },
      select: { baseCurrency: true },
    });

    return workspace?.baseCurrency ?? 'BRL';
  }

  async listByTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<ExpenseSplit[]> {
    const raws = await this.tx.client.expenseSplit.findMany({
      where: {
        transactionId: transactionId.toValue(),
        workspaceId: workspaceId.toValue(),
      },
      // Dono primeiro: e' a linha que a tela destaca.
      orderBy: [{ isOwner: 'desc' }, { participantName: 'asc' }, { id: 'asc' }],
    });

    const currency = await this.currencyOf(workspaceId);

    return raws.map((raw) => toDomain(raw, currency));
  }

  /**
   * Apaga e regrava a divisao inteira.
   *
   * O rateio e' um conjunto que fecha com o valor cheio (regra 7): atualizar
   * linha a linha abriria uma janela em que a soma nao fecha, e um erro no meio
   * deixaria a divisao permanentemente inconsistente. Como as duas operacoes
   * rodam dentro da mesma unidade de trabalho, ou tudo entra ou nada muda.
   */
  async replaceForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
    splits: ExpenseSplit[],
  ): Promise<void> {
    await this.deleteForTransaction(workspaceId, transactionId);

    await this.tx.client.expenseSplit.createMany({
      data: splits.map((split) => ({
        id: split.id.toValue(),
        workspaceId: split.workspaceId.toValue(),
        transactionId: split.transactionId.toValue(),
        participantUserId: split.participantUserId?.toValue() ?? null,
        participantName: split.participantName,
        participantEmail: split.participantEmail?.value ?? null,
        shareType: split.shareType,
        shareValue: split.shareValue,
        amountInCents: split.amount.toCents(),
        isOwner: split.isOwner,
        status: split.status,
        settledAt: split.settledAt,
        settlementId: split.settlementId?.toValue() ?? null,
      })),
    });
  }

  async deleteForTransaction(
    workspaceId: UniqueEntityId,
    transactionId: UniqueEntityId,
  ): Promise<void> {
    await this.tx.client.expenseSplit.deleteMany({
      where: {
        transactionId: transactionId.toValue(),
        workspaceId: workspaceId.toValue(),
      },
    });
  }

  async listOutstanding(workspaceId: UniqueEntityId): Promise<OutstandingSplit[]> {
    const raws = await this.tx.client.expenseSplit.findMany({
      where: {
        workspaceId: workspaceId.toValue(),
        status: SplitStatus.PENDING,
        isOwner: false,
      },
      include: {
        transaction: {
          select: {
            description: true,
            date: true,
            createdByUserId: true,
            createdBy: { select: { name: true } },
          },
        },
      },
      // Mais antigas primeiro: e' a ordem em que o acerto as quita.
      orderBy: [{ transaction: { date: 'asc' } }, { id: 'asc' }],
    });

    const currency = await this.currencyOf(workspaceId);

    return raws.map((raw) => ({
      split: toDomain(raw, currency),
      transactionDescription: raw.transaction.description,
      transactionDate: CalendarDate.fromUtcDate(raw.transaction.date),
      ownerUserId: raw.transaction.createdByUserId,
      ownerName: raw.transaction.createdBy.name,
    }));
  }

  /**
   * Quita as divisoes pendentes de uma pessoa ate o valor acabar.
   *
   * Da mais ANTIGA para a mais nova: e' a ordem que as pessoas usam quando
   * acertam contas, e a que faz o saldo restante ser sempre o das despesas
   * recentes.
   *
   * Uma linha nao e' quitada pela metade -- dividir a linha criaria um rateio
   * que nao fecha mais com o valor da despesa (regra 7). Mas o laco NAO para na
   * primeira que nao cabe: ele segue tentando as seguintes.
   *
   * A diferenca importa. Quem deve R$ 162,50 de um mercado e R$ 33,33 de um
   * jantar e paga exatamente R$ 33,33 esta pagando o jantar. Parar na primeira
   * linha registraria o dinheiro e nao quitaria nada -- o saldo continuaria
   * cheio, com um recibo ao lado dizendo que foi pago.
   */
  async settleOutstanding(
    workspaceId: UniqueEntityId,
    participantKey: string,
    amountInCents: number,
    settlementId: UniqueEntityId,
    now: Date,
  ): Promise<number> {
    const outstanding = await this.listOutstanding(workspaceId);
    const mine = outstanding.filter((entry) => entry.split.participantKey() === participantKey);

    const toSettle: string[] = [];
    let remaining = amountInCents;

    for (const entry of mine) {
      const value = entry.split.amount.toCents();

      if (value > remaining) {
        continue;
      }

      toSettle.push(entry.split.id.toValue());
      remaining -= value;
    }

    if (toSettle.length === 0) {
      return 0;
    }

    const result = await this.tx.client.expenseSplit.updateMany({
      where: { id: { in: toSettle }, workspaceId: workspaceId.toValue() },
      data: {
        status: SplitStatus.SETTLED,
        settledAt: now,
        settlementId: settlementId.toValue(),
      },
    });

    return result.count;
  }

  async createSettlement(settlement: SettlementRecord): Promise<void> {
    await this.tx.client.settlement.create({
      data: {
        id: settlement.id.toValue(),
        workspaceId: settlement.workspaceId.toValue(),
        fromUserId: settlement.fromUserId?.toValue() ?? null,
        fromName: settlement.fromName,
        fromEmail: settlement.fromEmail,
        toUserId: settlement.toUserId?.toValue() ?? null,
        toName: settlement.toName,
        toEmail: settlement.toEmail,
        amountInCents: settlement.amountInCents,
        date: settlement.date.toUtcDate(),
        note: settlement.note,
        transactionId: settlement.transactionId?.toValue() ?? null,
      },
    });
  }

  async listSettlements(
    workspaceId: UniqueEntityId,
    limit: number,
  ): Promise<SettlementView[]> {
    const raws = await this.tx.client.settlement.findMany({
      where: { workspaceId: workspaceId.toValue() },
      include: { _count: { select: { splits: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return raws.map((raw) => ({
      id: new UniqueEntityId(raw.id),
      workspaceId: new UniqueEntityId(raw.workspaceId),
      fromUserId: raw.fromUserId ? new UniqueEntityId(raw.fromUserId) : null,
      fromName: raw.fromName,
      fromEmail: raw.fromEmail,
      toUserId: raw.toUserId ? new UniqueEntityId(raw.toUserId) : null,
      toName: raw.toName,
      toEmail: raw.toEmail,
      amountInCents: raw.amountInCents,
      date: CalendarDate.fromUtcDate(raw.date),
      note: raw.note,
      transactionId: raw.transactionId ? new UniqueEntityId(raw.transactionId) : null,
      settledSplitCount: raw._count.splits,
      createdAt: raw.createdAt,
    }));
  }
}
