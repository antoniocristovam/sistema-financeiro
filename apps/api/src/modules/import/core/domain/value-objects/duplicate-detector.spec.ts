import { describe, expect, it } from 'vitest';

import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import {
  DuplicateDetector,
  type CandidateTransaction,
  type StagedRow,
} from './duplicate-detector';
import { normalizeMemo } from './memo-normalizer';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const ACCOUNT = 'acc-1';
const OTHER_ACCOUNT = 'acc-2';

const candidate = (overrides: Partial<CandidateTransaction> = {}): CandidateTransaction => ({
  id: 'tx-1',
  date: day('2026-03-10'),
  amountInCents: 4875,
  normalizedMemo: normalizeMemo('SUPERMERCADO BOM PRECO LTDA'),
  externalId: null,
  importHash: null,
  ...overrides,
});

const row = (overrides: Partial<StagedRow> = {}): StagedRow => ({
  date: day('2026-03-10'),
  amountInCents: 4875,
  memo: 'SUPERMERCADO BOM PRECO LTDA',
  fitId: null,
  ...overrides,
});

describe('DuplicateDetector', () => {
  describe('FITID (OFX)', () => {
    it('e autoritativo: mesmo FITID na mesma conta e duplicata', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ fitId: 'FIT-123' }), [
        candidate({ externalId: 'FIT-123' }),
      ]);

      expect(result.status).toBe('DUPLICATE');
      expect(result.matchedTransactionId).toBe('tx-1');
    });

    it('vence mesmo com descricao e valor diferentes', () => {
      const result = DuplicateDetector.detect(
        ACCOUNT,
        row({ fitId: 'FIT-123', memo: 'OUTRA COISA', amountInCents: 999 }),
        [candidate({ externalId: 'FIT-123' })],
      );

      expect(result.status).toBe('DUPLICATE');
    });

    it('NAO e unico no mundo: o escopo e por conta', () => {
      // O candidato veio de outra conta e nao entra na lista -- e' o indice
      // `(accountId, externalId)` que garante isso no banco. Assumir unicidade
      // global faria lancamentos de bancos diferentes se anularem.
      const result = DuplicateDetector.detect(OTHER_ACCOUNT, row({ fitId: 'FIT-123' }), []);

      expect(result.status).toBe('NEW');
    });

    it('FITID vazio nao casa com nada', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ fitId: '' }), [
        candidate({ externalId: '' }),
      ]);

      expect(result.status).not.toBe('DUPLICATE');
    });
  });

  describe('hash exato (CSV)', () => {
    it('marca duplicata quando conta, data, valor e memo batem', () => {
      const hash = DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4875, 'SUPERMERCADO BOM PRECO');
      const result = DuplicateDetector.detect(ACCOUNT, row({ memo: 'SUPERMERCADO BOM PRECO' }), [
        candidate({ importHash: hash }),
      ]);

      expect(result.status).toBe('DUPLICATE');
    });

    it('o hash e estavel para descricoes que so diferem em ruido', () => {
      const a = DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4875, 'SUPERMERCADO BOM PRECO LTDA');
      const b = DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4875, 'supermercado bom preço  *1234');

      expect(a).toBe(b);
    });

    it('muda quando a conta muda', () => {
      const a = DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4875, 'MERCADO');
      const b = DuplicateDetector.hash(OTHER_ACCOUNT, day('2026-03-10'), 4875, 'MERCADO');

      expect(a).not.toBe(b);
    });

    it('muda quando o valor ou a data mudam', () => {
      const base = DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4875, 'MERCADO');

      expect(DuplicateDetector.hash(ACCOUNT, day('2026-03-10'), 4876, 'MERCADO')).not.toBe(base);
      expect(DuplicateDetector.hash(ACCOUNT, day('2026-03-11'), 4875, 'MERCADO')).not.toBe(base);
    });
  });

  describe('heuristica de similaridade', () => {
    it('marca SIMILAR com valor igual, data proxima e descricao parecida', () => {
      const result = DuplicateDetector.detect(
        ACCOUNT,
        row({ date: day('2026-03-12'), memo: 'SUPERMERCADO BOM PRECO *4321' }),
        [candidate({ date: day('2026-03-10') })],
      );

      expect(result.status).toBe('SIMILAR');
      expect(result.matchedTransactionId).toBe('tx-1');
      expect(result.similarityScore).toBeGreaterThanOrEqual(700);
    });

    it('NAO decide sozinha: SIMILAR volta para o usuario', () => {
      // Duas compras iguais no mesmo lugar em dias proximos sao perfeitamente
      // possiveis -- por isso nao vira DUPLICATE automaticamente.
      const result = DuplicateDetector.detect(ACCOUNT, row({ date: day('2026-03-12') }), [
        candidate({ date: day('2026-03-10') }),
      ]);

      expect(result.status).toBe('SIMILAR');
      expect(result.status).not.toBe('DUPLICATE');
    });

    it('respeita a tolerancia de 3 dias', () => {
      const dentro = DuplicateDetector.detect(ACCOUNT, row({ date: day('2026-03-13') }), [
        candidate({ date: day('2026-03-10') }),
      ]);

      const fora = DuplicateDetector.detect(ACCOUNT, row({ date: day('2026-03-14') }), [
        candidate({ date: day('2026-03-10') }),
      ]);

      expect(dentro.status).toBe('SIMILAR');
      expect(fora.status).toBe('NEW');
    });

    it('vale para os dois lados da tolerancia', () => {
      const antes = DuplicateDetector.detect(ACCOUNT, row({ date: day('2026-03-07') }), [
        candidate({ date: day('2026-03-10') }),
      ]);

      expect(antes.status).toBe('SIMILAR');
    });

    it('exige valor IDENTICO: um centavo de diferenca ja e outro lancamento', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ amountInCents: 4876 }), [
        candidate({ amountInCents: 4875 }),
      ]);

      expect(result.status).toBe('NEW');
    });

    it('exige similaridade acima do corte', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ memo: 'POSTO DE GASOLINA XYZ' }), [
        candidate({ normalizedMemo: normalizeMemo('SUPERMERCADO BOM PRECO') }),
      ]);

      expect(result.status).toBe('NEW');
    });

    it('escolhe o candidato mais parecido quando ha varios', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ memo: 'SUPERMERCADO BOM PRECO' }), [
        candidate({ id: 'quase', normalizedMemo: normalizeMemo('SUPERMERCADO BOM PRECO SUL') }),
        candidate({ id: 'exato', normalizedMemo: normalizeMemo('SUPERMERCADO BOM PRECO') }),
      ]);

      expect(result.matchedTransactionId).toBe('exato');
      expect(result.similarityScore).toBe(1000);
    });
  });

  describe('precedencia', () => {
    it('FITID vence hash e heuristica', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row({ fitId: 'FIT-9' }), [
        candidate({ id: 'por-fitid', externalId: 'FIT-9', normalizedMemo: 'nada a ver' }),
        candidate({ id: 'por-similaridade' }),
      ]);

      expect(result.matchedTransactionId).toBe('por-fitid');
    });

    it('sem candidato, a linha e nova', () => {
      const result = DuplicateDetector.detect(ACCOUNT, row(), []);

      expect(result.status).toBe('NEW');
      expect(result.matchedTransactionId).toBeNull();
      expect(result.similarityScore).toBeNull();
      // O hash sai calculado de qualquer forma, para gravar na transacao.
      expect(result.importHash).toHaveLength(64);
    });
  });

  describe('reimportacao do mesmo extrato', () => {
    it('nao deixa passar nenhuma linha na segunda vez', () => {
      // Importar janeiro duas vezes dobraria o mes inteiro sem esta checagem.
      const rows = [
        row({ memo: 'SALARIO', amountInCents: 850_000, date: day('2026-03-05') }),
        row({ memo: 'ALUGUEL', amountInCents: -210_000, date: day('2026-03-10') }),
        row({ memo: 'MERCADO', amountInCents: -4875, date: day('2026-03-12') }),
      ];

      // Primeira importacao: tudo novo.
      const first = rows.map((current) => DuplicateDetector.detect(ACCOUNT, current, []));
      expect(first.every((result) => result.status === 'NEW')).toBe(true);

      // Agora as linhas viraram transacoes com o hash gravado.
      const existing: CandidateTransaction[] = first.map((result, index) => ({
        id: `tx-${index}`,
        date: rows[index]!.date,
        amountInCents: rows[index]!.amountInCents,
        normalizedMemo: result.normalizedMemo,
        externalId: null,
        importHash: result.importHash,
      }));

      const second = rows.map((current) => DuplicateDetector.detect(ACCOUNT, current, existing));

      expect(second.every((result) => result.status === 'DUPLICATE')).toBe(true);
    });
  });
});
