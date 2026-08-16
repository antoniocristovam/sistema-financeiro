import type { Money } from './money.js';

/**
 * Formatacao por locale.
 *
 * Regra do produto: a MOEDA vem do workspace, o FORMATO vem do usuario. Um
 * brasileiro vendo um workspace em dolar le "US$ 1.234,56"; um americano vendo
 * o mesmo workspace le "$1,234.56". Por isso o locale e' parametro e a moeda
 * sai do proprio Money.
 */
export interface FormatMoneyOptions {
  /** Tag BCP-47: 'pt-BR', 'en-US'. */
  locale: string;
  /** `symbol` (R$ 1.234,56), `code` (BRL 1.234,56) ou `none` (1.234,56). */
  display?: 'symbol' | 'code' | 'none';
  /** Esconde os centavos quando o valor e' redondo. Util em grafico e resumo. */
  hideZeroCents?: boolean;
  /** Forca o sinal `+` em valores positivos (util em extrato). */
  alwaysShowSign?: boolean;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  const cached = formatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = build();
  formatterCache.set(key, formatter);
  return formatter;
}

/** `formatMoney(Money.fromCents(123456, 'BRL'), { locale: 'pt-BR' })` -> `R$ 1.234,56`. */
export function formatMoney(money: Money, options: FormatMoneyOptions): string {
  const { locale, display = 'symbol', hideZeroCents = false, alwaysShowSign = false } = options;

  const fractionDigits = hideZeroCents && money.toCents() % 100 === 0 ? 0 : 2;
  const cacheKey = `${locale}|${money.currency}|${display}|${fractionDigits}|${alwaysShowSign}`;

  const formatter = getFormatter(
    cacheKey,
    () =>
      new Intl.NumberFormat(locale, {
        style: display === 'none' ? 'decimal' : 'currency',
        currency: money.currency,
        currencyDisplay: display === 'code' ? 'code' : 'symbol',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        signDisplay: alwaysShowSign ? 'exceptZero' : 'auto',
      }),
  );

  return formatter.format(money.toDecimal());
}

/**
 * Formatacao compacta para grafico e cartao de resumo: `R$ 1,2 mil`.
 *
 * Nunca use em extrato, saldo ou qualquer numero que o usuario vai conferir
 * contra o banco -- compacto e' aproximado por definicao.
 */
export function formatMoneyCompact(money: Money, locale: string): string {
  const formatter = getFormatter(
    `compact|${locale}|${money.currency}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: money.currency,
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
  );

  return formatter.format(money.toDecimal());
}

/**
 * Le um valor digitado pelo usuario no formato do locale dele e devolve a
 * string decimal canonica ("1.234,56" em pt-BR -> "1234.56").
 *
 * Devolve `null` quando nao da para interpretar, para o chamador decidir a
 * mensagem de erro.
 */
export function parseLocalizedDecimal(input: string, locale: string): string | null {
  const trimmed = input.trim();

  if (trimmed === '') {
    return null;
  }

  // Descobre os separadores do locale em vez de assumir virgula ou ponto.
  const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
  const group = parts.find((part) => part.type === 'group')?.value ?? '';
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';

  // Filtra por lista de PERMISSAO em vez de remover simbolo de moeda. E' o que
  // faz "R$ 1.234,56" funcionar: em Unicode so o "$" e' simbolo de moeda, o "R"
  // e' letra -- remover `\p{Sc}` deixaria um "R" solto no meio do numero.
  const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', decimal]);
  if (group !== '') {
    allowed.add(group);
  }

  let normalized = Array.from(trimmed)
    .filter((char) => allowed.has(char))
    .join('');

  if (group !== '') {
    normalized = normalized.split(group).join('');
  }

  normalized = normalized.split(decimal).join('.');

  if (!/^[+-]?\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) {
    return null;
  }

  return normalized;
}
