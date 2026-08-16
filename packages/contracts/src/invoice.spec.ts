import { describe, expect, it } from 'vitest';

import { createInstallmentPurchaseBodySchema, splitInstallments } from './index.js';

describe('splitInstallments', () => {
  /*
   * O centavo que some.
   *
   * R$ 100,00 em 3x nao da 33,33 tres vezes -- isso seria R$ 99,99. O resto vai
   * para as primeiras parcelas, que e' a convencao das maquininhas.
   */
  it('distribui o resto nas primeiras parcelas', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
  });

  it('a soma fecha EXATAMENTE com o total', () => {
    for (const total of [1, 7, 99, 10_000, 123_457, 999_999]) {
      for (const parcelas of [2, 3, 6, 7, 12, 48]) {
        const soma = splitInstallments(total, parcelas).reduce((a, b) => a + b, 0);

        expect(soma).toBe(total);
      }
    }
  });

  it('devolve uma parcela por numero pedido', () => {
    expect(splitInstallments(10_000, 12)).toHaveLength(12);
  });

  it('divisao exata nao inventa diferenca', () => {
    expect(splitInstallments(12_000, 12)).toEqual(Array.from({ length: 12 }, () => 1_000));
  });

  it('todas as parcelas sao inteiras', () => {
    expect(splitInstallments(10_000, 7).every(Number.isInteger)).toBe(true);
  });

  it('total menor que o numero de parcelas ainda fecha', () => {
    // 2 centavos em 3x: duas parcelas de 1 e uma de 0. Estranho, mas a soma
    // fecha -- e recusar isso e' decisao do caso de uso, nao da aritmetica.
    expect(splitInstallments(2, 3)).toEqual([1, 1, 0]);
  });
});

describe('createInstallmentPurchaseBodySchema', () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    createInstallmentPurchaseBodySchema.safeParse({
      cardAccountId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      totalAmountInCents: 120_000,
      installments: 12,
      date: '2026-03-15',
      description: 'Geladeira',
      ...overrides,
    });

  it('aceita uma compra parcelada valida', () => {
    expect(body().success).toBe(true);
  });

  it('recusa 1x: isso e uma compra a vista', () => {
    expect(body({ installments: 1 }).success).toBe(false);
  });

  it('recusa parcelamento absurdo', () => {
    expect(body({ installments: 60 }).success).toBe(false);
  });

  it('recusa valor zero ou negativo', () => {
    expect(body({ totalAmountInCents: 0 }).success).toBe(false);
    expect(body({ totalAmountInCents: -100 }).success).toBe(false);
  });
});
