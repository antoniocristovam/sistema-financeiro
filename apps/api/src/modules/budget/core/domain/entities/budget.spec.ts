import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { Budget } from './budget';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const workspaceId = new UniqueEntityId();
const categoryId = new UniqueEntityId();

const budget = (overrides = {}): Budget =>
  Budget.create({
    workspaceId,
    categoryId,
    referenceMonth: MonthReference.fromParts(2026, 3),
    limit: brl(90_000),
    ...overrides,
  });

describe('Budget', () => {
  it('nasce sem rollover', () => {
    expect(budget().rollover).toBe(false);
  });

  it('calcula o progresso do mes', () => {
    const alimentacao = budget();
    const progresso = alimentacao.progressWith(brl(76_500));

    expect(progresso.percent).toBe(85);
    expect(progresso.band).toBe('NEAR');
    expect(progresso.remaining.toCents()).toBe(13_500);
  });

  it('IGNORA a sobra herdada quando o rollover esta desligado', () => {
    // Passar o carryOver sem a flag inflaria o limite silenciosamente.
    const semRollover = budget({ rollover: false });
    const progresso = semRollover.progressWith(brl(95_000), brl(20_000));

    expect(progresso.effectiveLimit.toCents()).toBe(90_000);
    expect(progresso.isExceeded()).toBe(true);
  });

  it('soma a sobra herdada quando o rollover esta ligado', () => {
    const comRollover = budget({ rollover: true });
    const progresso = comRollover.progressWith(brl(95_000), brl(20_000));

    expect(progresso.effectiveLimit.toCents()).toBe(110_000);
    expect(progresso.isExceeded()).toBe(false);
  });

  it('copia para outro mes preservando limite e rollover', () => {
    // E' o "copiar orcamentos do mes anterior em um clique".
    const marco = budget({ rollover: true });
    const abril = marco.copyTo(MonthReference.fromParts(2026, 4));

    expect(abril.referenceMonth.toString()).toBe('2026-04');
    expect(abril.limit.toCents()).toBe(90_000);
    expect(abril.rollover).toBe(true);
    expect(abril.categoryId.toValue()).toBe(categoryId.toValue());
    // E' um orcamento NOVO, nao o mesmo movido de mes.
    expect(abril.id.toValue()).not.toBe(marco.id.toValue());
  });

  it('ajusta limite e rollover', () => {
    const alimentacao = budget();

    alimentacao.changeLimit(brl(120_000));
    alimentacao.setRollover(true);

    expect(alimentacao.limit.toCents()).toBe(120_000);
    expect(alimentacao.rollover).toBe(true);
  });
});
