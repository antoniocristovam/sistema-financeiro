import { InvalidMoneyError } from './errors.js';

/** Casas decimais. Fixo em 2: o app so opera moedas de centavo (BRL, USD). */
export const SCALE = 2;

const FACTOR = 10 ** SCALE;

/**
 * Arredonda meio para longe do zero (`half away from zero`).
 *
 * E' o arredondamento "comercial", o que a pessoa espera ver: 2,5 -> 3 e
 * -2,5 -> -3. O `Math.round` do JS erra o lado no negativo (-2,5 -> -2), o que
 * faz uma despesa e o estorno dela nao se cancelarem.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Converte um valor decimal em centavos SEM passar por multiplicacao de float.
 *
 * `19.99 * 100` da 1998.9999999999998 em ponto flutuante. Multiplicar e
 * arredondar funciona quase sempre -- e o "quase" e' exatamente o tipo de bug
 * que ninguem acha, porque erra um centavo em um lancamento a cada mil.
 *
 * Aqui o numero vira string e os digitos sao lidos posicionalmente, entao a
 * unica decisao e' o arredondamento da 3a casa em diante.
 */
export function decimalToCents(value: number | string): number {
  const raw = typeof value === 'number' ? numberToDecimalString(value) : value.trim();

  if (raw === '') {
    throw new InvalidMoneyError('Valor decimal vazio.');
  }

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);

  if (!match) {
    throw new InvalidMoneyError(`Valor decimal invalido: ${raw}`);
  }

  const [, sign = '', integerPart = '', fractionPart = ''] = match;

  if (integerPart === '' && fractionPart === '') {
    throw new InvalidMoneyError(`Valor decimal invalido: ${raw}`);
  }

  const keptFraction = fractionPart.slice(0, SCALE).padEnd(SCALE, '0');
  const nextDigit = fractionPart.charAt(SCALE);

  const magnitude = Number(`${integerPart || '0'}${keptFraction}`);

  if (!Number.isSafeInteger(magnitude)) {
    throw new InvalidMoneyError(`Valor fora do intervalo seguro: ${raw}`);
  }

  // Arredonda a partir da 3a casa decimal, meio para cima em magnitude.
  const rounded = nextDigit !== '' && Number(nextDigit) >= 5 ? magnitude + 1 : magnitude;

  return sign === '-' ? -rounded : rounded;
}

/**
 * `String(n)` usa notacao cientifica em numeros muito pequenos (`1e-7`), que a
 * leitura posicional nao entende. `toFixed` normaliza, com casas de sobra para
 * o arredondamento decidir corretamente.
 */
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new InvalidMoneyError(`Valor nao finito: ${String(value)}`);
  }

  const asString = String(value);
  return asString.includes('e') || asString.includes('E') ? value.toFixed(SCALE + 4) : asString;
}

/** Centavos -> string decimal com ponto, sem separador de milhar. */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(SCALE + 1, '0');
  const integerPart = digits.slice(0, -SCALE);
  const fractionPart = digits.slice(-SCALE);

  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

export { FACTOR };
