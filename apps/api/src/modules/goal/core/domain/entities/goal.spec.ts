import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { Goal } from './goal';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const workspaceId = new UniqueEntityId();

const goal = (overrides = {}): Goal =>
  Goal.create({
    workspaceId,
    name: 'Viagem de fim de ano',
    targetAmount: brl(900_000),
    ...overrides,
  });

describe('Goal', () => {
  it('nasce em aberto, sem prazo e sem conta vinculada', () => {
    const viagem = goal();

    expect(viagem.isAchieved()).toBe(false);
    expect(viagem.isArchived()).toBe(false);
    expect(viagem.deadline).toBeNull();
    expect(viagem.hasLinkedAccount()).toBe(false);
  });

  it('reconhece conta de reserva vinculada', () => {
    // Com conta vinculada, o aporte gera uma transferencia real.
    expect(goal({ linkedAccountId: new UniqueEntityId() }).hasLinkedAccount()).toBe(true);
  });

  it('delega a projecao ao VO', () => {
    const viagem = goal({ deadline: day('2026-12-31') });

    const projecao = viagem.project(
      [
        { date: day('2026-01-06'), amount: brl(120_000) },
        { date: day('2026-02-06'), amount: brl(150_000) },
        { date: day('2026-03-06'), amount: brl(90_000) },
      ],
      day('2026-03-15'),
    );

    expect(projecao.saved.toCents()).toBe(360_000);
    expect(projecao.monthlyAverage.toCents()).toBe(120_000);
    expect(projecao.isOnTrack).toBe(true);
  });

  describe('conclusao', () => {
    it('marca como atingida uma vez so', () => {
      const viagem = goal();
      const primeira = new Date('2026-01-01T00:00:00Z');

      viagem.markAchieved(primeira);
      viagem.markAchieved(new Date('2026-06-01T00:00:00Z'));

      expect(viagem.achievedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('um saque desfaz a conclusao', () => {
      // O total caiu abaixo do alvo: a meta deixa de estar batida.
      const viagem = goal();
      viagem.markAchieved();
      viagem.clearAchievement();

      expect(viagem.isAchieved()).toBe(false);
    });
  });

  it('ajusta alvo e prazo', () => {
    const viagem = goal();

    viagem.changeTarget(brl(1_200_000));
    viagem.changeDeadline(day('2027-01-31'));

    expect(viagem.targetAmount.toCents()).toBe(1_200_000);
    expect(viagem.deadline?.toString()).toBe('2027-01-31');
  });

  it('arquiva sem excluir', () => {
    const viagem = goal();
    viagem.archive();

    expect(viagem.isArchived()).toBe(true);
  });
});
