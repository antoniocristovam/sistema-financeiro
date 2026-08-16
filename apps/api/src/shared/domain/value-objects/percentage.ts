import { Money } from '@finapp/money';

import { type Either, left, right } from '../../either';
import { InvalidValueError } from '../errors/common-errors';
import { ValueObject } from '../value-object';

interface PercentageProps {
  basisPoints: number;
}

/**
 * Percentual em PONTOS-BASE (100% = 10000, 33,33% = 3333).
 *
 * Percentual nunca e' float aqui. Somar `33.33` tres vezes da `99.99000000001`
 * e nao fecha em 100 -- e fechar exatamente e' o requisito da divisao de
 * despesa. Em inteiro, 3333 + 3333 + 3334 = 10000, ponto final.
 */
export class Percentage extends ValueObject<PercentageProps> {
  static readonly SCALE = 10_000;

  private constructor(props: PercentageProps) {
    super(props);
  }

  static fromBasisPoints(basisPoints: number): Either<InvalidValueError, Percentage> {
    if (!Number.isInteger(basisPoints)) {
      return left(
        new InvalidValueError('Percentual precisa ser inteiro em pontos-base (33,33% = 3333).'),
      );
    }

    if (basisPoints < 0 || basisPoints > Percentage.SCALE) {
      return left(new InvalidValueError('Percentual precisa estar entre 0% e 100%.'));
    }

    return right(new Percentage({ basisPoints }));
  }

  /** Aceita `33.33` da UI e converte arredondando para o centesimo. */
  static fromPercent(percent: number): Either<InvalidValueError, Percentage> {
    if (!Number.isFinite(percent)) {
      return left(new InvalidValueError('Percentual invalido.'));
    }

    return Percentage.fromBasisPoints(Math.round(percent * 100));
  }

  get basisPoints(): number {
    return this.props.basisPoints;
  }

  /** Valor legivel: 3333 -> 33.33. So para exibicao. */
  toPercent(): number {
    return this.props.basisPoints / 100;
  }

  applyTo(money: Money): Money {
    return money.percentage(this.props.basisPoints);
  }

  isZero(): boolean {
    return this.props.basisPoints === 0;
  }

  isFull(): boolean {
    return this.props.basisPoints === Percentage.SCALE;
  }

  override toString(): string {
    return `${this.toPercent().toFixed(2).replace('.', ',')}%`;
  }
}
