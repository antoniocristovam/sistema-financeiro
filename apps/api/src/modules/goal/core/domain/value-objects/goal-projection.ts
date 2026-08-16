import { Money } from '@finapp/money';

import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';

/** Meses de historico usados para estimar o ritmo de aporte. */
export const PROJECTION_WINDOW_MONTHS = 3;

export interface ContributionRecord {
  date: CalendarDate;
  amount: Money;
}

export interface GoalProjectionResult {
  /** Media mensal dos ultimos 3 meses. */
  monthlyAverage: Money;
  saved: Money;
  remaining: Money;
  /** Pontos-base do alvo ja atingidos. */
  basisPoints: number;
  /** Nulo quando nao ha ritmo (nenhum aporte) -- nao da para estimar do nada. */
  estimatedCompletion: MonthReference | null;
  monthsRemaining: number | null;
  /** Aporte mensal necessario para bater o prazo. Nulo se nao ha prazo. */
  requiredMonthly: Money | null;
  /** Falso quando a projecao passa do prazo. */
  isOnTrack: boolean | null;
  isAchieved: boolean;
}

/**
 * Projecao de conclusao de uma meta.
 *
 * A pergunta que o usuario faz e' "nesse ritmo, quando eu chego la?". A
 * resposta sai da media dos aportes dos ultimos 3 meses -- janela curta o
 * suficiente para refletir mudanca de ritmo, longa o bastante para nao virar
 * ruido quando alguem pula um mes.
 *
 * Duas decisoes explicitas:
 *
 * - **Sem aporte nao ha projecao.** `estimatedCompletion` volta `null` em vez
 *   de "infinito" ou da data de hoje. Mostrar uma data inventada e' pior do que
 *   admitir que ainda nao da para saber.
 * - **Meses contam por competencia, nao por 30 dias.** Dois aportes em janeiro
 *   e um em marco sao tres meses de janela, com media dividida por 3 --
 *   incluindo fevereiro, que teve zero. Ignorar o mes vazio inflaria a media e
 *   prometeria uma data que nao vai acontecer.
 */
export class GoalProjection {
  static calculate(params: {
    target: Money;
    contributions: readonly ContributionRecord[];
    today: CalendarDate;
    deadline?: CalendarDate | null;
  }): GoalProjectionResult {
    const { target, contributions, today, deadline } = params;
    const currency = target.currency;

    const saved = Money.sum(
      contributions.map((contribution) => contribution.amount),
      currency,
    );

    const remaining = target.minus(saved);
    const isAchieved = saved.isGreaterThanOrEqual(target);

    const basisPoints = target.isZero()
      ? 10_000
      : Math.min(10_000, Math.round((saved.toCents() / target.toCents()) * 10_000));

    const monthlyAverage = GoalProjection.averageOfRecentMonths(contributions, today, currency);

    let monthsRemaining: number | null = null;
    let estimatedCompletion: MonthReference | null = null;

    if (isAchieved) {
      monthsRemaining = 0;
      estimatedCompletion = MonthReference.fromDate(today);
    } else if (monthlyAverage.isPositive()) {
      monthsRemaining = Math.ceil(remaining.toCents() / monthlyAverage.toCents());
      estimatedCompletion = MonthReference.fromDate(today).add(monthsRemaining);
    }

    const requiredMonthly = GoalProjection.requiredMonthly(remaining, today, deadline ?? null);

    const isOnTrack =
      deadline == null
        ? null
        : isAchieved ||
          (estimatedCompletion !== null &&
            !estimatedCompletion.isAfter(MonthReference.fromDate(deadline)));

    return {
      monthlyAverage,
      saved,
      remaining: remaining.isPositive() ? remaining : Money.zero(currency),
      basisPoints,
      estimatedCompletion,
      monthsRemaining,
      requiredMonthly,
      isOnTrack,
      isAchieved,
    };
  }

  /**
   * Media dos ultimos 3 meses de competencia, incluindo os meses sem aporte.
   *
   * A divisao e' sempre por 3 (ou pelos meses decorridos desde o primeiro
   * aporte, se a meta e' mais nova) -- nao pelo numero de aportes. Dividir pelo
   * numero de aportes trataria "R$ 300 em um mes" como ritmo de R$ 300/mes,
   * quando o mes seguinte pode ter sido zero.
   */
  private static averageOfRecentMonths(
    contributions: readonly ContributionRecord[],
    today: CalendarDate,
    currency: string,
  ): Money {
    if (contributions.length === 0) {
      return Money.zero(currency);
    }

    const currentMonth = MonthReference.fromDate(today);
    const windowStart = currentMonth.add(-(PROJECTION_WINDOW_MONTHS - 1));

    const withinWindow = contributions.filter((contribution) => {
      const month = MonthReference.fromDate(contribution.date);
      return !month.isBefore(windowStart) && !month.isAfter(currentMonth);
    });

    if (withinWindow.length === 0) {
      return Money.zero(currency);
    }

    const total = Money.sum(
      withinWindow.map((contribution) => contribution.amount),
      currency,
    );

    // Meta nova nao e' punida por meses em que ela nem existia.
    const firstContributionMonth = MonthReference.fromDate(
      withinWindow.reduce(
        (earliest, contribution) =>
          contribution.date.isBefore(earliest) ? contribution.date : earliest,
        withinWindow[0]!.date,
      ),
    );

    const elapsedMonths = firstContributionMonth.monthsUntil(currentMonth) + 1;
    const divisor = Math.min(PROJECTION_WINDOW_MONTHS, Math.max(1, elapsedMonths));

    return Money.fromCents(Math.round(total.toCents() / divisor), currency);
  }

  /**
   * Aporte mensal que corrigiria a rota para bater o prazo.
   *
   * Arredonda para CIMA: pagar um centavo a menos por mes durante um ano deixa
   * a meta doze centavos curta na data final.
   */
  private static requiredMonthly(
    remaining: Money,
    today: CalendarDate,
    deadline: CalendarDate | null,
  ): Money | null {
    if (deadline === null) {
      return null;
    }

    if (!remaining.isPositive()) {
      return Money.zero(remaining.currency);
    }

    const monthsLeft = MonthReference.fromDate(today).monthsUntil(MonthReference.fromDate(deadline));

    // Prazo vencido ou no mes corrente: falta tudo, agora.
    if (monthsLeft <= 0) {
      return remaining;
    }

    return Money.fromCents(Math.ceil(remaining.toCents() / monthsLeft), remaining.currency);
  }
}
