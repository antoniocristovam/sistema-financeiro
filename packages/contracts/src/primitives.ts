import { z } from 'zod';

/**
 * Primitivas compartilhadas por todos os schemas.
 *
 * Se um formato aparece em mais de um lugar, ele mora aqui. E' o que impede
 * "senha tem 8 caracteres" virar tres regras ligeiramente diferentes em tres
 * endpoints.
 */

export const zUuid = z.string().uuid('Identificador invalido.');

/**
 * Valor monetario. SEMPRE inteiro em centavos -- a API nao aceita decimal em
 * nenhuma ponta. O front converte com `Money.fromDecimal` antes de enviar.
 */
export const zCents = z
  .number()
  .int('Valores monetarios sao inteiros em centavos.')
  .safe('Valor fora do intervalo suportado.');

/** Valor de lancamento: positivo. O sinal vem do `type`, nunca do numero. */
export const zAmountInCents = zCents.positive('O valor precisa ser maior que zero.');

/** Saldo, limite, total: pode ser zero, nao pode ser negativo. */
export const zNonNegativeCents = zCents.min(0, 'O valor nao pode ser negativo.');

/** Saldo inicial e ajuste: pode ser negativo (conta no vermelho). */
export const zSignedCents = zCents;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dia de calendario (`YYYY-MM-DD`), sem hora e sem fuso.
 *
 * Data de lancamento, vencimento e competencia trafegam assim de proposito.
 * Mandar `DateTime` faria "despesa do dia 31" virar "dia 30" na conversao de
 * fuso -- e em relatorio mensal isso joga o lancamento para o mes errado.
 */
export const zCalendarDate = z
  .string()
  .regex(CALENDAR_DATE_PATTERN, 'Use o formato YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'Data inexistente no calendario.');

/** Mes de competencia (`YYYY-MM`). Vira o primeiro dia do mes no banco. */
export const zMonthReference = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato YYYY-MM.');

/** Instante em UTC (ISO 8601). Para `createdAt`, `expiresAt` e afins. */
export const zInstant = z.string().datetime({ offset: true });

/** ISO 4217 em maiusculas. */
export const zCurrencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Codigo de moeda invalido (ISO 4217, ex.: BRL).');

/**
 * Percentual em PONTOS-BASE: 100% = 10000, 33,33% = 3333.
 *
 * Percentual nunca trafega como float. Somar 33.33 tres vezes nao da 100, e
 * essa e' exatamente a conta que a divisao de despesa precisa fechar.
 */
export const zBasisPoints = z
  .number()
  .int('Percentual em pontos-base precisa ser inteiro (33,33% = 3333).')
  .min(0, 'Percentual nao pode ser negativo.')
  .max(10_000, 'Percentual nao pode passar de 100%.');

/**
 * Booleano vindo de query string.
 *
 * NAO use `z.coerce.boolean()`: ele faz `Boolean(value)`, e toda string nao
 * vazia e' truthy -- entao `?includeTransfers=false` chega como `true` e o
 * filtro simplesmente nao funciona, sem erro nenhum para denunciar.
 */
export const zBooleanQueryParam = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === 'boolean'
        ? value
        : ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()),
    );

export const zHexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor invalida. Use hexadecimal (#RRGGBB).');

/** Nome de icone do lucide-react. */
export const zIconName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Icone invalido.');

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('E-mail invalido.')
  .max(255, 'E-mail longo demais.');

/**
 * Senha: minimo 8 caracteres, ao menos uma maiuscula e ao menos um numero.
 *
 * As regras sao checadas separadamente para o usuario ver O QUE falta, em vez
 * de receber "senha invalida" e ter que adivinhar.
 */
export const zPassword = z
  .string()
  .min(8, 'A senha precisa de pelo menos 8 caracteres.')
  .max(72, 'A senha pode ter no maximo 72 caracteres.')
  .regex(/[A-Z]/, 'A senha precisa de pelo menos uma letra maiuscula.')
  .regex(/[0-9]/, 'A senha precisa de pelo menos um numero.');

export const zDisplayName = z
  .string()
  .trim()
  .min(1, 'Informe um nome.')
  .max(120, 'Nome longo demais.');

export const zShortLabel = z.string().trim().min(1, 'Campo obrigatorio.').max(80);

export const zDescription = z.string().trim().min(1, 'Informe uma descricao.').max(255);

export const zNote = z.string().trim().max(2000).optional();

/** Dia do mes (1-31). Mes curto usa o ultimo dia disponivel na materializacao. */
export const zDayOfMonth = z
  .number()
  .int()
  .min(1, 'Dia precisa estar entre 1 e 31.')
  .max(31, 'Dia precisa estar entre 1 e 31.');

/** Ano-base da declaracao anual. */
export const zReferenceYear = z.number().int().min(1900).max(2999);

// -- Helpers -----------------------------------------------------------------

/** Rejeita 2026-02-30 e 2026-13-01, que passam pelo regex. */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `'2026-03-15'` -> `Date` em UTC. Uso no servidor, ao montar a query. */
export function calendarDateToUtc(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

/** `Date` -> `'2026-03-15'`. Le os campos em UTC, nunca no fuso local. */
export function utcToCalendarDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** `'2026-03'` -> `Date` do primeiro dia do mes, em UTC. */
export function monthReferenceToUtc(value: string): Date {
  const [year, month] = value.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1));
}

/** `Date` -> `'2026-03'`. */
export function utcToMonthReference(date: Date): string {
  return utcToCalendarDate(date).slice(0, 7);
}
