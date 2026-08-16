import { ShareType } from '@finapp/contracts';
import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { InvalidSplitError, SplitDoesNotCloseError, SplitShares } from './split-shares';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const participants = (...keys: string[]): { key: string }[] => keys.map((key) => ({ key }));

const unwrap = (result: ReturnType<typeof SplitShares.compute>): SplitShares => {
  if (result.isLeft()) {
    throw new Error(`Rateio falhou: ${result.value.message}`);
  }
  return result.value;
};

describe('SplitShares', () => {
  describe('EQUAL', () => {
    it('distribui o centavo de resto em vez de descartar', () => {
      // O caso do documento: R$ 100,00 entre 3 pessoas.
      const shares = unwrap(
        SplitShares.compute(brl(10_000), ShareType.EQUAL, participants('ana', 'bruno', 'carla')),
      );

      expect(shares.shares.map((share) => share.amount.toCents())).toEqual([3334, 3333, 3333]);
      expect(shares.totalInCents()).toBe(10_000);
    });

    it('fecha exatamente para qualquer valor e qualquer numero de pessoas', () => {
      for (const cents of [1, 7, 99, 100, 10_000, 123_457, 999_999]) {
        for (const count of [2, 3, 5, 7]) {
          const keys = Array.from({ length: count }, (_, index) => `p${index}`);
          const shares = unwrap(SplitShares.compute(brl(cents), ShareType.EQUAL, participants(...keys)));

          expect(shares.totalInCents(), `${cents} entre ${count}`).toBe(cents);
        }
      }
    });

    it('preserva a chave de cada participante', () => {
      const shares = unwrap(
        SplitShares.compute(brl(9000), ShareType.EQUAL, participants('ana', 'bruno', 'carla')),
      );

      expect(shares.find('bruno')?.amount.toCents()).toBe(3000);
      expect(shares.find('ninguem')).toBeUndefined();
    });

    it('ignora shareValue informado', () => {
      const shares = unwrap(
        SplitShares.compute(brl(10_000), ShareType.EQUAL, [
          { key: 'ana', value: 9999 },
          { key: 'bruno', value: 1 },
        ]),
      );

      expect(shares.shares.map((share) => share.amount.toCents())).toEqual([5000, 5000]);
    });
  });

  describe('PERCENT', () => {
    it('rateia por pontos-base', () => {
      const shares = unwrap(
        SplitShares.compute(brl(10_000), ShareType.PERCENT, [
          { key: 'ana', value: 5000 },
          { key: 'bruno', value: 3000 },
          { key: 'carla', value: 2000 },
        ]),
      );

      expect(shares.shares.map((share) => share.amount.toCents())).toEqual([5000, 3000, 2000]);
      expect(shares.totalInCents()).toBe(10_000);
    });

    it('fecha com 33,33 / 33,33 / 33,34', () => {
      const shares = unwrap(
        SplitShares.compute(brl(10_000), ShareType.PERCENT, [
          { key: 'ana', value: 3333 },
          { key: 'bruno', value: 3333 },
          { key: 'carla', value: 3334 },
        ]),
      );

      expect(shares.totalInCents()).toBe(10_000);
    });

    it('nao perde centavo em percentual que nao divide exato', () => {
      // 1/3 de R$ 33,33: se cada parte fosse calculada isoladamente e somada,
      // a conta nao fecharia.
      const shares = unwrap(
        SplitShares.compute(brl(3333), ShareType.PERCENT, [
          { key: 'ana', value: 3333 },
          { key: 'bruno', value: 3333 },
          { key: 'carla', value: 3334 },
        ]),
      );

      expect(shares.totalInCents()).toBe(3333);
    });

    it('recusa percentuais que nao somam 100%', () => {
      const result = SplitShares.compute(brl(10_000), ShareType.PERCENT, [
        { key: 'ana', value: 3333 },
        { key: 'bruno', value: 3333 },
        { key: 'carla', value: 3333 },
      ]);

      expect(result.isLeft()).toBe(true);
      expect(result.isLeft() && result.value.message).toContain('99.99%');
    });

    it('recusa percentual ausente ou fracionario', () => {
      expect(
        SplitShares.compute(brl(10_000), ShareType.PERCENT, [
          { key: 'ana', value: 5000 },
          { key: 'bruno' },
        ]).isLeft(),
      ).toBe(true);

      expect(
        SplitShares.compute(brl(10_000), ShareType.PERCENT, [
          { key: 'ana', value: 3333.5 },
          { key: 'bruno', value: 6666.5 },
        ]).isLeft(),
      ).toBe(true);
    });
  });

  describe('FIXED', () => {
    it('aceita valores que fecham exatamente', () => {
      const shares = unwrap(
        SplitShares.compute(brl(10_000), ShareType.FIXED, [
          { key: 'ana', value: 3334 },
          { key: 'bruno', value: 3333 },
          { key: 'carla', value: 3333 },
        ]),
      );

      expect(shares.totalInCents()).toBe(10_000);
    });

    it('recusa quando falta centavo', () => {
      // Tres vezes 33,33 nao da 100,00 -- este e' o erro que o usuario comete.
      const result = SplitShares.compute(brl(10_000), ShareType.FIXED, [
        { key: 'ana', value: 3333 },
        { key: 'bruno', value: 3333 },
        { key: 'carla', value: 3333 },
      ]);

      expect(result.isLeft() && result.value).toBeInstanceOf(SplitDoesNotCloseError);
      expect(result.isLeft() && result.value.message).toContain('faltam 1 centavo');
    });

    it('recusa quando sobra', () => {
      const result = SplitShares.compute(brl(10_000), ShareType.FIXED, [
        { key: 'ana', value: 6000 },
        { key: 'bruno', value: 5000 },
      ]);

      expect(result.isLeft() && result.value.message).toContain('sobram 1000 centavo');
    });

    it('recusa parte zerada, negativa ou ausente', () => {
      for (const value of [0, -100, undefined]) {
        const result = SplitShares.compute(brl(10_000), ShareType.FIXED, [
          { key: 'ana', value: 10_000 },
          { key: 'bruno', value },
        ]);

        expect(result.isLeft(), `value=${String(value)}`).toBe(true);
      }
    });

    it('preserva a moeda do total', () => {
      const shares = unwrap(
        SplitShares.compute(Money.fromCents(10_000, 'USD'), ShareType.FIXED, [
          { key: 'ana', value: 5000 },
          { key: 'bruno', value: 5000 },
        ]),
      );

      expect(shares.shares.every((share) => share.amount.currency === 'USD')).toBe(true);
    });
  });

  describe('regras comuns', () => {
    it('exige pelo menos duas pessoas', () => {
      const result = SplitShares.compute(brl(10_000), ShareType.EQUAL, participants('ana'));

      expect(result.isLeft() && result.value).toBeInstanceOf(InvalidSplitError);
    });

    it('recusa valor zerado ou negativo', () => {
      expect(SplitShares.compute(brl(0), ShareType.EQUAL, participants('a', 'b')).isLeft()).toBe(true);
      expect(SplitShares.compute(brl(-100), ShareType.EQUAL, participants('a', 'b')).isLeft()).toBe(
        true,
      );
    });
  });
});
