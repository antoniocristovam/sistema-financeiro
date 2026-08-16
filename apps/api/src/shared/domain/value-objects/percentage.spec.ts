import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { Percentage } from './percentage';

const percentage = (basisPoints: number): Percentage => {
  const result = Percentage.fromBasisPoints(basisPoints);
  if (result.isLeft()) {
    throw new Error(`Percentual invalido no teste: ${basisPoints}`);
  }
  return result.value;
};

describe('Percentage', () => {
  it('guarda pontos-base, nao float', () => {
    expect(percentage(3333).basisPoints).toBe(3333);
    expect(percentage(3333).toPercent()).toBe(33.33);
    expect(percentage(3333).toString()).toBe('33,33%');
  });

  it('tres tercos em pontos-base fecham em 100%, o que em float nao acontece', () => {
    const sum = percentage(3333).basisPoints + percentage(3333).basisPoints + percentage(3334).basisPoints;

    expect(sum).toBe(10_000);
    // Em float, 33.33 * 3 nao chega a 100.
    expect(33.33 * 3).not.toBe(100);
  });

  it('converte de percentual da UI', () => {
    expect(Percentage.fromPercent(33.33).isRight()).toBe(true);
    expect((Percentage.fromPercent(33.33) as { value: Percentage }).value.basisPoints).toBe(3333);
    expect((Percentage.fromPercent(20) as { value: Percentage }).value.basisPoints).toBe(2000);
  });

  it('recusa valores fora de 0-100% e fracionarios em pontos-base', () => {
    expect(Percentage.fromBasisPoints(-1).isLeft()).toBe(true);
    expect(Percentage.fromBasisPoints(10_001).isLeft()).toBe(true);
    expect(Percentage.fromBasisPoints(33.33).isLeft()).toBe(true);
    expect(Percentage.fromPercent(Number.NaN).isLeft()).toBe(true);
  });

  it('aplica sobre dinheiro', () => {
    const salario = Money.fromCents(850_000, 'BRL');

    expect(percentage(2000).applyTo(salario).toCents()).toBe(170_000);
    expect(percentage(0).applyTo(salario).toCents()).toBe(0);
    expect(percentage(10_000).applyTo(salario).toCents()).toBe(850_000);
  });

  it('classifica os extremos', () => {
    expect(percentage(0).isZero()).toBe(true);
    expect(percentage(10_000).isFull()).toBe(true);
    expect(percentage(5000).isZero()).toBe(false);
  });
});
