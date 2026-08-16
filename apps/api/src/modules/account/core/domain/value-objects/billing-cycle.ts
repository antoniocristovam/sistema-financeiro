import { type Either, left, right } from '../../../../../shared/either';
import { InvalidValueError } from '../../../../../shared/domain/errors/common-errors';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { ValueObject } from '../../../../../shared/domain/value-object';

interface BillingCycleProps {
  closingDay: number;
  dueDay: number;
}

/** Em que fatura uma compra cai, e quando essa fatura fecha e vence. */
export interface InvoiceWindow {
  referenceMonth: MonthReference;
  closingDate: CalendarDate;
  dueDate: CalendarDate;
  /** Primeiro dia que ainda entra nesta fatura. */
  periodStart: CalendarDate;
}

/**
 * Ciclo de faturamento de um cartao de credito.
 *
 * Regra 5 do dominio: compra no cartao NAO debita a conta na data da compra.
 * Ela entra na fatura conforme o fechamento; o saldo da conta so muda quando a
 * fatura e' paga.
 *
 * Convencoes, ambas escolhidas de proposito porque nao ha resposta universal:
 *
 * - O dia do FECHAMENTO ainda entra na fatura. Compra em 20/03 com fechamento
 *   dia 20 cai na fatura que fecha em 20/03, nao na seguinte.
 * - Se `dueDay` for menor ou igual ao `closingDay`, o vencimento cai no mes
 *   SEGUINTE ao fechamento (fecha 28/03, vence 05/04). Se for maior, cai no
 *   mesmo mes (fecha 20/03, vence 28/03).
 *
 * Dia 31 em mes curto e' ajustado para o ultimo dia disponivel -- fevereiro nao
 * tem dia 31, e a fatura nao pode simplesmente deixar de existir.
 */
export class BillingCycle extends ValueObject<BillingCycleProps> {
  private constructor(props: BillingCycleProps) {
    super(props);
  }

  static create(
    closingDay: number,
    dueDay: number,
  ): Either<InvalidValueError, BillingCycle> {
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
      return left(new InvalidValueError('Dia de fechamento precisa estar entre 1 e 31.', 'closingDay'));
    }

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      return left(new InvalidValueError('Dia de vencimento precisa estar entre 1 e 31.', 'dueDay'));
    }

    return right(new BillingCycle({ closingDay, dueDay }));
  }

  get closingDay(): number {
    return this.props.closingDay;
  }

  get dueDay(): number {
    return this.props.dueDay;
  }

  /** Em qual fatura esta compra cai. */
  invoiceFor(purchaseDate: CalendarDate): InvoiceWindow {
    const closingThisMonth = CalendarDate.clamped(
      purchaseDate.year,
      purchaseDate.month,
      this.props.closingDay,
    );

    // Depois do fechamento, a compra ja pertence ao ciclo seguinte.
    const monthOffset = purchaseDate.isSameOrBefore(closingThisMonth) ? 0 : 1;

    return this.windowFor(MonthReference.fromDate(purchaseDate).add(monthOffset));
  }

  /** A fatura de um mes de competencia, independente de compra. */
  windowFor(referenceMonth: MonthReference): InvoiceWindow {
    const closingDate = CalendarDate.clamped(
      referenceMonth.year,
      referenceMonth.month,
      this.props.closingDay,
    );

    // Vencimento antes ou no mesmo dia do fechamento so pode ser no mes seguinte.
    const dueMonthOffset = this.props.dueDay > this.props.closingDay ? 0 : 1;
    const dueDate = CalendarDate.clamped(
      referenceMonth.year,
      referenceMonth.month + dueMonthOffset,
      this.props.dueDay,
    );

    // O periodo comeca no dia seguinte ao fechamento anterior.
    const previousClosing = CalendarDate.clamped(
      referenceMonth.year,
      referenceMonth.month - 1,
      this.props.closingDay,
    );

    return {
      referenceMonth,
      closingDate,
      dueDate,
      periodStart: previousClosing.addDays(1),
    };
  }

  /** Fatura aberta em uma data qualquer -- a que ainda esta recebendo compras. */
  openInvoiceAt(date: CalendarDate): InvoiceWindow {
    return this.invoiceFor(date);
  }

  isClosed(window: InvoiceWindow, today: CalendarDate): boolean {
    return today.isAfter(window.closingDate);
  }

  isOverdue(window: InvoiceWindow, today: CalendarDate): boolean {
    return today.isAfter(window.dueDate);
  }
}
