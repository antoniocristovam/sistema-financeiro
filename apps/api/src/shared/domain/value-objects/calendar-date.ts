import { type Either, left, right } from '../../either';
import { InvalidValueError } from '../errors/common-errors';
import { ValueObject } from '../value-object';

interface CalendarDateProps {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Dia de calendario, sem hora e sem fuso.
 *
 * Este VO existe por causa de uma armadilha especifica: "despesa do dia 31"
 * vira "dia 30" com uma facilidade desconcertante quando o valor carrega hora
 * e passa por conversao de fuso -- e em relatorio mensal isso joga o lancamento
 * para o MES ERRADO.
 *
 * Aqui nao existe hora para converter. Os campos sao ano, mes e dia; o `Date`
 * so aparece na fronteira com o banco (`toUtcDate`), sempre a meia-noite UTC.
 */
export class CalendarDate extends ValueObject<CalendarDateProps> {
  private constructor(props: CalendarDateProps) {
    super(props);
  }

  // -- Construcao ------------------------------------------------------------

  /** A partir de `YYYY-MM-DD`. */
  static create(value: string): Either<InvalidValueError, CalendarDate> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return left(new InvalidValueError(`Data invalida: ${value}. Use YYYY-MM-DD.`, 'date'));
    }

    const [year, month, day] = value.split('-').map(Number) as [number, number, number];

    return CalendarDate.fromParts(year, month, day);
  }

  static fromParts(
    year: number,
    month: number,
    day: number,
  ): Either<InvalidValueError, CalendarDate> {
    if (month < 1 || month > 12) {
      return left(new InvalidValueError(`Mes invalido: ${month}.`, 'date'));
    }

    if (day < 1 || day > daysInMonth(year, month)) {
      return left(
        new InvalidValueError(`Dia ${day} nao existe em ${String(month).padStart(2, '0')}/${year}.`, 'date'),
      );
    }

    return right(new CalendarDate({ year, month, day }));
  }

  /** Le os campos em UTC. Nunca use os getters locais de `Date` aqui. */
  static fromUtcDate(date: Date): CalendarDate {
    return new CalendarDate({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }

  /**
   * Igual a `fromParts`, mas AJUSTA o dia para o ultimo do mes em vez de
   * falhar. E' o que a recorrencia mensal precisa: "todo dia 31" em fevereiro
   * significa dia 28 (ou 29), nao "pula o mes".
   */
  static clamped(year: number, month: number, day: number): CalendarDate {
    const normalizedYear = year + Math.floor((month - 1) / 12);
    const normalizedMonth = ((((month - 1) % 12) + 12) % 12) + 1;
    const lastDay = daysInMonth(normalizedYear, normalizedMonth);

    return new CalendarDate({
      year: normalizedYear,
      month: normalizedMonth,
      day: Math.min(Math.max(day, 1), lastDay),
    });
  }

  // -- Leitura ---------------------------------------------------------------

  get year(): number {
    return this.props.year;
  }

  get month(): number {
    return this.props.month;
  }

  get day(): number {
    return this.props.day;
  }

  /** `YYYY-MM-DD`. E' tambem a forma canonica de comparacao lexicografica. */
  override toString(): string {
    const year = String(this.props.year).padStart(4, '0');
    const month = String(this.props.month).padStart(2, '0');
    const day = String(this.props.day).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /** Meia-noite UTC. E' assim que a coluna `@db.Date` recebe o valor. */
  toUtcDate(): Date {
    return new Date(Date.UTC(this.props.year, this.props.month - 1, this.props.day));
  }

  /** `YYYY-MM`, para casar com `referenceMonth`. */
  toMonthKey(): string {
    return this.toString().slice(0, 7);
  }

  // -- Operacoes -------------------------------------------------------------

  /**
   * Soma meses AJUSTANDO o dia. 31/01 + 1 mes = 28/02 (ou 29 em bissexto),
   * nunca 03/03 -- que e' o que `Date.setMonth` faz.
   */
  addMonths(months: number): CalendarDate {
    return CalendarDate.clamped(this.props.year, this.props.month + months, this.props.day);
  }

  addDays(days: number): CalendarDate {
    const shifted = new Date(this.toUtcDate().getTime() + days * 86_400_000);
    return CalendarDate.fromUtcDate(shifted);
  }

  addYears(years: number): CalendarDate {
    return CalendarDate.clamped(this.props.year + years, this.props.month, this.props.day);
  }

  startOfMonth(): CalendarDate {
    return new CalendarDate({ year: this.props.year, month: this.props.month, day: 1 });
  }

  endOfMonth(): CalendarDate {
    return new CalendarDate({
      year: this.props.year,
      month: this.props.month,
      day: daysInMonth(this.props.year, this.props.month),
    });
  }

  /** Dias inteiros entre as duas datas (positivo se `other` for depois). */
  daysUntil(other: CalendarDate): number {
    return Math.round((other.toUtcDate().getTime() - this.toUtcDate().getTime()) / 86_400_000);
  }

  /** 0 = domingo. */
  weekday(): number {
    return this.toUtcDate().getUTCDay();
  }

  // -- Comparacao ------------------------------------------------------------

  compare(other: CalendarDate): -1 | 0 | 1 {
    const self = this.toString();
    const target = other.toString();

    if (self < target) return -1;
    if (self > target) return 1;
    return 0;
  }

  isBefore(other: CalendarDate): boolean {
    return this.compare(other) === -1;
  }

  isAfter(other: CalendarDate): boolean {
    return this.compare(other) === 1;
  }

  isSameOrBefore(other: CalendarDate): boolean {
    return this.compare(other) <= 0;
  }

  isSameOrAfter(other: CalendarDate): boolean {
    return this.compare(other) >= 0;
  }

  isBetween(from: CalendarDate, to: CalendarDate): boolean {
    return this.isSameOrAfter(from) && this.isSameOrBefore(to);
  }
}

/** Dias do mes, com bissexto pela regra completa (100 nao, 400 sim). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
