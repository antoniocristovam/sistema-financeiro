import { type Either, left, right } from '../../either';
import { InvalidValueError } from '../errors/common-errors';
import { ValueObject } from '../value-object';
import { CalendarDate } from './calendar-date';

interface MonthReferenceProps {
  year: number;
  month: number; // 1-12
}

/**
 * Mes de competencia (`YYYY-MM`).
 *
 * Orcamento, fatura e relatorio mensal se referem a um MES, nao a um dia. Ter
 * um tipo proprio evita o erro classico de comparar `Date` do dia 1 com `Date`
 * do dia 15 e concluir que sao meses diferentes.
 *
 * No banco vira o PRIMEIRO DIA do mes, como `@db.Date`.
 */
export class MonthReference extends ValueObject<MonthReferenceProps> {
  private constructor(props: MonthReferenceProps) {
    super(props);
  }

  static create(value: string): Either<InvalidValueError, MonthReference> {
    if (!/^\d{4}-\d{2}$/.test(value)) {
      return left(new InvalidValueError(`Mes invalido: ${value}. Use YYYY-MM.`, 'referenceMonth'));
    }

    const [year, month] = value.split('-').map(Number) as [number, number];

    if (month < 1 || month > 12) {
      return left(new InvalidValueError(`Mes invalido: ${month}.`, 'referenceMonth'));
    }

    return right(new MonthReference({ year, month }));
  }

  static fromParts(year: number, month: number): MonthReference {
    const normalizedYear = year + Math.floor((month - 1) / 12);
    const normalizedMonth = ((((month - 1) % 12) + 12) % 12) + 1;

    return new MonthReference({ year: normalizedYear, month: normalizedMonth });
  }

  static fromDate(date: CalendarDate): MonthReference {
    return new MonthReference({ year: date.year, month: date.month });
  }

  static fromUtcDate(date: Date): MonthReference {
    return new MonthReference({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }

  get year(): number {
    return this.props.year;
  }

  get month(): number {
    return this.props.month;
  }

  override toString(): string {
    return `${String(this.props.year).padStart(4, '0')}-${String(this.props.month).padStart(2, '0')}`;
  }

  firstDay(): CalendarDate {
    return CalendarDate.clamped(this.props.year, this.props.month, 1);
  }

  lastDay(): CalendarDate {
    return this.firstDay().endOfMonth();
  }

  /** Primeiro dia do mes, em UTC. E' o valor gravado em `referenceMonth`. */
  toUtcDate(): Date {
    return this.firstDay().toUtcDate();
  }

  next(): MonthReference {
    return MonthReference.fromParts(this.props.year, this.props.month + 1);
  }

  previous(): MonthReference {
    return MonthReference.fromParts(this.props.year, this.props.month - 1);
  }

  add(months: number): MonthReference {
    return MonthReference.fromParts(this.props.year, this.props.month + months);
  }

  /** Meses inteiros ate `other` (negativo se `other` for anterior). */
  monthsUntil(other: MonthReference): number {
    return (other.year - this.props.year) * 12 + (other.month - this.props.month);
  }

  contains(date: CalendarDate): boolean {
    return date.year === this.props.year && date.month === this.props.month;
  }

  compare(other: MonthReference): -1 | 0 | 1 {
    const self = this.toString();
    const target = other.toString();

    if (self < target) return -1;
    if (self > target) return 1;
    return 0;
  }

  isBefore(other: MonthReference): boolean {
    return this.compare(other) === -1;
  }

  isAfter(other: MonthReference): boolean {
    return this.compare(other) === 1;
  }
}
