import { RecurrenceFrequency } from '@finapp/contracts';
import { describe, expect, it } from 'vitest';

import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { RecurrenceSchedule } from './recurrence-schedule';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const schedule = (props: Parameters<typeof RecurrenceSchedule.create>[0]): RecurrenceSchedule => {
  const result = RecurrenceSchedule.create(props);
  if (result.isLeft()) throw new Error(`Regra invalida: ${result.value.message}`);
  return result.value;
};

const dates = (occurrences: CalendarDate[]): string[] =>
  occurrences.map((occurrence) => occurrence.toString());

describe('RecurrenceSchedule', () => {
  describe('mensal', () => {
    it('gera todo mes no mesmo dia', () => {
      const aluguel = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
      });

      expect(dates(aluguel.occurrencesBetween(day('2026-01-01'), day('2026-04-30')))).toEqual([
        '2026-01-10',
        '2026-02-10',
        '2026-03-10',
        '2026-04-10',
      ]);
    });

    it('AJUSTA o dia 31 nos meses curtos, sem pular o mes', () => {
      // Sem o ajuste, fevereiro transbordaria para 03/03 e o lancamento sumiria
      // do relatorio de fevereiro.
      const todoDia31 = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 31,
        startDate: day('2026-01-31'),
      });

      expect(dates(todoDia31.occurrencesBetween(day('2026-01-01'), day('2026-05-31')))).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);
    });

    it('nao acumula o ajuste: o dia 31 volta nos meses que o tem', () => {
      // Se o cursor fosse avancado a partir da data ajustada, marco viraria 28.
      const todoDia31 = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 31,
        startDate: day('2026-01-31'),
      });

      const marco = todoDia31.occurrencesBetween(day('2026-03-01'), day('2026-03-31'));

      expect(dates(marco)).toEqual(['2026-03-31']);
    });

    it('respeita fevereiro bissexto', () => {
      const todoDia30 = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 30,
        startDate: day('2024-01-30'),
      });

      expect(dates(todoDia30.occurrencesBetween(day('2024-02-01'), day('2024-02-29')))).toEqual([
        '2024-02-29',
      ]);
    });

    it('suporta intervalo maior que 1 (bimestral)', () => {
      const bimestral = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        interval: 2,
        dayOfMonth: 5,
        startDate: day('2026-01-05'),
      });

      expect(dates(bimestral.occurrencesBetween(day('2026-01-01'), day('2026-07-31')))).toEqual([
        '2026-01-05',
        '2026-03-05',
        '2026-05-05',
        '2026-07-05',
      ]);
    });

    it('pula o primeiro ciclo quando o dia ja passou no mes de inicio', () => {
      // Serie criada em 15/01 com vencimento dia 10: janeiro ja passou.
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-15'),
      });

      expect(dates(serie.occurrencesBetween(day('2026-01-01'), day('2026-03-31')))).toEqual([
        '2026-02-10',
        '2026-03-10',
      ]);
    });

    it('atravessa a virada do ano', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 15,
        startDate: day('2026-11-15'),
      });

      expect(dates(serie.occurrencesBetween(day('2026-11-01'), day('2027-02-28')))).toEqual([
        '2026-11-15',
        '2026-12-15',
        '2027-01-15',
        '2027-02-15',
      ]);
    });
  });

  describe('semanal', () => {
    it('gera toda semana no dia certo', () => {
      // 2026-03-02 e' uma segunda-feira.
      const semanal = schedule({
        frequency: RecurrenceFrequency.WEEKLY,
        weekday: 1,
        startDate: day('2026-03-02'),
      });

      expect(dates(semanal.occurrencesBetween(day('2026-03-01'), day('2026-03-31')))).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
      ]);
    });

    it('alinha para o proximo dia da semana pedido', () => {
      // Comeca numa segunda mas repete as quartas.
      const quartas = schedule({
        frequency: RecurrenceFrequency.WEEKLY,
        weekday: 3,
        startDate: day('2026-03-02'),
      });

      expect(dates(quartas.occurrencesBetween(day('2026-03-01'), day('2026-03-20')))).toEqual([
        '2026-03-04',
        '2026-03-11',
        '2026-03-18',
      ]);
    });

    it('usa o dia da semana da data inicial quando nao informado', () => {
      const semanal = schedule({
        frequency: RecurrenceFrequency.WEEKLY,
        startDate: day('2026-03-05'), // quinta
      });

      expect(dates(semanal.occurrencesBetween(day('2026-03-01'), day('2026-03-20')))).toEqual([
        '2026-03-05',
        '2026-03-12',
        '2026-03-19',
      ]);
    });

    it('suporta quinzenal', () => {
      const quinzenal = schedule({
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 2,
        weekday: 1,
        startDate: day('2026-03-02'),
      });

      expect(dates(quinzenal.occurrencesBetween(day('2026-03-01'), day('2026-04-15')))).toEqual([
        '2026-03-02',
        '2026-03-16',
        '2026-03-30',
        '2026-04-13',
      ]);
    });
  });

  describe('anual', () => {
    it('gera uma vez por ano', () => {
      const iptu = schedule({
        frequency: RecurrenceFrequency.YEARLY,
        monthOfYear: 3,
        dayOfMonth: 10,
        startDate: day('2026-03-10'),
      });

      expect(dates(iptu.occurrencesBetween(day('2026-01-01'), day('2029-12-31')))).toEqual([
        '2026-03-10',
        '2027-03-10',
        '2028-03-10',
        '2029-03-10',
      ]);
    });

    it('ajusta 29 de fevereiro nos anos nao bissextos', () => {
      const anual = schedule({
        frequency: RecurrenceFrequency.YEARLY,
        monthOfYear: 2,
        dayOfMonth: 29,
        startDate: day('2024-02-29'),
      });

      expect(dates(anual.occurrencesBetween(day('2024-01-01'), day('2028-12-31')))).toEqual([
        '2024-02-29',
        '2025-02-28',
        '2026-02-28',
        '2027-02-28',
        '2028-02-29',
      ]);
    });
  });

  describe('limites da serie', () => {
    it('nao gera nada antes da data inicial', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-03-10'),
      });

      expect(serie.occurrencesBetween(day('2026-01-01'), day('2026-02-28'))).toHaveLength(0);
    });

    it('para na data final', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
        endDate: day('2026-03-10'),
      });

      expect(dates(serie.occurrencesBetween(day('2026-01-01'), day('2026-12-31')))).toEqual([
        '2026-01-10',
        '2026-02-10',
        '2026-03-10',
      ]);
    });

    it('devolve lista vazia para janela invertida', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
      });

      expect(serie.occurrencesBetween(day('2026-06-01'), day('2026-01-01'))).toHaveLength(0);
    });

    it('sabe se a serie ja acabou', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
        endDate: day('2026-03-10'),
      });

      expect(serie.hasEnded(day('2026-03-10'))).toBe(false);
      expect(serie.hasEnded(day('2026-03-11'))).toBe(true);
    });
  });

  describe('nextAfter', () => {
    it('devolve a proxima ocorrencia estritamente depois da data', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
      });

      expect(serie.nextAfter(day('2026-01-10'))?.toString()).toBe('2026-02-10');
      expect(serie.nextAfter(day('2026-01-09'))?.toString()).toBe('2026-01-10');
    });

    it('devolve null quando a serie acabou', () => {
      const serie = schedule({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 10,
        startDate: day('2026-01-10'),
        endDate: day('2026-03-10'),
      });

      expect(serie.nextAfter(day('2026-03-10'))).toBeNull();
    });
  });

  describe('validacao', () => {
    it('recusa intervalo invalido', () => {
      expect(
        RecurrenceSchedule.create({
          frequency: RecurrenceFrequency.MONTHLY,
          interval: 0,
          startDate: day('2026-01-10'),
        }).isLeft(),
      ).toBe(true);
    });

    it('recusa data final antes da inicial', () => {
      expect(
        RecurrenceSchedule.create({
          frequency: RecurrenceFrequency.MONTHLY,
          startDate: day('2026-03-10'),
          endDate: day('2026-01-10'),
        }).isLeft(),
      ).toBe(true);
    });

    it('recusa dia do mes e da semana fora do intervalo', () => {
      expect(
        RecurrenceSchedule.create({
          frequency: RecurrenceFrequency.MONTHLY,
          dayOfMonth: 32,
          startDate: day('2026-01-10'),
        }).isLeft(),
      ).toBe(true);

      expect(
        RecurrenceSchedule.create({
          frequency: RecurrenceFrequency.WEEKLY,
          weekday: 7,
          startDate: day('2026-01-10'),
        }).isLeft(),
      ).toBe(true);
    });
  });
});
