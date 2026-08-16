import {
  createInstallmentPurchaseBodySchema,
  listInvoicesQuerySchema,
  payInvoiceBodySchema,
  type CreateInstallmentPurchaseBody,
  type CreditCardList,
  type InstallmentPurchaseResult,
  type Invoice as InvoiceContract,
  type InvoiceWithItems,
  type ListInvoicesQuery,
  type PayInvoiceBody,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../shared/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../../shared/decorators/current-workspace.decorator';
import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';
import {
  CreateInstallmentPurchaseUseCase,
  GetInvoiceUseCase,
  ListCreditCardsUseCase,
  ListInvoicesUseCase,
  PayInvoiceUseCase,
  type CreditCardSummaryResult,
} from '../../../account/core/application/use-cases/manage-invoices';
import { type InvoiceView } from '../../../account/core/domain/repositories/invoice-repository';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';

function invoiceToHttp(view: InvoiceView, today: CalendarDate): InvoiceContract {
  const { invoice } = view;

  return {
    id: invoice.id.toValue(),
    creditCardId: invoice.creditCardId.toValue(),
    cardName: view.cardName,
    referenceMonth: invoice.referenceMonth.toString(),
    closingDate: invoice.closingDate.toString(),
    dueDate: invoice.dueDate.toString(),
    totalInCents: invoice.total.toCents(),
    status: invoice.status,
    isOverdue: invoice.isOverdue(today),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    paidWithTransactionId: invoice.paidWithTransactionId?.toValue() ?? null,
    itemCount: view.itemCount,
  };
}

function cardToHttp(entry: CreditCardSummaryResult, today: CalendarDate) {
  const { account } = entry.card;
  const limitInCents = entry.card.creditCardLimitInCents ?? 0;

  return {
    accountId: account.id.toValue(),
    name: account.name,
    color: account.color,
    limitInCents,
    closingDay: entry.card.billingCycle!.closingDay,
    dueDay: entry.card.billingCycle!.dueDay,
    openInvoice: entry.openInvoice ? invoiceToHttp(entry.openInvoice, today) : null,
    unpaidInvoices: entry.unpaidInvoices.map((view) => invoiceToHttp(view, today)),
    usedLimitInCents: entry.usedLimitInCents,
    // Nunca negativo na apresentacao: limite estourado e' zero disponivel, e
    // "-R$ 300,00 disponivel" nao significa nada para quem le.
    availableLimitInCents: Math.max(0, limitInCents - entry.usedLimitInCents),
  };
}

/**
 * Cartoes e faturas.
 *
 * Nao existe rota para "criar compra no cartao": a compra e' um lancamento
 * comum em `POST /transactions` com a conta do cartao, e o roteamento para a
 * fatura acontece no caso de uso (regra 5). Duas portas de entrada para a mesma
 * coisa e' como uma delas acaba esquecendo a regra.
 *
 * A excecao e' a compra PARCELADA, que cria N lancamentos em N faturas de uma
 * vez -- essa tem forma propria.
 */
@Controller('cards')
export class CardsController {
  constructor(
    private readonly listCards: ListCreditCardsUseCase,
    private readonly listInvoices: ListInvoicesUseCase,
    private readonly getInvoice: GetInvoiceUseCase,
    private readonly payInvoice: PayInvoiceUseCase,
    private readonly createInstallments: CreateInstallmentPurchaseUseCase,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<CreditCardList> {
    const result = await this.listCards.execute({ workspaceId, userId: user.id });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const today = CalendarDate.fromUtcDate(new Date());
    const cards = result.value.map((entry) => cardToHttp(entry, today));

    return {
      cards,
      totalUsedInCents: cards.reduce((sum, card) => sum + card.usedLimitInCents, 0),
      totalLimitInCents: cards.reduce((sum, card) => sum + card.limitInCents, 0),
    };
  }

  @Get(':cardId/invoices')
  async invoices(
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<InvoiceContract[]> {
    const result = await this.listInvoices.execute({
      workspaceId,
      userId: user.id,
      cardAccountId: new UniqueEntityId(cardId),
      months: query.months,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const today = CalendarDate.fromUtcDate(new Date());

    return result.value.map((view) => invoiceToHttp(view, today));
  }

  @Get('invoices/:invoiceId')
  async invoice(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<InvoiceWithItems> {
    const result = await this.getInvoice.execute({
      workspaceId,
      userId: user.id,
      invoiceId: new UniqueEntityId(invoiceId),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const today = CalendarDate.fromUtcDate(new Date());

    return {
      ...invoiceToHttp(result.value.view, today),
      items: result.value.items.map((item) => ({
        id: item.id,
        date: item.date.toString(),
        description: item.description,
        amountInCents: item.amountInCents,
        category: item.category,
        installmentNumber: item.installmentNumber,
        installmentTotal: item.installmentTotal,
      })),
    };
  }

  @Post('invoices/:invoiceId/payment')
  async pay(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body(new ZodValidationPipe(payInvoiceBodySchema)) body: PayInvoiceBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<{ transactionId: string }> {
    const result = await this.payInvoice.execute({
      workspaceId,
      userId: user.id,
      invoiceId: new UniqueEntityId(invoiceId),
      fromAccountId: new UniqueEntityId(body.fromAccountId),
      ...(body.date ? { date: body.date } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value;
  }

  @Post('installments')
  async installments(
    @Body(new ZodValidationPipe(createInstallmentPurchaseBodySchema))
    body: CreateInstallmentPurchaseBody,
    @CurrentUser() user: CurrentUserData,
    @CurrentWorkspace() workspaceId: UniqueEntityId,
  ): Promise<InstallmentPurchaseResult> {
    const result = await this.createInstallments.execute({
      workspaceId,
      userId: user.id,
      cardAccountId: new UniqueEntityId(body.cardAccountId),
      categoryId: body.categoryId ? new UniqueEntityId(body.categoryId) : null,
      totalAmountInCents: body.totalAmountInCents,
      installments: body.installments,
      date: body.date,
      description: body.description,
      ...(body.notes ? { notes: body.notes } : {}),
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return {
      installmentGroupId: result.value.installmentGroupId,
      installments: result.value.installments.map((installment) => ({
        transactionId: installment.transactionId,
        number: installment.number,
        amountInCents: installment.amountInCents,
        date: installment.date.toString(),
        invoiceMonth: installment.invoiceMonth.toString(),
      })),
    };
  }
}
