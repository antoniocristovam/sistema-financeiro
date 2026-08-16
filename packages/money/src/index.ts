/**
 * @finapp/money
 *
 * Value Object Money: puro, imutavel, sem dependencia de runtime.
 *
 * Regra 1 do dominio: dinheiro e' sempre inteiro em centavos. Nunca float.
 * Este pacote e' a unica porta de entrada para aritmetica monetaria no sistema
 * -- nem a API nem o web fazem conta com numero solto.
 */

export { Money, type CurrencyCode } from './money.js';
export { allocate, allocateEvenly } from './allocate.js';
export {
  formatMoney,
  formatMoneyCompact,
  parseLocalizedDecimal,
  type FormatMoneyOptions,
} from './format.js';
export { decimalToCents, centsToDecimalString, roundHalfAwayFromZero, SCALE } from './parse.js';
export {
  MoneyError,
  CurrencyMismatchError,
  InvalidMoneyError,
  InvalidCurrencyError,
  InvalidAllocationError,
} from './errors.js';
