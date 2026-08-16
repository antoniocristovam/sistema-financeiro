import { InvoiceStatus, TransactionType } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';
import { Money } from '@finapp/money';
import { type Invoice as PrismaInvoice } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../shared/domain/value-objects/month-reference';
import { Invoice } from '../../core/domain/entities/invoice';
import {
  type InvoiceItemView,
  type InvoiceRepository,
  type InvoiceView,
} from '../../core/domain/repositories/invoice-repository';

function toDomain(raw: PrismaInvoice, currency: string): Invoice {
  return Invoice.create(
    {
      creditCardId: new UniqueEntityId(raw.creditCardId),
      referenceMonth: MonthReference.fromDate(CalendarDate.fromUtcDate(raw.referenceMonth)),
      closingDate: CalendarDate.fromUtcDate(raw.closingDate),
      dueDate: CalendarDate.fromUtcDate(raw.dueDate),
      total: Money.fromCents(raw.totalInCents, currency),
      status: raw.status,
      paidWithTransactionId: raw.paidWithTransactionId
        ? new UniqueEntityId(raw.paidWithTransactionId)
        : null,
      paidAt: raw.paidAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
    new UniqueEntityId(raw.id),
  );
}

/**
 * O escopo da fatura passa pelo CARTAO.
 *
 * A tabela `invoices` nao tem `workspaceId` -- ela pertence a um cartao, que
 * pertence a uma conta, que pertence ao workspace. Toda consulta desce essa
 * cadeia em vez de confiar so no id da fatura: sem isso, um id vazado leria a
 * divida de outra pessoa.
 */
const scoped = (workspaceId: UniqueEntityId) => ({
  creditCard: { account: { workspaceId: workspaceId.toValue() } },
});

@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Invoice | null> {
    const raw = await this.tx.client.invoice.findFirst({
      where: { id: id.toValue(), ...scoped(workspaceId) },
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
    });

    return raw ? toDomain(raw, raw.creditCard.account.workspace.baseCurrency) : null;
  }

  async findViewById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<InvoiceView | null> {
    const raw = await this.tx.client.invoice.findFirst({
      where: { id: id.toValue(), ...scoped(workspaceId) },
      include: {
        creditCard: {
          select: {
            account: { select: { name: true, workspace: { select: { baseCurrency: true } } } },
          },
        },
        _count: { select: { items: true } },
      },
    });

    if (!raw) {
      return null;
    }

    return {
      invoice: toDomain(raw, raw.creditCard.account.workspace.baseCurrency),
      cardName: raw.creditCard.account.name,
      itemCount: raw._count.items,
    };
  }

  async findByMonth(
    workspaceId: UniqueEntityId,
    creditCardId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<Invoice | null> {
    const raw = await this.tx.client.invoice.findFirst({
      where: {
        creditCardId: creditCardId.toValue(),
        referenceMonth: referenceMonth.firstDay().toUtcDate(),
        ...scoped(workspaceId),
      },
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
    });

    return raw ? toDomain(raw, raw.creditCard.account.workspace.baseCurrency) : null;
  }

  /**
   * `upsert` em vez de "consultar e criar".
   *
   * Duas compras no mesmo ciclo chegando juntas disputariam a criacao da
   * fatura, e uma das duas estouraria por violacao de
   * `(creditCardId, referenceMonth)`. Aqui a corrida termina com as duas
   * enxergando a mesma fatura.
   */
  async ensureForMonth(invoice: Invoice): Promise<Invoice> {
    const raw = await this.tx.client.invoice.upsert({
      where: {
        creditCardId_referenceMonth: {
          creditCardId: invoice.creditCardId.toValue(),
          referenceMonth: invoice.referenceMonth.firstDay().toUtcDate(),
        },
      },
      create: {
        id: invoice.id.toValue(),
        creditCardId: invoice.creditCardId.toValue(),
        referenceMonth: invoice.referenceMonth.firstDay().toUtcDate(),
        closingDate: invoice.closingDate.toUtcDate(),
        dueDate: invoice.dueDate.toUtcDate(),
        totalInCents: invoice.total.toCents(),
        status: invoice.status,
      },
      // Nada a atualizar: quem chega depois so quer a fatura que ja existe.
      update: {},
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
    });

    return toDomain(raw, raw.creditCard.account.workspace.baseCurrency);
  }

  async listByCard(
    workspaceId: UniqueEntityId,
    creditCardId: UniqueEntityId,
    options: { months: number; upTo: MonthReference },
  ): Promise<InvoiceView[]> {
    const from = options.upTo.add(-(options.months - 1));

    const raws = await this.tx.client.invoice.findMany({
      where: {
        creditCardId: creditCardId.toValue(),
        referenceMonth: {
          gte: from.firstDay().toUtcDate(),
          lte: options.upTo.firstDay().toUtcDate(),
        },
        ...scoped(workspaceId),
      },
      include: {
        creditCard: {
          select: {
            account: { select: { name: true, workspace: { select: { baseCurrency: true } } } },
          },
        },
        _count: { select: { items: true } },
      },
      orderBy: { referenceMonth: 'desc' },
    });

    return raws.map((raw) => ({
      invoice: toDomain(raw, raw.creditCard.account.workspace.baseCurrency),
      cardName: raw.creditCard.account.name,
      itemCount: raw._count.items,
    }));
  }

  async listUnpaid(
    workspaceId: UniqueEntityId,
    creditCardId: UniqueEntityId,
  ): Promise<Invoice[]> {
    const raws = await this.tx.client.invoice.findMany({
      where: {
        creditCardId: creditCardId.toValue(),
        status: { not: InvoiceStatus.PAID },
        ...scoped(workspaceId),
      },
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
      orderBy: { referenceMonth: 'asc' },
    });

    return raws.map((raw) => toDomain(raw, raw.creditCard.account.workspace.baseCurrency));
  }

  async items(
    workspaceId: UniqueEntityId,
    invoiceId: UniqueEntityId,
  ): Promise<InvoiceItemView[]> {
    const raws = await this.tx.client.transaction.findMany({
      where: { invoiceId: invoiceId.toValue(), workspaceId: workspaceId.toValue() },
      select: {
        id: true,
        date: true,
        description: true,
        amountInCents: true,
        type: true,
        installmentNumber: true,
        category: { select: { id: true, name: true, icon: true, color: true } },
        installmentGroup: { select: { totalInstallments: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    return raws.map((raw) => ({
      id: raw.id,
      date: CalendarDate.fromUtcDate(raw.date),
      description: raw.description,
      // Estorno na fatura entra NEGATIVO: e' o que faz o total bater com o
      // extrato do banco quando ha devolucao de compra.
      amountInCents:
        raw.type === TransactionType.INCOME ? -raw.amountInCents : raw.amountInCents,
      category: raw.category,
      installmentNumber: raw.installmentNumber,
      installmentTotal: raw.installmentGroup?.totalInstallments ?? null,
    }));
  }

  /**
   * Soma dos itens direto no banco.
   *
   * O total da fatura e' sempre DERIVADO -- nunca acumulado a cada compra. Um
   * incremento perdido numa falha deixaria a fatura mentindo para sempre, e
   * nada no sistema perceberia.
   */
  async sumItems(workspaceId: UniqueEntityId, invoiceId: UniqueEntityId): Promise<number> {
    const groups = await this.tx.client.transaction.groupBy({
      by: ['type'],
      where: { invoiceId: invoiceId.toValue(), workspaceId: workspaceId.toValue() },
      _sum: { amountInCents: true },
    });

    return groups.reduce((total, group) => {
      const value = group._sum.amountInCents ?? 0;

      return group.type === TransactionType.INCOME ? total - value : total + value;
    }, 0);
  }

  async save(invoice: Invoice): Promise<void> {
    await this.tx.client.invoice.update({
      where: { id: invoice.id.toValue() },
      data: {
        totalInCents: invoice.total.toCents(),
        status: invoice.status,
        paidWithTransactionId: invoice.paidWithTransactionId?.toValue() ?? null,
        paidAt: invoice.paidAt,
      },
    });
  }

  async findDueForClosingJob(today: CalendarDate, limit: number): Promise<Invoice[]> {
    const raws = await this.tx.client.invoice.findMany({
      where: { status: InvoiceStatus.OPEN, closingDate: { lt: today.toUtcDate() } },
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
      orderBy: { closingDate: 'asc' },
      take: limit,
    });

    return raws.map((raw) => toDomain(raw, raw.creditCard.account.workspace.baseCurrency));
  }

  async findDueForReminderJob(dueDate: CalendarDate): Promise<Invoice[]> {
    const raws = await this.tx.client.invoice.findMany({
      where: {
        status: InvoiceStatus.CLOSED,
        dueDate: dueDate.toUtcDate(),
        totalInCents: { gt: 0 },
      },
      include: { creditCard: { select: { account: { select: { workspace: { select: { baseCurrency: true } } } } } } },
    });

    return raws.map((raw) => toDomain(raw, raw.creditCard.account.workspace.baseCurrency));
  }

  async workspaceOf(invoiceId: UniqueEntityId): Promise<UniqueEntityId | null> {
    const raw = await this.tx.client.invoice.findUnique({
      where: { id: invoiceId.toValue() },
      select: { creditCard: { select: { account: { select: { workspaceId: true } } } } },
    });

    return raw ? new UniqueEntityId(raw.creditCard.account.workspaceId) : null;
  }
}
