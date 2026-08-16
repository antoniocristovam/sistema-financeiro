import { describe, expect, it } from 'vitest';

import { InvalidMoneyError } from './errors.js';
import { centsToDecimalString, decimalToCents, roundHalfAwayFromZero } from './parse.js';

describe('decimalToCents', () => {
  it('converte os casos comuns', () => {
    expect(decimalToCents('0')).toBe(0);
    expect(decimalToCents('1')).toBe(100);
    expect(decimalToCents('19.99')).toBe(1999);
    expect(decimalToCents('1234.56')).toBe(123_456);
    expect(decimalToCents('-42.10')).toBe(-4210);
    expect(decimalToCents('+7.5')).toBe(750);
  });

  it('nao erra por ponto flutuante', () => {
    // O classico: 19.99 * 100 da 1998.9999999999998 em float.
    expect(decimalToCents(19.99)).toBe(1999);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
    expect(decimalToCents(1.005)).toBe(101);
    expect(decimalToCents(-1.005)).toBe(-101);
    expect(decimalToCents(8.29)).toBe(829);
    expect(decimalToCents(1.145)).toBe(115);
  });

  it('arredonda a partir da terceira casa, meio para longe do zero', () => {
    expect(decimalToCents('1.004')).toBe(100);
    expect(decimalToCents('1.005')).toBe(101);
    expect(decimalToCents('1.009')).toBe(101);
    expect(decimalToCents('-1.004')).toBe(-100);
    expect(decimalToCents('-1.009')).toBe(-101);
  });

  it('aceita notacao cientifica sem virar NaN', () => {
    expect(decimalToCents(1e-7)).toBe(0);
    expect(decimalToCents(1e3)).toBe(100_000);
  });

  it('aceita formas abreviadas', () => {
    expect(decimalToCents('.5')).toBe(50);
    expect(decimalToCents('5.')).toBe(500);
    expect(decimalToCents('  12.34  ')).toBe(1234);
  });

  it('recusa entrada que nao representa numero', () => {
    expect(() => decimalToCents('')).toThrow(InvalidMoneyError);
    expect(() => decimalToCents('abc')).toThrow(InvalidMoneyError);
    expect(() => decimalToCents('1,50')).toThrow(InvalidMoneyError);
    expect(() => decimalToCents('.')).toThrow(InvalidMoneyError);
    expect(() => decimalToCents(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => decimalToCents(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
  });

  it('recusa valor grande demais para inteiro seguro', () => {
    expect(() => decimalToCents('999999999999999999.99')).toThrow(InvalidMoneyError);
  });
});

describe('centsToDecimalString', () => {
  it('formata sem separador de milhar', () => {
    expect(centsToDecimalString(0)).toBe('0.00');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(50)).toBe('0.50');
    expect(centsToDecimalString(1999)).toBe('19.99');
    expect(centsToDecimalString(123_456)).toBe('1234.56');
    expect(centsToDecimalString(-5)).toBe('-0.05');
  });

  it('faz ida e volta com decimalToCents', () => {
    for (const cents of [0, 1, 99, 100, 4210, -4210, 123_456, -1]) {
      expect(decimalToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});

describe('roundHalfAwayFromZero', () => {
  it('arredonda o negativo para o lado certo', () => {
    // Math.round(-2.5) da -2, o que faz despesa e estorno nao se cancelarem.
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });
});
