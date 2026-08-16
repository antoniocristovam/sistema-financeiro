import { RecurrenceFrequency } from '@finapp/contracts';

import { InvalidValueError } from '../../../../../shared/domain/errors/common-errors';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { ValueObject } from '../../../../../shared/domain/value-object';
import { type Either, left, right } from '../../../../../shared/either';

interface RecurrenceScheduleProps {
  frequency: RecurrenceFrequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  startDate: CalendarDate;
  endDate: CalendarDate | null;
}

/** Trava contra serie infinita em janela absurda. */
const MAX_OCCURRENCES = 500;

/**
 * Regra de repeticao de uma conta fixa.
 *
 * A armadilha que este VO resolve: "todo dia 31". Fevereiro nao tem dia 31, e
 * `Date.setMonth` resolve isso transbordando para 03/03 -- o que joga o
 * lancamento para o mes seguinte e some com ele do relatorio de fevereiro.
 * Aqui o dia e' AJUSTADO para o ultimo do mes, entao "todo dia 31" gera 31/01,
 * 28/02, 31/03 -- e o dia 31 volta nos meses que o tem, porque o `dayOfMonth`
 * original nunca e' sobrescrito.
 */
export class RecurrenceSchedule extends ValueObject<RecurrenceScheduleProps> {
  private constructor(props: RecurrenceScheduleProps) {
    super(props);
  }

  static create(props: {
    frequency: RecurrenceFrequency;
    interval?: number;
    dayOfMonth?: number | null;
    weekday?: number | null;
    monthOfYear?: number | null;
    startDate: CalendarDate;
    endDate?: CalendarDate | null;
  }): Either<InvalidValueError, RecurrenceSchedule> {
    const interval = props.interval ?? 1;

    if (!Number.isInteger(interval) || interval < 1) {
      return left(new InvalidValueError('O intervalo precisa ser um inteiro maior que zero.', 'interval'));
    }

    if (props.endDate && props.endDate.isBefore(props.startDate)) {
      return left(new InvalidValueError('A data final precisa ser depois da inicial.', 'endDate'));
    }

    if (props.frequency === RecurrenceFrequency.WEEKLY) {
      const weekday = props.weekday ?? props.startDate.weekday();

      if (weekday < 0 || weekday > 6) {
        return left(new InvalidValueError('Dia da semana invalido (0 = domingo).', 'weekday'));
      }

      return right(
        new RecurrenceSchedule({
          frequency: props.frequency,
          interval,
          dayOfMonth: null,
          weekday,
          monthOfYear: null,
          startDate: props.startDate,
          endDate: props.endDate ?? null,
        }),
      );
    }

    const dayOfMonth = props.dayOfMonth ?? props.startDate.day;

    if (dayOfMonth < 1 || dayOfMonth > 31) {
      return left(new InvalidValueError('Dia do mes precisa estar entre 1 e 31.', 'dayOfMonth'));
    }

    const monthOfYear =
      props.frequency === RecurrenceFrequency.YEARLY
        ? (props.monthOfYear ?? props.startDate.month)
        : null;

    if (monthOfYear !== null && (monthOfYear < 1 || monthOfYear > 12)) {
      return left(new InvalidValueError('Mes invalido.', 'monthOfYear'));
    }

    return right(
      new RecurrenceSchedule({
        frequency: props.frequency,
        interval,
        dayOfMonth,
        weekday: null,
        monthOfYear,
        startDate: props.startDate,
        endDate: props.endDate ?? null,
      }),
    );
  }

  get frequency(): RecurrenceFrequency {
    return this.props.frequency;
  }

  get interval(): number {
    return this.props.interval;
  }

  get dayOfMonth(): number | null {
    return this.props.dayOfMonth;
  }

  get weekday(): number | null {
    return this.props.weekday;
  }

  get monthOfYear(): number | null {
    return this.props.monthOfYear;
  }

  get startDate(): CalendarDate {
    return this.props.startDate;
  }

  get endDate(): CalendarDate | null {
    return this.props.endDate;
  }

  /**
   * Ocorrencias dentro de uma janela, inclusive nas duas pontas.
   *
   * E' o que o job diario chama para materializar os proximos 60 dias.
   */
  occurrencesBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
    if (to.isBefore(from)) {
      return [];
    }

    const occurrences: CalendarDate[] = [];

    for (const candidate of this.generate(to)) {
      if (candidate.isSameOrAfter(from)) {
        occurrences.push(candidate);
      }
    }

    return occurrences;
  }

  /** Proxima ocorrencia estritamente DEPOIS de `date`. */
  nextAfter(date: CalendarDate): CalendarDate | null {
    const horizon = date.addYears(5);

    for (const candidate of this.generate(horizon)) {
      if (candidate.isAfter(date)) {
        return candidate;
      }
    }

    return null;
  }

  /** Primeira ocorrencia da serie. */
  first(): CalendarDate | null {
    for (const candidate of this.generate(this.props.startDate.addYears(5))) {
      return candidate;
    }

    return null;
  }

  hasEnded(on: CalendarDate): boolean {
    return this.props.endDate !== null && on.isAfter(this.props.endDate);
  }

  /**
   * Sequencia de ocorrencias do inicio ate `until`.
   *
   * Sempre parte do `startDate`, nunca de um cursor guardado: recalcular do
   * zero e' barato e mantem a serie identica mesmo que a materializacao rode
   * duas vezes ou fora de ordem.
   */
  private *generate(until: CalendarDate): Generator<CalendarDate> {
    const limit = this.props.endDate?.isBefore(until) === true ? this.props.endDate : until;
    let produced = 0;

    if (this.props.frequency === RecurrenceFrequency.WEEKLY) {
      let cursor = this.alignToWeekday(this.props.startDate);

      while (cursor.isSameOrBefore(limit) && produced < MAX_OCCURRENCES) {
        yield cursor;
        produced += 1;
        cursor = cursor.addDays(7 * this.props.interval);
      }

      return;
    }

    const monthStep =
      this.props.frequency === RecurrenceFrequency.YEARLY ? 12 * this.props.interval : this.props.interval;

    const day = this.props.dayOfMonth ?? this.props.startDate.day;
    const startMonth = this.props.monthOfYear ?? this.props.startDate.month;

    // O primeiro ciclo pode cair antes do inicio da serie (ex.: serie comeca
    // em 15/01 com dia 10); nesse caso pula para o ciclo seguinte.
    let step = 0;
    let cursor = CalendarDate.clamped(this.props.startDate.year, startMonth, day);

    while (cursor.isBefore(this.props.startDate)) {
      step += 1;
      cursor = CalendarDate.clamped(this.props.startDate.year, startMonth + step * monthStep, day);
    }

    while (cursor.isSameOrBefore(limit) && produced < MAX_OCCURRENCES) {
      yield cursor;
      produced += 1;
      step += 1;
      // Recalcula sempre a partir do dia ORIGINAL: assim "todo dia 31" volta a
      // ser 31 em marco, mesmo tendo sido 28 em fevereiro.
      cursor = CalendarDate.clamped(this.props.startDate.year, startMonth + step * monthStep, day);
    }
  }

  private alignToWeekday(from: CalendarDate): CalendarDate {
    const target = this.props.weekday ?? from.weekday();
    const shift = (target - from.weekday() + 7) % 7;

    return shift === 0 ? from : from.addDays(shift);
  }
}
