import { z } from 'zod';

/**
 * Paginacao por cursor.
 *
 * Offset quebra em lista que recebe insercao no topo -- e o extrato recebe o
 * tempo todo. Com cursor, o usuario nunca ve a mesma transacao duas vezes nem
 * pula uma ao rolar.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const cursorPaginationQuerySchema = z.object({
  /** Cursor opaco devolvido pela pagina anterior. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

/** Constroi o envelope tipado de uma pagina de `itemSchema`. */
export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    /** `null` quando acabou. */
    nextCursor: z.string().nullable(),
    /**
     * Total absoluto, quando calcula-lo e' barato. Em listas grandes vem
     * `null` de proposito: `COUNT(*)` no extrato inteiro nao paga o preco.
     */
    total: z.number().int().nonnegative().nullable(),
  });
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/** Intervalo de datas fechado nas duas pontas, em dias de calendario. */
export const dateRangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((range) => range.from <= range.to, {
    message: 'A data inicial precisa ser anterior ou igual a final.',
    path: ['from'],
  });

export type DateRange = z.infer<typeof dateRangeSchema>;
