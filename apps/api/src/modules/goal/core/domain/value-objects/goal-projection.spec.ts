import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { GoalProjection, type ContributionRecord } from './goal-projection';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const contribution = (date: string, cents: number): ContributionRecord => ({
  date: day(date),
  amount: brl(cents),
});

const TODAY = day('2026-03-15');

describe('GoalProjection', () => {
  describe('media dos ultimos 3 meses', () => {
    it('usa a janela de 3 meses de competencia', () => {
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [
          contribution('2026-01-06', 120_000),
          contribution('2026-02-06', 150_000),
          contribution('2026-03-06', 90_000),
        ],
      });

      // (120000 + 150000 + 90000) / 3
      expect(result.monthlyAverage.toCents()).toBe(120_000);
      expect(result.saved.toCents()).toBe(360_000);
      expect(result.remaining.toCents()).toBe(540_000);
    });

    it('divide pelos MESES, nao pelo numero de aportes', () => {
      // Dois aportes em janeiro e nada depois: o ritmo real e' menor do que a
      // media por aporte sugeriria. Dividir por 2 daria 50.000/mes e prometeria
      // uma data que nao vai acontecer.
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [contribution('2026-01-05', 50_000), contribution('2026-01-20', 50_000)],
      });

      expect(result.monthlyAverage.toCents()).toBe(33_333); // 100.000 / 3 meses
    });

    it('ignora aportes fora da janela de 3 meses', () => {
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [
          contribution('2025-06-01', 500_000), // muito antigo
          contribution('2026-02-01', 60_000),
          contribution('2026-03-01', 60_000),
        ],
      });

      // O aporte antigo conta no total economizado...
      expect(result.saved.toCents()).toBe(620_000);
      // ...mas nao no RITMO: (60000 + 60000) / 2 meses decorridos.
      expect(result.monthlyAverage.toCents()).toBe(60_000);
    });

    it('nao pune meta nova por meses em que ela nem existia', () => {
      // Primeiro aporte neste mes: divide por 1, nao por 3.
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [contribution('2026-03-01', 100_000)],
      });

      expect(result.monthlyAverage.toCents()).toBe(100_000);
    });
  });

  describe('estimativa de conclusao', () => {
    it('projeta a data pelo ritmo atual', () => {
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [
          contribution('2026-01-06', 120_000),
          contribution('2026-02-06', 150_000),
          contribution('2026-03-06', 90_000),
        ],
      });

      // Faltam 540.000 a 120.000/mes = 4,5 -> 5 meses.
      expect(result.monthsRemaining).toBe(5);
      expect(result.estimatedCompletion?.toString()).toBe('2026-08');
    });

    it('NAO inventa data quando nao ha ritmo', () => {
      // Mostrar uma data estimada sem nenhum aporte seria pior do que admitir
      // que ainda nao da para saber.
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [],
      });

      expect(result.monthlyAverage.toCents()).toBe(0);
      expect(result.estimatedCompletion).toBeNull();
      expect(result.monthsRemaining).toBeNull();
      expect(result.remaining.toCents()).toBe(900_000);
    });

    it('arredonda meses para cima', () => {
      const result = GoalProjection.calculate({
        target: brl(100_100),
        today: TODAY,
        contributions: [contribution('2026-03-01', 100_000)],
      });

      // Faltam 100 centavos a 100.000/mes: um mes, nao zero.
      expect(result.monthsRemaining).toBe(1);
    });
  });

  describe('prazo', () => {
    it('calcula o aporte mensal necessario, arredondando para CIMA', () => {
      // Pagar um centavo a menos por mes deixa a meta curta na data final.
      const result = GoalProjection.calculate({
        target: brl(100_000),
        today: TODAY,
        deadline: day('2026-06-30'),
        contributions: [contribution('2026-03-01', 10_000)],
      });

      // Faltam 90.000 em 3 meses.
      expect(result.requiredMonthly?.toCents()).toBe(30_000);
    });

    it('arredonda para cima quando nao divide exato', () => {
      const result = GoalProjection.calculate({
        target: brl(10_001),
        today: TODAY,
        deadline: day('2026-05-31'),
        contributions: [],
      });

      // 10.001 / 2 = 5000,5 -> 5001.
      expect(result.requiredMonthly?.toCents()).toBe(5001);
    });

    it('diz que esta no rumo quando a projecao cabe no prazo', () => {
      const result = GoalProjection.calculate({
        target: brl(300_000),
        today: TODAY,
        deadline: day('2026-12-31'),
        contributions: [
          contribution('2026-01-01', 50_000),
          contribution('2026-02-01', 50_000),
          contribution('2026-03-01', 50_000),
        ],
      });

      // Faltam 150.000 a 50.000/mes = 3 meses -> junho, antes de dezembro.
      expect(result.estimatedCompletion?.toString()).toBe('2026-06');
      expect(result.isOnTrack).toBe(true);
    });

    it('avisa quando a projecao passa do prazo', () => {
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        deadline: day('2026-05-31'),
        contributions: [contribution('2026-03-01', 100_000)],
      });

      expect(result.isOnTrack).toBe(false);
      // E sugere o valor que corrigiria a rota: 800.000 em 2 meses.
      expect(result.requiredMonthly?.toCents()).toBe(400_000);
    });

    it('trata prazo vencido como "falta tudo, agora"', () => {
      const result = GoalProjection.calculate({
        target: brl(100_000),
        today: TODAY,
        deadline: day('2026-01-31'),
        contributions: [contribution('2026-03-01', 40_000)],
      });

      expect(result.requiredMonthly?.toCents()).toBe(60_000);
      expect(result.isOnTrack).toBe(false);
    });

    it('sem prazo, nao ha rumo nem aporte necessario', () => {
      const result = GoalProjection.calculate({
        target: brl(100_000),
        today: TODAY,
        contributions: [contribution('2026-03-01', 40_000)],
      });

      expect(result.isOnTrack).toBeNull();
      expect(result.requiredMonthly).toBeNull();
    });
  });

  describe('meta atingida', () => {
    it('marca como atingida e zera o que falta', () => {
      const result = GoalProjection.calculate({
        target: brl(100_000),
        today: TODAY,
        deadline: day('2026-12-31'),
        contributions: [contribution('2026-03-01', 120_000)],
      });

      expect(result.isAchieved).toBe(true);
      expect(result.remaining.toCents()).toBe(0);
      expect(result.basisPoints).toBe(10_000);
      expect(result.monthsRemaining).toBe(0);
      expect(result.isOnTrack).toBe(true);
      expect(result.requiredMonthly?.toCents()).toBe(0);
    });

    it('nao passa de 100% no progresso', () => {
      const result = GoalProjection.calculate({
        target: brl(100_000),
        today: TODAY,
        contributions: [contribution('2026-03-01', 500_000)],
      });

      expect(result.basisPoints).toBe(10_000);
    });

    it('calcula progresso parcial em pontos-base', () => {
      const result = GoalProjection.calculate({
        target: brl(900_000),
        today: TODAY,
        contributions: [contribution('2026-03-01', 300_000)],
      });

      expect(result.basisPoints).toBe(3333);
    });
  });
});
