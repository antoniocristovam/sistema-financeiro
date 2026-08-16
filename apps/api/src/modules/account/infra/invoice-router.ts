import { AccountType, InvoiceStatus } from '@finapp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@finapp/money';

import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { UniqueEntityId } from '../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../shared/domain/value-objects/calendar-date';
import { type InvoiceRouter } from '../../transaction/core/application/ports/invoice-router';
import { Invoice } from '../core/domain/entities/invoice';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../core/domain/repositories/account-repository';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from '../core/domain/repositories/invoice-repository';

/**
 * Implementacao do roteamento de compras para faturas (regra 5).
 *
 * Mora no modulo de contas porque e' aqui que fatura e ciclo de faturamento
 * existem. O modulo de lancamentos so conhece a porta.
 */
@Injectable()
export class BillingCycleInvoiceRouter implements InvoiceRouter {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async routeFor(
    workspaceId: UniqueEntityId,
    accountId: UniqueEntityId,
    date: CalendarDate,
  ): Promise<UniqueEntityId | null> {
    const account = await this.accounts.findById(workspaceId, accountId);

    // Caminho de toda despesa comum: nao e' cartao, nao ha fatura.
    if (!account || account.account.type !== AccountType.CREDIT_CARD || !account.billingCycle) {
      return null;
    }

    const currency = account.account.initialBalance.currency;
    let window = account.billingCycle.invoiceFor(date);
    let invoice = await this.invoices.findByMonth(
      workspaceId,
      accountId,
      window.referenceMonth,
    );

    /*
     * Compra lancada com data antiga, cujo ciclo ja foi PAGO.
     *
     * Ela vai para a fatura aberta de hoje, e nao para a paga. Mexer no total
     * de uma fatura ja quitada faria o valor pago deixar de bater com o valor
     * devido -- a divergencia ficaria para sempre, sem nada que a explique. A
     * fatura fechada e ainda NAO paga continua aceitando: ela ainda e' devida.
     */
    if (invoice?.isPaid()) {
      window = account.billingCycle.openInvoiceAt(
        CalendarDate.fromUtcDate(this.clock.now()),
      );
      invoice = await this.invoices.findByMonth(workspaceId, accountId, window.referenceMonth);
    }

    if (invoice) {
      return invoice.id;
    }

    // A fatura nasce da primeira compra do ciclo.
    const created = await this.invoices.ensureForMonth(
      Invoice.create({
        creditCardId: accountId,
        referenceMonth: window.referenceMonth,
        closingDate: window.closingDate,
        dueDate: window.dueDate,
        total: Money.fromCents(0, currency),
      }),
    );

    return created.id;
  }

  async refresh(workspaceId: UniqueEntityId, invoiceId: UniqueEntityId): Promise<void> {
    const invoice = await this.invoices.findById(workspaceId, invoiceId);

    if (!invoice || invoice.status === InvoiceStatus.PAID) {
      // Fatura paga nao muda de valor: o que foi cobrado foi cobrado.
      return;
    }

    invoice.setTotal(
      Money.fromCents(
        await this.invoices.sumItems(workspaceId, invoiceId),
        invoice.total.currency,
      ),
    );

    await this.invoices.save(invoice);
  }
}
