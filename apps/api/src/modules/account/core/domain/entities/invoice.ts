import { ApiErrorCode, InvoiceStatus } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { type Either, left, right } from '../../../../../shared/either';

export class InvoiceAlreadyPaidError extends DomainError {
  readonly code = ApiErrorCode.INVOICE_ALREADY_PAID;
  readonly message = 'Esta fatura ja foi paga.';
}

export class InvoiceNotClosedError extends DomainError {
  readonly code = ApiErrorCode.RESOURCE_CONFLICT;
  readonly message = 'A fatura ainda esta aberta. So e possivel pagar depois do fechamento.';
}

export interface InvoiceProps {
  creditCardId: UniqueEntityId;
  referenceMonth: MonthReference;
  closingDate: CalendarDate;
  dueDate: CalendarDate;
  total: Money;
  status: InvoiceStatus;
  paidWithTransactionId: UniqueEntityId | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fatura mensal de um cartao.
 *
 * Ciclo de vida: OPEN (recebendo compras) -> CLOSED (fechou, aguarda pagamento)
 * -> PAID (o pagamento debitou a conta corrente).
 *
 * O lancamento que de fato mexe no saldo e' o PAGAMENTO, nao as compras. Por
 * isso `paidWithTransactionId` aponta para a transacao na conta corrente.
 */
export class Invoice extends Entity<InvoiceProps> {
  static create(
    props: Optional<
      InvoiceProps,
      'total' | 'status' | 'paidWithTransactionId' | 'paidAt' | 'createdAt' | 'updatedAt'
    > & { currency?: string },
    id?: UniqueEntityId,
  ): Invoice {
    const now = new Date();

    return new Invoice(
      {
        creditCardId: props.creditCardId,
        referenceMonth: props.referenceMonth,
        closingDate: props.closingDate,
        dueDate: props.dueDate,
        total: props.total ?? Money.zero(props.currency ?? 'BRL'),
        status: props.status ?? InvoiceStatus.OPEN,
        paidWithTransactionId: props.paidWithTransactionId ?? null,
        paidAt: props.paidAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get creditCardId(): UniqueEntityId {
    return this.props.creditCardId;
  }

  get referenceMonth(): MonthReference {
    return this.props.referenceMonth;
  }

  get closingDate(): CalendarDate {
    return this.props.closingDate;
  }

  get dueDate(): CalendarDate {
    return this.props.dueDate;
  }

  get total(): Money {
    return this.props.total;
  }

  get status(): InvoiceStatus {
    return this.props.status;
  }

  get paidWithTransactionId(): UniqueEntityId | null {
    return this.props.paidWithTransactionId;
  }

  get paidAt(): Date | null {
    return this.props.paidAt;
  }

  isOpen(): boolean {
    return this.props.status === InvoiceStatus.OPEN;
  }

  isPaid(): boolean {
    return this.props.status === InvoiceStatus.PAID;
  }

  /** Vencida: fechada, no vermelho e passou da data. */
  isOverdue(today: CalendarDate): boolean {
    return !this.isPaid() && this.props.total.isPositive() && today.isAfter(this.props.dueDate);
  }

  /** Recalculado a partir dos itens, nunca somado incrementalmente. */
  setTotal(total: Money): void {
    this.props.total = total;
    this.touch();
  }

  close(): void {
    if (this.props.status === InvoiceStatus.OPEN) {
      this.props.status = InvoiceStatus.CLOSED;
      this.touch();
    }
  }

  /**
   * Marca como paga, apontando o lancamento que debitou a conta.
   *
   * Fatura aberta nao pode ser paga: o total ainda pode mudar ate o fechamento,
   * e pagar antes disso geraria diferenca entre o valor pago e o valor devido.
   */
  payWith(
    transactionId: UniqueEntityId,
    now: Date = new Date(),
  ): Either<InvoiceAlreadyPaidError | InvoiceNotClosedError, void> {
    if (this.isPaid()) {
      return left(new InvoiceAlreadyPaidError());
    }

    if (this.isOpen()) {
      return left(new InvoiceNotClosedError());
    }

    this.props.status = InvoiceStatus.PAID;
    this.props.paidWithTransactionId = transactionId;
    this.props.paidAt = now;
    this.touch();

    return right(undefined);
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
