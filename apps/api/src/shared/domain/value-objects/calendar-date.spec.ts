import { describe, expect, it } from 'vitest';

import { CalendarDate, daysInMonth } from './calendar-date';

/** Desempacota o `right`, falhando o teste se vier `left`. */
const date = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) {
    throw new Error(`Data invalida no teste: ${value}`);
  }
  return result.value;
};

describe('CalendarDate', () => {
  describe('criacao', () => {
    it('aceita data valida', () => {
      const result = CalendarDate.create('2026-03-15');

      expect(result.isRight()).toBe(true);
      expect(date('2026-03-15').toString()).toBe('2026-03-15');
    });

    it('recusa dia que nao existe no mes', () => {
      expect(CalendarDate.create('2026-02-30').isLeft()).toBe(true);
      expect(CalendarDate.create('2026-04-31').isLeft()).toBe(true);
      expect(CalendarDate.create('2025-02-29').isLeft()).toBe(true);
    });

    it('aceita 29 de fevereiro em ano bissexto', () => {
      expect(CalendarDate.create('2024-02-29').isRight()).toBe(true);
    });

    it('recusa formato errado', () => {
      expect(CalendarDate.create('15/03/2026').isLeft()).toBe(true);
      expect(CalendarDate.create('2026-3-15').isLeft()).toBe(true);
      expect(CalendarDate.create('2026-03-15T10:00:00Z').isLeft()).toBe(true);
    });

    it('recusa mes fora do intervalo', () => {
      expect(CalendarDate.create('2026-13-01').isLeft()).toBe(true);
      expect(CalendarDate.create('2026-00-01').isLeft()).toBe(true);
    });
  });

  describe('conversao para UTC', () => {
    it('ancora na meia-noite UTC', () => {
      expect(date('2026-03-15').toUtcDate().toISOString()).toBe('2026-03-15T00:00:00.000Z');
    });

    it('faz ida e volta sem escorregar de dia', () => {
      // O dia 31 e' o que vira "dia 30" com mais facilidade.
      for (const value of ['2026-01-31', '2026-12-31', '2026-03-01', '2024-02-29']) {
        expect(CalendarDate.fromUtcDate(date(value).toUtcDate()).toString()).toBe(value);
      }
    });
  });

  describe('addMonths', () => {
    it('AJUSTA o dia em vez de transbordar para o mes seguinte', () => {
      // `Date.setMonth` levaria 31/01 + 1 mes para 03/03. Aqui vai para 28/02.
      expect(date('2026-01-31').addMonths(1).toString()).toBe('2026-02-28');
      expect(date('2024-01-31').addMonths(1).toString()).toBe('2024-02-29');
      expect(date('2026-03-31').addMonths(1).toString()).toBe('2026-04-30');
    });

    it('atravessa a virada do ano', () => {
      expect(date('2026-11-15').addMonths(2).toString()).toBe('2027-01-15');
      expect(date('2026-01-15').addMonths(-2).toString()).toBe('2025-11-15');
    });

    it('nao acumula o ajuste: o dia original volta no mes que o tem', () => {
      // Somar 1 mes duas vezes daria 28/03 se o ajuste virasse permanente.
      const janeiro = date('2026-01-31');

      expect(janeiro.addMonths(1).toString()).toBe('2026-02-28');
      expect(janeiro.addMonths(2).toString()).toBe('2026-03-31');
    });
  });

  describe('addDays', () => {
    it('atravessa mes e ano', () => {
      expect(date('2026-01-31').addDays(1).toString()).toBe('2026-02-01');
      expect(date('2026-12-31').addDays(1).toString()).toBe('2027-01-01');
      expect(date('2026-03-01').addDays(-1).toString()).toBe('2026-02-28');
    });

    it('respeita bissexto', () => {
      expect(date('2024-02-28').addDays(1).toString()).toBe('2024-02-29');
      expect(date('2025-02-28').addDays(1).toString()).toBe('2025-03-01');
    });
  });

  describe('limites do mes', () => {
    it('calcula primeiro e ultimo dia', () => {
      expect(date('2026-03-15').startOfMonth().toString()).toBe('2026-03-01');
      expect(date('2026-03-15').endOfMonth().toString()).toBe('2026-03-31');
      expect(date('2026-02-10').endOfMonth().toString()).toBe('2026-02-28');
      expect(date('2024-02-10').endOfMonth().toString()).toBe('2024-02-29');
    });
  });

  describe('comparacao', () => {
    it('ordena cronologicamente', () => {
      expect(date('2026-01-01').isBefore(date('2026-01-02'))).toBe(true);
      expect(date('2026-02-01').isAfter(date('2026-01-31'))).toBe(true);
      expect(date('2026-01-01').compare(date('2026-01-01'))).toBe(0);
      expect(date('2026-01-01').isSameOrBefore(date('2026-01-01'))).toBe(true);
      expect(date('2026-01-01').isSameOrAfter(date('2026-01-01'))).toBe(true);
    });

    it('serve direto no sort', () => {
      const sorted = [date('2026-03-01'), date('2026-01-15'), date('2026-02-20')].sort((a, b) =>
        a.compare(b),
      );

      expect(sorted.map((d) => d.toString())).toEqual(['2026-01-15', '2026-02-20', '2026-03-01']);
    });

    it('testa intervalo fechado nas duas pontas', () => {
      const from = date('2026-01-01');
      const to = date('2026-01-31');

      expect(date('2026-01-01').isBetween(from, to)).toBe(true);
      expect(date('2026-01-31').isBetween(from, to)).toBe(true);
      expect(date('2026-02-01').isBetween(from, to)).toBe(false);
    });
  });

  describe('utilitarios', () => {
    it('conta dias entre datas', () => {
      expect(date('2026-01-01').daysUntil(date('2026-01-31'))).toBe(30);
      expect(date('2026-01-31').daysUntil(date('2026-01-01'))).toBe(-30);
      expect(date('2026-01-01').daysUntil(date('2026-01-01'))).toBe(0);
    });

    it('devolve o dia da semana em UTC', () => {
      // 2026-03-15 e' um domingo.
      expect(date('2026-03-15').weekday()).toBe(0);
      expect(date('2026-03-16').weekday()).toBe(1);
    });

    it('extrai a chave do mes', () => {
      expect(date('2026-03-15').toMonthKey()).toBe('2026-03');
    });

    it('compara por valor, nao por identidade', () => {
      expect(date('2026-03-15').equals(date('2026-03-15'))).toBe(true);
      expect(date('2026-03-15').equals(date('2026-03-16'))).toBe(false);
    });
  });

  describe('clamped', () => {
    it('ajusta o dia para o ultimo disponivel', () => {
      expect(CalendarDate.clamped(2026, 2, 31).toString()).toBe('2026-02-28');
      expect(CalendarDate.clamped(2026, 4, 31).toString()).toBe('2026-04-30');
    });

    it('normaliza mes fora do intervalo', () => {
      expect(CalendarDate.clamped(2026, 13, 15).toString()).toBe('2027-01-15');
      expect(CalendarDate.clamped(2026, 0, 15).toString()).toBe('2025-12-15');
      expect(CalendarDate.clamped(2026, -1, 15).toString()).toBe('2025-11-15');
    });
  });
});

describe('daysInMonth', () => {
  it('conhece a regra completa do bissexto', () => {
    expect(daysInMonth(2024, 2)).toBe(29); // divisivel por 4
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // divisivel por 100: NAO e' bissexto
    expect(daysInMonth(2000, 2)).toBe(29); // divisivel por 400: e' bissexto
  });

  it('conhece os meses de 30 e 31', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
