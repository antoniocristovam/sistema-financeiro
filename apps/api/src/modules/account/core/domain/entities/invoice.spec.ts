import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { BillingCycle } from '../value-objects/billing-cycle';
import { Invoice, InvoiceAlreadyPaidError, InvoiceNotClosedError } from './invoice';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const creditCardId = new UniqueEntityId();

const invoice = (overrides = {}): Invoice => {
  const cycleResult = BillingCycle.create(20, 28);
  if (cycleResult.isLeft()) throw new Error('ciclo invalido');

  const window = cycleResult.value.windowFor(MonthReference.fromParts(2026, 3));

  return Invoice.create({
    creditCardId,
    referenceMonth: window.referenceMonth,
    closingDate: window.closingDate,
    dueDate: window.dueDate,
    ...overrides,
  });
};

describe('Invoice', () => {
  it('nasce aberta e zerada', () => {
    const fatura = invoice();

    expect(fatura.isOpen()).toBe(true);
    expect(fatura.total.toCents()).toBe(0);
    expect(fatura.paidWithTransactionId).toBeNull();
  });

  it('recalcula o total a partir dos itens', () => {
    const fatura = invoice();
    fatura.setTotal(brl(45_590));

    expect(fatura.total.toCents()).toBe(45_590);
  });

  describe('pagamento', () => {
    it('recusa pagar fatura ABERTA', () => {
      // O total ainda pode mudar ate o fechamento; pagar antes geraria
      // diferenca entre o valor pago e o devido.
      const fatura = invoice();
      const result = fatura.payWith(new UniqueEntityId());

      expect(result.isLeft() && result.value).toBeInstanceOf(InvoiceNotClosedError);
      expect(fatura.isPaid()).toBe(false);
    });

    it('paga depois do fechamento, apontando o lancamento que debitou a conta', () => {
      // Regra 5: quem move o saldo e' o pagamento, nao as compras.
      const fatura = invoice();
      const pagamentoId = new UniqueEntityId();

      fatura.setTotal(brl(45_590));
      fatura.close();

      const result = fatura.payWith(pagamentoId);

      expect(result.isRight()).toBe(true);
      expect(fatura.isPaid()).toBe(true);
      expect(fatura.paidWithTransactionId?.toValue()).toBe(pagamentoId.toValue());
      expect(fatura.paidAt).not.toBeNull();
    });

    it('recusa pagar duas vezes', () => {
      const fatura = invoice();
      fatura.close();
      fatura.payWith(new UniqueEntityId());

      const segundo = fatura.payWith(new UniqueEntityId());

      expect(segundo.isLeft() && segundo.value).toBeInstanceOf(InvoiceAlreadyPaidError);
    });
  });

  describe('fechamento', () => {
    it('fecha uma vez so', () => {
      const fatura = invoice();

      fatura.close();
      expect(fatura.status).toBe('CLOSED');

      fatura.close();
      expect(fatura.status).toBe('CLOSED');
    });

    it('nao reabre fatura paga', () => {
      const fatura = invoice();
      fatura.close();
      fatura.payWith(new UniqueEntityId());

      fatura.close();

      expect(fatura.status).toBe('PAID');
    });
  });

  describe('atraso', () => {
    it('esta vencida quando passou do prazo com saldo devedor', () => {
      const fatura = invoice();
      fatura.setTotal(brl(45_590));
      fatura.close();

      expect(fatura.isOverdue(day('2026-03-28'))).toBe(false);
      expect(fatura.isOverdue(day('2026-03-29'))).toBe(true);
    });

    it('fatura paga nunca esta vencida', () => {
      const fatura = invoice();
      fatura.setTotal(brl(45_590));
      fatura.close();
      fatura.payWith(new UniqueEntityId());

      expect(fatura.isOverdue(day('2026-04-30'))).toBe(false);
    });

    it('fatura zerada nao vence', () => {
      const fatura = invoice();
      fatura.close();

      expect(fatura.isOverdue(day('2026-04-30'))).toBe(false);
    });
  });
});
