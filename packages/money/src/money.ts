import { allocate, allocateEvenly } from './allocate.js';
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyError,
} from './errors.js';
import { centsToDecimalString, decimalToCents, roundHalfAwayFromZero } from './parse.js';

/** Codigo ISO 4217 (3 letras maiusculas). */
export type CurrencyCode = string;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Value Object de dinheiro.
 *
 * Imutavel, com construtor privado: so se cria por `fromCents` ou `fromDecimal`,
 * o que garante que todo Money do sistema nasceu de um inteiro em centavos.
 * Nao existe `Money` com valor fracionario, e nao existe operacao entre moedas
 * diferentes -- somar BRL com USD lanca em vez de silenciosamente errar.
 */
export class Money {
  readonly #cents: number;
  readonly #currency: CurrencyCode;

  private constructor(cents: number, currency: CurrencyCode) {
    this.#cents = cents;
    this.#currency = currency;
    Object.freeze(this);
  }

  // -- Construcao ------------------------------------------------------------

  /** Caminho canonico: o valor JA esta em centavos, como no banco. */
  static fromCents(cents: number, currency: CurrencyCode): Money {
    if (!Number.isInteger(cents)) {
      throw new InvalidMoneyError(
        `Centavos precisam ser inteiros: ${String(cents)}. Use fromDecimal para valores com casas.`,
      );
    }

    if (!Number.isSafeInteger(cents)) {
      throw new InvalidMoneyError(`Valor fora do intervalo seguro: ${String(cents)}`);
    }

    return new Money(cents, normalizeCurrency(currency));
  }

  /**
   * Entrada humana ("1234,56" ja normalizada para "1234.56", ou 1234.56).
   *
   * Prefira passar STRING: o numero 0.1 + 0.2 nao e' 0.3 em ponto flutuante, e
   * a string preserva exatamente o que o usuario digitou.
   */
  static fromDecimal(value: number | string, currency: CurrencyCode): Money {
    return new Money(decimalToCents(value), normalizeCurrency(currency));
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0, normalizeCurrency(currency));
  }

  /** Soma uma lista. Lista vazia exige a moeda, senao nao ha o que retornar. */
  static sum(values: readonly Money[], currency?: CurrencyCode): Money {
    if (values.length === 0) {
      if (currency === undefined) {
        throw new InvalidMoneyError('Soma de lista vazia precisa da moeda explicita.');
      }
      return Money.zero(currency);
    }

    return values.reduce((total, value) => total.plus(value));
  }

  // -- Leitura ---------------------------------------------------------------

  get currency(): CurrencyCode {
    return this.#currency;
  }

  /** Valor bruto em centavos. E' o que vai para o banco. */
  toCents(): number {
    return this.#cents;
  }

  /**
   * Valor decimal como NUMERO. Use so para exibicao ou grafico -- nunca para
   * gravar nem para continuar calculando.
   */
  toDecimal(): number {
    return Number(centsToDecimalString(this.#cents));
  }

  /** Valor decimal como string exata, sem risco de ponto flutuante. */
  toDecimalString(): string {
    return centsToDecimalString(this.#cents);
  }

  toJSON(): { amountInCents: number; currency: CurrencyCode } {
    return { amountInCents: this.#cents, currency: this.#currency };
  }

  toString(): string {
    return `${this.#currency} ${centsToDecimalString(this.#cents)}`;
  }

  // -- Aritmetica ------------------------------------------------------------

  plus(other: Money): Money {
    this.#assertSameCurrency(other);
    return Money.fromCents(this.#cents + other.#cents, this.#currency);
  }

  minus(other: Money): Money {
    this.#assertSameCurrency(other);
    return Money.fromCents(this.#cents - other.#cents, this.#currency);
  }

  /**
   * Multiplica por um fator (3 parcelas, 1,1 de reajuste).
   *
   * Arredonda meio para longe do zero. Se o resultado precisa ser repartido
   * entre pessoas, use `allocate` -- multiplicar e depois somar perde centavo.
   */
  times(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new InvalidMoneyError(`Fator invalido: ${String(factor)}`);
    }

    return Money.fromCents(roundHalfAwayFromZero(this.#cents * factor), this.#currency);
  }

  /** Percentual em PONTOS-BASE (10% = 1000), para nao carregar float na regra. */
  percentage(basisPoints: number): Money {
    if (!Number.isFinite(basisPoints)) {
      throw new InvalidMoneyError(`Pontos-base invalidos: ${String(basisPoints)}`);
    }

    return Money.fromCents(
      roundHalfAwayFromZero((this.#cents * basisPoints) / 10_000),
      this.#currency,
    );
  }

  negate(): Money {
    return Money.fromCents(-this.#cents, this.#currency);
  }

  abs(): Money {
    return Money.fromCents(Math.abs(this.#cents), this.#currency);
  }

  // -- Rateio ----------------------------------------------------------------

  /**
   * Reparte entre pesos sem perder centavo. `sum(resultado) === this`.
   *
   * Os centavos de resto vao para os primeiros pesos em caso de empate, que e'
   * o que a divisao igualitaria espera.
   */
  allocate(weights: readonly number[]): Money[] {
    return allocate(this.#cents, weights).map((cents) => Money.fromCents(cents, this.#currency));
  }

  /** Divide em partes iguais: `Money(100,00).split(3)` -> 33,34 / 33,33 / 33,33. */
  split(parts: number): Money[] {
    return allocateEvenly(this.#cents, parts).map((cents) =>
      Money.fromCents(cents, this.#currency),
    );
  }

  // -- Comparacao ------------------------------------------------------------

  equals(other: Money): boolean {
    return this.#cents === other.#cents && this.#currency === other.#currency;
  }

  /** -1, 0 ou 1. Serve direto em `Array.prototype.sort`. */
  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    if (this.#cents < other.#cents) return -1;
    if (this.#cents > other.#cents) return 1;
    return 0;
  }

  isGreaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  isLessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  isLessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isZero(): boolean {
    return this.#cents === 0;
  }

  isPositive(): boolean {
    return this.#cents > 0;
  }

  isNegative(): boolean {
    return this.#cents < 0;
  }

  // -- Internos --------------------------------------------------------------

  #assertSameCurrency(other: Money): void {
    if (this.#currency !== other.#currency) {
      throw new CurrencyMismatchError(this.#currency, other.#currency);
    }
  }
}

function normalizeCurrency(currency: CurrencyCode): CurrencyCode {
  if (typeof currency !== 'string') {
    throw new InvalidCurrencyError(currency);
  }

  const normalized = currency.trim().toUpperCase();

  if (!CURRENCY_PATTERN.test(normalized)) {
    throw new InvalidCurrencyError(currency);
  }

  return normalized;
}
