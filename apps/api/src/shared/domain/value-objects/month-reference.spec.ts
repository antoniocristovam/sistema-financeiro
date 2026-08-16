import { describe, expect, it } from 'vitest';

import { CalendarDate } from './calendar-date';
import { MonthReference } from './month-reference';

const month = (value: string): MonthReference => {
  const result = MonthReference.create(value);
  if (result.isLeft()) {
    throw new Error(`Mes invalido no teste: ${value}`);
  }
  return result.value;
};

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) {
    throw new Error(`Data invalida no teste: ${value}`);
  }
  return result.value;
};

describe('MonthReference', () => {
  it('aceita YYYY-MM e recusa o resto', () => {
    expect(MonthReference.create('2026-03').isRight()).toBe(true);
    expect(MonthReference.create('2026-13').isLeft()).toBe(true);
    expect(MonthReference.create('2026-00').isLeft()).toBe(true);
    expect(MonthReference.create('2026-3').isLeft()).toBe(true);
    expect(MonthReference.create('2026-03-01').isLeft()).toBe(true);
  });

  it('nasce de uma data, ignorando o dia', () => {
    // E' exatamente o erro que este VO evita: comparar Date do dia 1 com Date
    // do dia 15 e concluir que sao meses diferentes.
    expect(MonthReference.fromDate(day('2026-03-01')).toString()).toBe('2026-03');
    expect(MonthReference.fromDate(day('2026-03-31')).toString()).toBe('2026-03');
    expect(
      MonthReference.fromDate(day('2026-03-01')).equals(MonthReference.fromDate(day('2026-03-31'))),
    ).toBe(true);
  });

  it('grava sempre o primeiro dia do mes', () => {
    expect(month('2026-03').toUtcDate().toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(month('2026-03').firstDay().toString()).toBe('2026-03-01');
  });

  it('sabe o ultimo dia, inclusive em fevereiro', () => {
    expect(month('2026-03').lastDay().toString()).toBe('2026-03-31');
    expect(month('2026-02').lastDay().toString()).toBe('2026-02-28');
    expect(month('2024-02').lastDay().toString()).toBe('2024-02-29');
    expect(month('2026-04').lastDay().toString()).toBe('2026-04-30');
  });

  it('navega entre meses atravessando o ano', () => {
    expect(month('2026-12').next().toString()).toBe('2027-01');
    expect(month('2026-01').previous().toString()).toBe('2025-12');
    expect(month('2026-11').add(3).toString()).toBe('2027-02');
    expect(month('2026-02').add(-3).toString()).toBe('2025-11');
  });

  it('conta meses entre competencias', () => {
    expect(month('2026-01').monthsUntil(month('2026-12'))).toBe(11);
    expect(month('2026-12').monthsUntil(month('2027-01'))).toBe(1);
    expect(month('2026-06').monthsUntil(month('2026-01'))).toBe(-5);
    expect(month('2026-06').monthsUntil(month('2026-06'))).toBe(0);
  });

  it('diz se contem uma data', () => {
    expect(month('2026-03').contains(day('2026-03-01'))).toBe(true);
    expect(month('2026-03').contains(day('2026-03-31'))).toBe(true);
    expect(month('2026-03').contains(day('2026-04-01'))).toBe(false);
    expect(month('2026-03').contains(day('2025-03-15'))).toBe(false);
  });

  it('ordena competencias', () => {
    expect(month('2026-01').isBefore(month('2026-02'))).toBe(true);
    expect(month('2027-01').isAfter(month('2026-12'))).toBe(true);
    expect(month('2026-01').compare(month('2026-01'))).toBe(0);
  });
});
