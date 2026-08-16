import { describe, expect, it } from 'vitest';

import {
  calendarDateToUtc,
  monthReferenceToUtc,
  utcToCalendarDate,
  utcToMonthReference,
  zAmountInCents,
  zBasisPoints,
  zCalendarDate,
  zCurrencyCode,
  zEmail,
  zMonthReference,
  zPassword,
} from './primitives.js';

describe('zPassword', () => {
  it('aceita senha com 8+ caracteres, maiuscula e numero', () => {
    expect(zPassword.safeParse('Finapp@123').success).toBe(true);
    expect(zPassword.safeParse('Abcdefg1').success).toBe(true);
  });

  it('diz exatamente o que falta', () => {
    const short = zPassword.safeParse('Ab1');
    const noUpper = zPassword.safeParse('abcdefg1');
    const noDigit = zPassword.safeParse('Abcdefgh');

    expect(short.success).toBe(false);
    expect(noUpper.error?.issues[0]?.message).toMatch(/maiuscula/);
    expect(noDigit.error?.issues[0]?.message).toMatch(/numero/);
  });

  it('lista todos os problemas de uma vez, nao um por vez', () => {
    const result = zPassword.safeParse('abc');

    expect(result.success).toBe(false);
    // Comprimento + maiuscula + numero: o usuario corrige tudo numa tentativa.
    expect(result.error?.issues).toHaveLength(3);
  });
});

describe('zEmail', () => {
  it('normaliza para minusculo e sem espaco', () => {
    expect(zEmail.parse('  Ana@Finapp.Local ')).toBe('ana@finapp.local');
  });

  it('recusa e-mail invalido', () => {
    expect(zEmail.safeParse('ana@').success).toBe(false);
    expect(zEmail.safeParse('sem-arroba').success).toBe(false);
  });
});

describe('zCalendarDate', () => {
  it('aceita dia real', () => {
    expect(zCalendarDate.safeParse('2026-03-15').success).toBe(true);
    expect(zCalendarDate.safeParse('2024-02-29').success).toBe(true); // bissexto
  });

  it('recusa dia que nao existe no calendario', () => {
    // Passa pelo regex e mesmo assim precisa cair.
    expect(zCalendarDate.safeParse('2026-02-30').success).toBe(false);
    expect(zCalendarDate.safeParse('2026-13-01').success).toBe(false);
    expect(zCalendarDate.safeParse('2025-02-29').success).toBe(false);
  });

  it('recusa formato com hora', () => {
    expect(zCalendarDate.safeParse('2026-03-15T10:00:00Z').success).toBe(false);
    expect(zCalendarDate.safeParse('15/03/2026').success).toBe(false);
  });
});

describe('conversao de data', () => {
  it('faz ida e volta em UTC, sem escorregar de dia', () => {
    // O dia 31 e' o caso que vira "dia 30" com uma facilidade desconcertante.
    for (const value of ['2026-01-31', '2026-03-01', '2026-12-31', '2024-02-29']) {
      expect(utcToCalendarDate(calendarDateToUtc(value))).toBe(value);
    }
  });

  it('ancora o dia em meia-noite UTC', () => {
    const date = calendarDateToUtc('2026-03-15');

    expect(date.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('converte mes de competencia para o primeiro dia', () => {
    expect(monthReferenceToUtc('2026-03').toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(utcToMonthReference(monthReferenceToUtc('2026-03'))).toBe('2026-03');
  });
});

describe('zMonthReference', () => {
  it('aceita YYYY-MM valido', () => {
    expect(zMonthReference.safeParse('2026-01').success).toBe(true);
    expect(zMonthReference.safeParse('2026-12').success).toBe(true);
  });

  it('recusa mes fora do intervalo', () => {
    expect(zMonthReference.safeParse('2026-00').success).toBe(false);
    expect(zMonthReference.safeParse('2026-13').success).toBe(false);
    expect(zMonthReference.safeParse('2026-3').success).toBe(false);
  });
});

describe('zAmountInCents', () => {
  it('exige inteiro positivo', () => {
    expect(zAmountInCents.safeParse(1999).success).toBe(true);
    expect(zAmountInCents.safeParse(0).success).toBe(false);
    expect(zAmountInCents.safeParse(-100).success).toBe(false);
  });

  it('recusa decimal: dinheiro nunca trafega em reais', () => {
    const result = zAmountInCents.safeParse(19.99);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/centavos/);
  });
});

describe('zBasisPoints', () => {
  it('aceita 0 a 10000', () => {
    expect(zBasisPoints.safeParse(0).success).toBe(true);
    expect(zBasisPoints.safeParse(3333).success).toBe(true);
    expect(zBasisPoints.safeParse(10_000).success).toBe(true);
  });

  it('recusa fora do intervalo e fracionario', () => {
    expect(zBasisPoints.safeParse(10_001).success).toBe(false);
    expect(zBasisPoints.safeParse(-1).success).toBe(false);
    expect(zBasisPoints.safeParse(33.33).success).toBe(false);
  });
});

describe('zCurrencyCode', () => {
  it('normaliza para maiusculo', () => {
    expect(zCurrencyCode.parse(' brl ')).toBe('BRL');
  });

  it('recusa codigo fora do ISO 4217', () => {
    expect(zCurrencyCode.safeParse('BR').success).toBe(false);
    expect(zCurrencyCode.safeParse('REAL').success).toBe(false);
  });
});
