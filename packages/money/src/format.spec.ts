import { describe, expect, it } from 'vitest';

import { formatMoney, formatMoneyCompact, parseLocalizedDecimal } from './format.js';
import { Money } from './money.js';

/**
 * O `Intl` usa espaco NAO separavel (U+00A0) entre simbolo e numero. Normalizar
 * mantem o teste legivel sem esconder o comportamento real.
 */
const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/gu, ' ');

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');
const usd = (cents: number): Money => Money.fromCents(cents, 'USD');

describe('formatMoney', () => {
  it('formata em pt-BR', () => {
    expect(normalize(formatMoney(brl(123_456), { locale: 'pt-BR' }))).toBe('R$ 1.234,56');
    expect(normalize(formatMoney(brl(5), { locale: 'pt-BR' }))).toBe('R$ 0,05');
    expect(normalize(formatMoney(brl(-4210), { locale: 'pt-BR' }))).toBe('-R$ 42,10');
  });

  it('formata em en-US', () => {
    expect(normalize(formatMoney(usd(123_456), { locale: 'en-US' }))).toBe('$1,234.56');
  });

  it('separa a moeda do formato: o valor e do workspace, o formato e do usuario', () => {
    // Mesmo valor em dolar, lido por um brasileiro e por um americano.
    const value = usd(123_456);

    expect(normalize(formatMoney(value, { locale: 'pt-BR' }))).toBe('US$ 1.234,56');
    expect(normalize(formatMoney(value, { locale: 'en-US' }))).toBe('$1,234.56');
  });

  it('exibe codigo em vez de simbolo', () => {
    expect(normalize(formatMoney(brl(123_456), { locale: 'pt-BR', display: 'code' }))).toBe(
      'BRL 1.234,56',
    );
  });

  it('omite a moeda quando pedido', () => {
    expect(normalize(formatMoney(brl(123_456), { locale: 'pt-BR', display: 'none' }))).toBe(
      '1.234,56',
    );
  });

  it('esconde centavos redondos so quando pedido', () => {
    expect(normalize(formatMoney(brl(123_400), { locale: 'pt-BR', hideZeroCents: true }))).toBe(
      'R$ 1.234',
    );
    // Com centavo, continua mostrando -- nunca arredonda o que o usuario confere.
    expect(normalize(formatMoney(brl(123_456), { locale: 'pt-BR', hideZeroCents: true }))).toBe(
      'R$ 1.234,56',
    );
  });

  it('forca o sinal em positivo, mas nao no zero', () => {
    expect(normalize(formatMoney(brl(1000), { locale: 'pt-BR', alwaysShowSign: true }))).toBe(
      '+R$ 10,00',
    );
    expect(normalize(formatMoney(brl(-1000), { locale: 'pt-BR', alwaysShowSign: true }))).toBe(
      '-R$ 10,00',
    );
    expect(normalize(formatMoney(brl(0), { locale: 'pt-BR', alwaysShowSign: true }))).toBe(
      'R$ 0,00',
    );
  });

  it('reaproveita o formatter entre chamadas iguais', () => {
    // Sem cache, criar um Intl.NumberFormat por linha de extrato e' caro.
    const first = formatMoney(brl(100), { locale: 'pt-BR' });
    const second = formatMoney(brl(200), { locale: 'pt-BR' });

    expect(normalize(first)).toBe('R$ 1,00');
    expect(normalize(second)).toBe('R$ 2,00');
  });
});

describe('formatMoneyCompact', () => {
  it('resume valores grandes', () => {
    expect(normalize(formatMoneyCompact(brl(123_456_78), 'pt-BR'))).toMatch(/mil/);
    expect(normalize(formatMoneyCompact(usd(500_000_00), 'en-US'))).toBe('$500K');
  });
});

describe('parseLocalizedDecimal', () => {
  it('le o formato brasileiro', () => {
    expect(parseLocalizedDecimal('1.234,56', 'pt-BR')).toBe('1234.56');
    expect(parseLocalizedDecimal('0,05', 'pt-BR')).toBe('0.05');
    expect(parseLocalizedDecimal('-42,10', 'pt-BR')).toBe('-42.10');
  });

  it('le o valor com simbolo de moeda colado', () => {
    // "R$": o "R" e' letra, so o "$" e' simbolo de moeda -- o filtro precisa
    // descartar os dois.
    expect(parseLocalizedDecimal('R$ 1.234,56', 'pt-BR')).toBe('1234.56');
    expect(parseLocalizedDecimal('US$ 99,90', 'pt-BR')).toBe('99.90');
    expect(parseLocalizedDecimal('$1,234.56', 'en-US')).toBe('1234.56');
  });

  it('le o formato americano', () => {
    expect(parseLocalizedDecimal('1,234.56', 'en-US')).toBe('1234.56');
    expect(parseLocalizedDecimal('0.05', 'en-US')).toBe('0.05');
  });

  it('fecha o ciclo com formatMoney e Money.fromDecimal', () => {
    const original = brl(123_456);
    const rendered = formatMoney(original, { locale: 'pt-BR' });
    const parsed = parseLocalizedDecimal(rendered, 'pt-BR');

    expect(parsed).not.toBeNull();
    expect(Money.fromDecimal(parsed as string, 'BRL').equals(original)).toBe(true);
  });

  it('devolve null quando nao da para interpretar', () => {
    expect(parseLocalizedDecimal('', 'pt-BR')).toBeNull();
    expect(parseLocalizedDecimal('   ', 'pt-BR')).toBeNull();
    expect(parseLocalizedDecimal('abc', 'pt-BR')).toBeNull();
    expect(parseLocalizedDecimal('1,2,3', 'pt-BR')).toBeNull();
  });
});
