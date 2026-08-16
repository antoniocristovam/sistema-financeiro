import { RecurrenceFrequency } from '@finapp/contracts';
import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { RecurrenceSchedule } from '../value-objects/recurrence-schedule';
import { Recurrence } from './recurrence';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const workspaceId = new UniqueEntityId();

const recurrence = (overrides: { startDate?: string; reminderDaysBefore?: number } = {}): Recurrence => {
  const scheduleResult = RecurrenceSchedule.create({
    frequency: RecurrenceFrequency.MONTHLY,
    dayOfMonth: 10,
    startDate: day(overrides.startDate ?? '2026-01-10'),
  });

  if (scheduleResult.isLeft()) throw new Error('regra invalida');

  return Recurrence.create({
    workspaceId,
    createdByUserId: new UniqueEntityId(),
    name: 'Aluguel',
    template: {
      accountId: new UniqueEntityId(),
      categoryId: new UniqueEntityId(),
      type: 'EXPENSE',
      amount: brl(210_000),
      description: 'Aluguel',
      notes: null,
    },
    schedule: scheduleResult.value,
    reminderDaysBefore: overrides.reminderDaysBefore ?? null,
  });
};

describe('Recurrence', () => {
  describe('materializacao', () => {
    it('gera as ocorrencias dos proximos 60 dias', () => {
      const aluguel = recurrence();
      const pendentes = aluguel.pendingOccurrences(day('2026-03-01'));

      // Janela de 60 dias a partir de 01/03 vai ate 30/04. Janeiro e fevereiro
      // ficam de fora: serie nova nao volta no tempo.
      expect(pendentes.map((occurrence) => occurrence.toString())).toEqual([
        '2026-03-10',
        '2026-04-10',
      ]);
    });

    it('NAO cria ocorrencia vencida ao cadastrar serie retroativa', () => {
      /*
       * Cadastrar hoje um aluguel "desde janeiro" nao pode despejar duas contas
       * vencidas no extrato -- elas ja foram pagas, e como nascem PENDING
       * estragariam tambem o saldo projetado.
       */
      const aluguel = recurrence({ startDate: '2025-06-10' });
      const pendentes = aluguel.pendingOccurrences(day('2026-03-01'));

      expect(pendentes.every((occurrence) => occurrence.isSameOrAfter(day('2026-03-01')))).toBe(true);
      expect(pendentes).toHaveLength(2);
    });

    it('recupera o atraso quando o job ficou fora do ar', () => {
      /*
       * O outro lado da mesma regra: com `materializedUntil` preenchido, a
       * serie retoma de onde parou. Uma semana de job parado nao pode fazer a
       * ocorrencia daquela semana desaparecer.
       */
      const aluguel = recurrence();
      aluguel.markMaterializedUntil(day('2026-03-05'));

      const pendentes = aluguel.pendingOccurrences(day('2026-03-12'));

      expect(pendentes.map((occurrence) => occurrence.toString())).toContain('2026-03-10');
    });

    it('serie que so comeca no futuro respeita a data de inicio', () => {
      const aluguel = recurrence({ startDate: '2026-04-10' });
      const pendentes = aluguel.pendingOccurrences(day('2026-03-01'));

      expect(pendentes.map((occurrence) => occurrence.toString())).toEqual(['2026-04-10']);
    });

    it('nao regenera o que ja foi materializado', () => {
      const aluguel = recurrence();
      aluguel.markMaterializedUntil(day('2026-02-28'));

      const pendentes = aluguel.pendingOccurrences(day('2026-03-01'));

      expect(pendentes.map((occurrence) => occurrence.toString())).toEqual([
        '2026-03-10',
        '2026-04-10',
      ]);
    });

    it('NAO recria ocorrencia dispensada pelo usuario', () => {
      // Pular uma ocorrencia nao quebra a serie: as seguintes continuam vindo.
      const aluguel = recurrence();
      const pendentes = aluguel.pendingOccurrences(day('2026-03-01'), [day('2026-03-10')]);

      expect(pendentes.map((occurrence) => occurrence.toString())).toEqual(['2026-04-10']);
    });

    it('serie inativa nao gera nada', () => {
      const aluguel = recurrence();
      aluguel.deactivate();

      expect(aluguel.pendingOccurrences(day('2026-03-01'))).toHaveLength(0);

      aluguel.activate();
      expect(aluguel.pendingOccurrences(day('2026-03-01')).length).toBeGreaterThan(0);
    });

    it('trocar a regra zera a janela ja materializada', () => {
      // Com a regra nova, as datas antigas nao valem mais.
      const aluguel = recurrence();
      aluguel.markMaterializedUntil(day('2026-06-30'));

      const nova = RecurrenceSchedule.create({
        frequency: RecurrenceFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: day('2026-01-05'),
      });

      if (nova.isLeft()) throw new Error('regra invalida');
      aluguel.changeSchedule(nova.value);

      expect(aluguel.materializedUntil).toBeNull();
    });
  });

  describe('lembretes', () => {
    it('avisa com a antecedencia configurada', () => {
      const aluguel = recurrence({ reminderDaysBefore: 3 });

      expect(aluguel.shouldRemindOn(day('2026-03-07'), day('2026-03-10'))).toBe(true);
      expect(aluguel.shouldRemindOn(day('2026-03-08'), day('2026-03-10'))).toBe(false);
      expect(aluguel.shouldRemindOn(day('2026-03-06'), day('2026-03-10'))).toBe(false);
    });

    it('nao avisa quando o lembrete esta desligado', () => {
      expect(recurrence().shouldRemindOn(day('2026-03-07'), day('2026-03-10'))).toBe(false);
    });

    it('serie inativa nao avisa', () => {
      const aluguel = recurrence({ reminderDaysBefore: 3 });
      aluguel.deactivate();

      expect(aluguel.shouldRemindOn(day('2026-03-07'), day('2026-03-10'))).toBe(false);
    });
  });

  describe('deteccao de reajuste', () => {
    it('avisa quando o valor diverge mais de 10% da media', () => {
      const aluguel = recurrence();
      const historico = [brl(210_000), brl(210_000), brl(210_000)];

      const drift = aluguel.detectDrift(historico, brl(235_000));

      expect(drift?.average.toCents()).toBe(210_000);
      expect(drift?.difference.toCents()).toBe(25_000);
      expect(drift?.ratio).toBeCloseTo(0.119, 3);
      expect(drift?.isSignificant).toBe(true);
    });

    it('nao avisa por variacao pequena', () => {
      const aluguel = recurrence();
      const drift = aluguel.detectDrift([brl(210_000), brl(210_000)], brl(215_000));

      expect(drift?.isSignificant).toBe(false);
    });

    it('avisa tambem quando o valor CAI mais de 10%', () => {
      const aluguel = recurrence();
      const drift = aluguel.detectDrift([brl(210_000)], brl(180_000));

      expect(drift?.ratio).toBeLessThan(0);
      expect(drift?.isSignificant).toBe(true);
    });

    it('nao inventa reajuste sem historico', () => {
      // Sem media nao ha o que comparar; devolver "100% de aumento" seria pior.
      expect(recurrence().detectDrift([], brl(235_000))).toBeNull();
    });

    it('nao divide por zero quando a media e zero', () => {
      expect(recurrence().detectDrift([brl(0), brl(0)], brl(100)) ).toBeNull();
    });

    it('fica exatamente no limite sem disparar', () => {
      const aluguel = recurrence();
      const drift = aluguel.detectDrift([brl(100_000)], brl(110_000));

      // 10% exatos nao passam do limiar de 10%.
      expect(drift?.ratio).toBeCloseTo(0.1, 5);
      expect(drift?.isSignificant).toBe(false);
    });
  });
});
