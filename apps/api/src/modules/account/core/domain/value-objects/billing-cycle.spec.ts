import { describe, expect, it } from 'vitest';

import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { BillingCycle } from './billing-cycle';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const cycle = (closingDay: number, dueDay: number): BillingCycle => {
  const result = BillingCycle.create(closingDay, dueDay);
  if (result.isLeft()) throw new Error('Ciclo invalido no teste');
  return result.value;
};

describe('BillingCycle', () => {
  describe('criacao', () => {
    it('recusa dias fora de 1-31', () => {
      expect(BillingCycle.create(0, 10).isLeft()).toBe(true);
      expect(BillingCycle.create(32, 10).isLeft()).toBe(true);
      expect(BillingCycle.create(10, 0).isLeft()).toBe(true);
      expect(BillingCycle.create(10, 32).isLeft()).toBe(true);
      expect(BillingCycle.create(20.5, 28).isLeft()).toBe(true);
    });
  });

  describe('em que fatura a compra cai', () => {
    // Cartao classico: fecha dia 20, vence dia 28 do mesmo mes.
    const fecha20vence28 = cycle(20, 28);

    it('compra ANTES do fechamento cai na fatura do mes', () => {
      const window = fecha20vence28.invoiceFor(day('2026-03-15'));

      expect(window.referenceMonth.toString()).toBe('2026-03');
      expect(window.closingDate.toString()).toBe('2026-03-20');
      expect(window.dueDate.toString()).toBe('2026-03-28');
    });

    it('compra NO DIA do fechamento ainda entra nessa fatura', () => {
      // Convencao escolhida: o dia do fechamento e' o ultimo incluido.
      const window = fecha20vence28.invoiceFor(day('2026-03-20'));

      expect(window.referenceMonth.toString()).toBe('2026-03');
    });

    it('compra DEPOIS do fechamento cai na fatura seguinte', () => {
      // Este e' o coracao da regra 5: comprar dia 21 nao entra na fatura que
      // fechou ontem.
      const window = fecha20vence28.invoiceFor(day('2026-03-21'));

      expect(window.referenceMonth.toString()).toBe('2026-04');
      expect(window.closingDate.toString()).toBe('2026-04-20');
      expect(window.dueDate.toString()).toBe('2026-04-28');
    });

    it('compra no fim de dezembro cai na fatura de janeiro do ano seguinte', () => {
      const window = fecha20vence28.invoiceFor(day('2026-12-28'));

      expect(window.referenceMonth.toString()).toBe('2027-01');
      expect(window.dueDate.toString()).toBe('2027-01-28');
    });
  });

  describe('vencimento no mes seguinte ao fechamento', () => {
    // Fecha dia 28, vence dia 5: o vencimento so pode ser no mes seguinte.
    const fecha28vence5 = cycle(28, 5);

    it('joga o vencimento para o mes seguinte quando dueDay <= closingDay', () => {
      const window = fecha28vence5.invoiceFor(day('2026-03-10'));

      expect(window.closingDate.toString()).toBe('2026-03-28');
      expect(window.dueDate.toString()).toBe('2026-04-05');
    });

    it('atravessa a virada do ano', () => {
      const window = fecha28vence5.invoiceFor(day('2026-12-10'));

      expect(window.closingDate.toString()).toBe('2026-12-28');
      expect(window.dueDate.toString()).toBe('2027-01-05');
    });

    it('trata dueDay igual a closingDay como mes seguinte', () => {
      const mesmoDia = cycle(15, 15);
      const window = mesmoDia.invoiceFor(day('2026-03-10'));

      expect(window.closingDate.toString()).toBe('2026-03-15');
      expect(window.dueDate.toString()).toBe('2026-04-15');
    });
  });

  describe('mes curto', () => {
    // Fecha dia 31: fevereiro nao tem dia 31, e a fatura nao pode deixar de existir.
    const fecha31vence10 = cycle(31, 10);

    it('ajusta o fechamento para o ultimo dia do mes', () => {
      expect(fecha31vence10.windowFor(MonthReference.fromParts(2026, 2)).closingDate.toString()).toBe(
        '2026-02-28',
      );
      expect(fecha31vence10.windowFor(MonthReference.fromParts(2024, 2)).closingDate.toString()).toBe(
        '2024-02-29',
      );
      expect(fecha31vence10.windowFor(MonthReference.fromParts(2026, 4)).closingDate.toString()).toBe(
        '2026-04-30',
      );
    });

    it('nao acumula o ajuste: marco volta a fechar no dia 31', () => {
      expect(fecha31vence10.windowFor(MonthReference.fromParts(2026, 3)).closingDate.toString()).toBe(
        '2026-03-31',
      );
    });

    it('compra em 28/02 com fechamento dia 31 entra na fatura de fevereiro', () => {
      const window = fecha31vence10.invoiceFor(day('2026-02-28'));

      expect(window.referenceMonth.toString()).toBe('2026-02');
    });
  });

  describe('periodo da fatura', () => {
    it('comeca no dia seguinte ao fechamento anterior', () => {
      const window = cycle(20, 28).windowFor(MonthReference.fromParts(2026, 3));

      expect(window.periodStart.toString()).toBe('2026-02-21');
      expect(window.closingDate.toString()).toBe('2026-03-20');
    });

    it('nao deixa buraco nem sobreposicao entre faturas consecutivas', () => {
      const billing = cycle(20, 28);
      const marco = billing.windowFor(MonthReference.fromParts(2026, 3));
      const abril = billing.windowFor(MonthReference.fromParts(2026, 4));

      // O dia seguinte ao fechamento de marco e' exatamente o inicio de abril.
      expect(marco.closingDate.addDays(1).toString()).toBe(abril.periodStart.toString());
    });
  });

  describe('estado da fatura', () => {
    const billing = cycle(20, 28);
    const window = billing.windowFor(MonthReference.fromParts(2026, 3));

    it('sabe quando fechou', () => {
      expect(billing.isClosed(window, day('2026-03-20'))).toBe(false);
      expect(billing.isClosed(window, day('2026-03-21'))).toBe(true);
    });

    it('sabe quando venceu', () => {
      expect(billing.isOverdue(window, day('2026-03-28'))).toBe(false);
      expect(billing.isOverdue(window, day('2026-03-29'))).toBe(true);
    });
  });
});
