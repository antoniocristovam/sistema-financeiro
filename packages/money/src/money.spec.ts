import { describe, expect, it } from 'vitest';

import { CurrencyMismatchError, InvalidCurrencyError, InvalidMoneyError } from './errors.js';
import { Money } from './money.js';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

describe('Money', () => {
  describe('construcao', () => {
    // O construtor e' privado (checagem de tipo), entao os unicos caminhos de
    // entrada sao os de baixo -- e todos terminam em inteiro de centavos.
    it('recusa centavo fracionario', () => {
      expect(() => Money.fromCents(10.5, 'BRL')).toThrow(InvalidMoneyError);
    });

    it('recusa valor fora do inteiro seguro', () => {
      expect(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 10, 'BRL')).toThrow(InvalidMoneyError);
    });

    it('normaliza o codigo da moeda', () => {
      expect(Money.fromCents(100, 'brl').currency).toBe('BRL');
      expect(Money.fromCents(100, ' usd ').currency).toBe('USD');
    });

    it('recusa moeda fora do ISO 4217', () => {
      expect(() => Money.fromCents(100, 'BR')).toThrow(InvalidCurrencyError);
      expect(() => Money.fromCents(100, 'REAL')).toThrow(InvalidCurrencyError);
      expect(() => Money.fromCents(100, '')).toThrow(InvalidCurrencyError);
    });

    it('recusa moeda que nem string e', () => {
      // O pacote e' consumido de JS tambem (seed, script, job): o tipo nao
      // protege sozinho.
      const notAString = null as unknown as string;

      expect(() => Money.fromCents(100, notAString)).toThrow(InvalidCurrencyError);
    });

    it('cria a partir de decimal sem erro de float', () => {
      expect(Money.fromDecimal('19.99', 'BRL').toCents()).toBe(1999);
      expect(Money.fromDecimal(19.99, 'BRL').toCents()).toBe(1999);
      expect(Money.fromDecimal(0.1 + 0.2, 'BRL').toCents()).toBe(30);
    });

    it('zero', () => {
      expect(Money.zero('BRL').toCents()).toBe(0);
      expect(Money.zero('BRL').isZero()).toBe(true);
    });
  });

  describe('imutabilidade', () => {
    it('operacao devolve nova instancia e nao altera a original', () => {
      const original = brl(1000);
      const result = original.plus(brl(500));

      expect(original.toCents()).toBe(1000);
      expect(result.toCents()).toBe(1500);
      expect(result).not.toBe(original);
    });

    it('a instancia e congelada', () => {
      expect(Object.isFrozen(brl(100))).toBe(true);
    });
  });

  describe('aritmetica', () => {
    it('soma e subtrai', () => {
      expect(brl(1000).plus(brl(250)).toCents()).toBe(1250);
      expect(brl(1000).minus(brl(250)).toCents()).toBe(750);
      expect(brl(100).minus(brl(300)).toCents()).toBe(-200);
    });

    it('recusa operacao entre moedas diferentes', () => {
      const real = Money.fromCents(100, 'BRL');
      const dolar = Money.fromCents(100, 'USD');

      expect(() => real.plus(dolar)).toThrow(CurrencyMismatchError);
      expect(() => real.minus(dolar)).toThrow(CurrencyMismatchError);
      expect(() => real.compare(dolar)).toThrow(CurrencyMismatchError);
    });

    it('multiplica arredondando meio para longe do zero', () => {
      expect(brl(33_333).times(3).toCents()).toBe(99_999);
      expect(brl(1).times(0.5).toCents()).toBe(1);
      expect(brl(-1).times(0.5).toCents()).toBe(-1);
      expect(brl(1000).times(1.1).toCents()).toBe(1100);
    });

    it('recusa fator invalido', () => {
      expect(() => brl(100).times(Number.NaN)).toThrow(InvalidMoneyError);
      expect(() => brl(100).percentage(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
    });

    it('calcula percentual em pontos-base', () => {
      expect(brl(10_000).percentage(1000).toCents()).toBe(1000); // 10%
      expect(brl(10_000).percentage(10_000).toCents()).toBe(10_000); // 100%
      expect(brl(10_000).percentage(3333).toCents()).toBe(3333); // 33,33%
      expect(brl(85_000).percentage(2000).toCents()).toBe(17_000); // meta de 20%
    });

    it('nega e tira o modulo', () => {
      expect(brl(1000).negate().toCents()).toBe(-1000);
      expect(brl(-1000).abs().toCents()).toBe(1000);
      expect(brl(1000).abs().toCents()).toBe(1000);
    });

    it('soma uma lista', () => {
      expect(Money.sum([brl(100), brl(250), brl(50)]).toCents()).toBe(400);
      expect(Money.sum([], 'BRL').toCents()).toBe(0);
    });

    it('recusa somar lista vazia sem moeda', () => {
      expect(() => Money.sum([])).toThrow(InvalidMoneyError);
    });
  });

  describe('rateio', () => {
    it('divide R$ 100,00 em tres partes que fecham exatamente', () => {
      const shares = brl(10_000).split(3);

      expect(shares.map((share) => share.toCents())).toEqual([3334, 3333, 3333]);
      expect(Money.sum(shares).equals(brl(10_000))).toBe(true);
    });

    it('rateia por pesos preservando a moeda', () => {
      const shares = brl(10_000).allocate([1, 3]);

      expect(shares.map((share) => share.toCents())).toEqual([2500, 7500]);
      expect(shares.every((share) => share.currency === 'BRL')).toBe(true);
    });

    it('a soma do rateio SEMPRE bate com o total', () => {
      for (const cents of [1, 7, 99, 100, 10_000, 123_457, 999_999]) {
        for (const parts of [2, 3, 5, 7]) {
          const shares = brl(cents).split(parts);
          expect(Money.sum(shares).toCents(), `${cents} em ${parts}`).toBe(cents);
        }
      }
    });
  });

  describe('comparacao', () => {
    it('compara valores', () => {
      expect(brl(100).equals(brl(100))).toBe(true);
      expect(brl(100).equals(Money.fromCents(100, 'USD'))).toBe(false);
      expect(brl(200).isGreaterThan(brl(100))).toBe(true);
      expect(brl(100).isGreaterThanOrEqual(brl(100))).toBe(true);
      expect(brl(50).isLessThan(brl(100))).toBe(true);
      expect(brl(100).isLessThanOrEqual(brl(100))).toBe(true);
    });

    it('serve direto no sort', () => {
      const sorted = [brl(300), brl(100), brl(200)].sort((a, b) => a.compare(b));

      expect(sorted.map((money) => money.toCents())).toEqual([100, 200, 300]);
    });

    it('classifica sinal', () => {
      expect(brl(0).isZero()).toBe(true);
      expect(brl(1).isPositive()).toBe(true);
      expect(brl(-1).isNegative()).toBe(true);
    });
  });

  describe('serializacao', () => {
    it('toJSON devolve centavos, nunca decimal', () => {
      expect(brl(123_456).toJSON()).toEqual({ amountInCents: 123_456, currency: 'BRL' });
      expect(JSON.parse(JSON.stringify(brl(1999)))).toEqual({
        amountInCents: 1999,
        currency: 'BRL',
      });
    });

    it('expoe decimal para exibicao', () => {
      expect(brl(123_456).toDecimal()).toBe(1234.56);
      expect(brl(123_456).toDecimalString()).toBe('1234.56');
      expect(brl(123_456).toString()).toBe('BRL 1234.56');
    });

    it('faz ida e volta por centavos sem perda', () => {
      const original = brl(123_456);
      const roundTripped = Money.fromCents(original.toJSON().amountInCents, original.currency);

      expect(roundTripped.equals(original)).toBe(true);
    });
  });
});
