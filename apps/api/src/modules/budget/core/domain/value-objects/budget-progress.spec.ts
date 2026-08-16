import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { BudgetProgress } from './budget-progress';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

describe('BudgetProgress', () => {
  describe('faixas da barra', () => {
    it('verde ate 79%', () => {
      expect(BudgetProgress.of(brl(100_000), brl(0)).band).toBe('OK');
      expect(BudgetProgress.of(brl(100_000), brl(79_000)).band).toBe('OK');
      expect(BudgetProgress.of(brl(100_000), brl(79_999)).band).toBe('OK');
    });

    it('ambar de 80% a 99%', () => {
      expect(BudgetProgress.of(brl(100_000), brl(80_000)).band).toBe('NEAR');
      expect(BudgetProgress.of(brl(100_000), brl(99_999)).band).toBe('NEAR');
    });

    it('vermelho a partir de 100%', () => {
      expect(BudgetProgress.of(brl(100_000), brl(100_000)).band).toBe('OVER');
      expect(BudgetProgress.of(brl(100_000), brl(150_000)).band).toBe('OVER');
      expect(BudgetProgress.of(brl(100_000), brl(150_000)).isExceeded()).toBe(true);
    });
  });

  describe('calculo', () => {
    it('calcula percentual em pontos-base', () => {
      expect(BudgetProgress.of(brl(90_000), brl(76_500)).basisPoints).toBe(8500);
      expect(BudgetProgress.of(brl(90_000), brl(76_500)).percent).toBe(85);
    });

    it('calcula o que ainda cabe', () => {
      expect(BudgetProgress.of(brl(90_000), brl(76_500)).remaining.toCents()).toBe(13_500);
    });

    it('devolve saldo negativo quando estourou', () => {
      expect(BudgetProgress.of(brl(90_000), brl(100_000)).remaining.toCents()).toBe(-10_000);
    });

    it('nao produz NaN com limite zero', () => {
      expect(BudgetProgress.of(brl(0), brl(0)).basisPoints).toBe(0);
      expect(BudgetProgress.of(brl(0), brl(0)).band).toBe('OK');
      // Limite zero com gasto e' estouro total, nao divisao por zero.
      expect(BudgetProgress.of(brl(0), brl(100)).basisPoints).toBe(10_000);
      expect(BudgetProgress.of(brl(0), brl(100)).band).toBe('OVER');
    });
  });

  describe('rollover', () => {
    it('soma a sobra do mes anterior ao limite', () => {
      const progress = BudgetProgress.of(brl(90_000), brl(95_000), brl(20_000));

      expect(progress.effectiveLimit.toCents()).toBe(110_000);
      expect(progress.remaining.toCents()).toBe(15_000);
      // Com o rollover, o que seria estouro vira 86%.
      expect(progress.band).toBe('NEAR');
    });

    it('passa a sobra para o mes seguinte', () => {
      expect(BudgetProgress.of(brl(90_000), brl(76_500)).rolloverToNextMonth().toCents()).toBe(13_500);
    });

    it('estouro NAO vira divida herdada', () => {
      // Carregar o negativo puniria o mes seguinte duas vezes pelo mesmo gasto.
      expect(BudgetProgress.of(brl(90_000), brl(120_000)).rolloverToNextMonth().toCents()).toBe(0);
    });
  });

  describe('notificacao de limiar', () => {
    it('dispara 80% e 100% ao cruzar', () => {
      expect(BudgetProgress.of(brl(100_000), brl(85_000)).thresholdsToNotify()).toEqual([80]);
      expect(BudgetProgress.of(brl(100_000), brl(105_000)).thresholdsToNotify()).toEqual([80, 100]);
    });

    it('nao dispara abaixo de 80%', () => {
      expect(BudgetProgress.of(brl(100_000), brl(70_000)).thresholdsToNotify()).toEqual([]);
    });

    it('NAO repete limiar ja avisado', () => {
      // Sem isso, cada transacao acima de 80% renderia um e-mail novo -- o
      // usuario receberia quinze no mesmo dia.
      const progress = BudgetProgress.of(brl(100_000), brl(85_000));

      expect(progress.thresholdsToNotify([80])).toEqual([]);
    });

    it('avisa so o limiar novo quando o gasto avanca', () => {
      const estourou = BudgetProgress.of(brl(100_000), brl(105_000));

      // O de 80% ja foi avisado antes; so o de 100% e' novidade.
      expect(estourou.thresholdsToNotify([80])).toEqual([100]);
      expect(estourou.thresholdsToNotify([80, 100])).toEqual([]);
    });

    it('cenario do E2E: gastar ate 85% dispara exatamente um alerta', () => {
      const progress = BudgetProgress.of(brl(90_000), brl(76_500));

      expect(progress.percent).toBe(85);
      expect(progress.band).toBe('NEAR');
      expect(progress.thresholdsToNotify()).toEqual([80]);
    });
  });
});
