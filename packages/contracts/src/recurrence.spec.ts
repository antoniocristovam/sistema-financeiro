import { describe, expect, it } from 'vitest';

import { RecurrenceFrequency, TransactionType } from './enums.js';
import {
  createRecurrenceBodySchema,
  monthlyEquivalentInCents,
  notificationDedupeKey,
} from './index.js';
import { NotificationType } from './enums.js';

const template = {
  type: TransactionType.EXPENSE,
  accountId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  amountInCents: 210_000,
  description: 'Aluguel',
};

function body(overrides: Record<string, unknown>) {
  return createRecurrenceBodySchema.safeParse({
    name: 'Aluguel',
    template,
    startDate: '2026-01-10',
    ...overrides,
  });
}

describe('createRecurrenceBodySchema', () => {
  it('deriva os campos opcionais da periodicidade', () => {
    const result = body({ frequency: RecurrenceFrequency.MONTHLY });

    expect(result.success).toBe(true);
    expect(result.success && result.data.interval).toBe(1);
    expect(result.success && result.data.dayOfMonth).toBeNull();
    expect(result.success && result.data.reminderDaysBefore).toBeNull();
  });

  it('recusa dia do mes em repeticao semanal', () => {
    const result = body({ frequency: RecurrenceFrequency.WEEKLY, dayOfMonth: 10 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['dayOfMonth']);
  });

  it('recusa dia da semana em repeticao mensal', () => {
    const result = body({ frequency: RecurrenceFrequency.MONTHLY, weekday: 2 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['weekday']);
  });

  it('recusa mes do ano em repeticao mensal, mas aceita em anual', () => {
    expect(body({ frequency: RecurrenceFrequency.MONTHLY, monthOfYear: 3 }).success).toBe(false);
    expect(body({ frequency: RecurrenceFrequency.YEARLY, monthOfYear: 3 }).success).toBe(true);
  });

  it('recusa data final antes da inicial', () => {
    const result = body({ frequency: RecurrenceFrequency.MONTHLY, endDate: '2025-12-31' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['endDate']);
  });

  it('nao aceita transferencia como template', () => {
    const result = body({
      frequency: RecurrenceFrequency.MONTHLY,
      template: { ...template, type: TransactionType.TRANSFER },
    });

    expect(result.success).toBe(false);
  });
});

describe('monthlyEquivalentInCents', () => {
  /*
   * A conta que mais erra na mao: semanal NAO e' 4x por mes.
   *
   * R$ 50 por semana sao R$ 216,67 por mes (52/12), nao R$ 200. Com o fator 4,
   * o painel de comprometimento subestimaria quase um mes inteiro por ano.
   */
  it('normaliza semanal por 52/12, nao por 4', () => {
    expect(monthlyEquivalentInCents(5_000, RecurrenceFrequency.WEEKLY, 1)).toBe(21_667);
  });

  it('divide pelo intervalo: bimestral compromete metade por mes', () => {
    expect(monthlyEquivalentInCents(20_000, RecurrenceFrequency.MONTHLY, 2)).toBe(10_000);
  });

  it('espalha a anual pelos doze meses', () => {
    expect(monthlyEquivalentInCents(120_000, RecurrenceFrequency.YEARLY, 1)).toBe(10_000);
  });

  it('devolve centavos inteiros mesmo quando a divisao nao fecha', () => {
    const value = monthlyEquivalentInCents(10_000, RecurrenceFrequency.YEARLY, 1);

    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(833);
  });
});

describe('notificationDedupeKey', () => {
  it('e deterministica para o mesmo evento', () => {
    const first = notificationDedupeKey(NotificationType.RECURRENCE_DUE_SOON, 'rec-1', '2026-03-10');
    const second = notificationDedupeKey(NotificationType.RECURRENCE_DUE_SOON, 'rec-1', '2026-03-10');

    expect(first).toBe(second);
  });

  it('separa eventos diferentes', () => {
    const march = notificationDedupeKey(NotificationType.BUDGET_THRESHOLD_REACHED, 'b-1', '2026-03', 80);
    const april = notificationDedupeKey(NotificationType.BUDGET_THRESHOLD_REACHED, 'b-1', '2026-04', 80);
    const other = notificationDedupeKey(NotificationType.BUDGET_THRESHOLD_REACHED, 'b-1', '2026-03', 100);

    expect(new Set([march, april, other]).size).toBe(3);
  });
});
