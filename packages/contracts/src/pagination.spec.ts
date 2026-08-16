import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiErrorCode, apiErrorSchema } from './errors.js';
import { listTransactionsQuerySchema } from './transaction.js';
import {
  cursorPaginationQuerySchema,
  dateRangeSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginatedSchema,
} from './pagination.js';

describe('cursorPaginationQuerySchema', () => {
  it('aplica o tamanho de pagina padrao', () => {
    expect(cursorPaginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
  });

  it('coage o limite vindo da query string', () => {
    // Query string chega como texto; o schema converte para numero.
    expect(cursorPaginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('recusa limite acima do maximo', () => {
    expect(cursorPaginationQuerySchema.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(cursorPaginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe('paginatedSchema', () => {
  it('envelopa a lista com cursor e total opcional', () => {
    const schema = paginatedSchema(z.object({ id: z.string() }));

    const parsed = schema.parse({
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'cursor-2',
      total: null,
    });

    expect(parsed.items).toHaveLength(2);
    expect(parsed.nextCursor).toBe('cursor-2');
    // `total` nulo e' legitimo: contar o extrato inteiro nao paga o preco.
    expect(parsed.total).toBeNull();
  });

  it('recusa item fora do formato', () => {
    const schema = paginatedSchema(z.object({ id: z.string() }));

    expect(schema.safeParse({ items: [{ id: 1 }], nextCursor: null, total: 1 }).success).toBe(
      false,
    );
  });
});

describe('dateRangeSchema', () => {
  it('aceita intervalo valido, inclusive de um dia so', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: '2026-01-15', to: '2026-01-15' }).success).toBe(true);
  });

  it('recusa intervalo invertido apontando o campo certo', () => {
    const result = dateRangeSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['from']);
  });
});

describe('apiErrorSchema', () => {
  it('aceita erro simples', () => {
    const parsed = apiErrorSchema.parse({
      code: ApiErrorCode.NOT_FOUND,
      message: 'Transacao nao encontrada.',
    });

    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.issues).toBeUndefined();
  });

  it('aceita erro de validacao com caminho por campo', () => {
    const parsed = apiErrorSchema.parse({
      code: ApiErrorCode.VALIDATION_FAILED,
      message: 'Dados invalidos.',
      issues: [{ path: ['participants', 0, 'shareValue'], message: 'Informe o valor.' }],
      traceId: 'abc-123',
    });

    // O caminho aceita indice numerico para o front apontar a linha do array.
    expect(parsed.issues?.[0]?.path).toEqual(['participants', 0, 'shareValue']);
  });
});

describe('zBooleanQueryParam', () => {
  it('trata a STRING "false" como falso', () => {
    // `z.coerce.boolean()` faria `Boolean('false') === true`, e o filtro
    // `?includeTransfers=false` simplesmente nao funcionaria -- sem erro
    // nenhum para denunciar. Ja aconteceu duas vezes neste projeto.
    expect(listTransactionsQuerySchema.parse({ includeTransfers: 'false' }).includeTransfers).toBe(
      false,
    );
  });

  it('aceita as formas comuns de verdadeiro e falso', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      expect(
        listTransactionsQuerySchema.parse({ includeTransfers: value }).includeTransfers,
        value,
      ).toBe(true);
    }

    for (const value of ['false', '0', 'no', 'off', '']) {
      expect(
        listTransactionsQuerySchema.parse({ includeTransfers: value }).includeTransfers,
        value,
      ).toBe(false);
    }
  });

  it('usa o padrao quando ausente', () => {
    expect(listTransactionsQuerySchema.parse({}).includeTransfers).toBe(true);
  });
});
