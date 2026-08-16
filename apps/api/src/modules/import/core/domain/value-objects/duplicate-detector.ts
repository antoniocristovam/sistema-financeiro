import { createHash } from 'node:crypto';

import { MatchStatus } from '@finapp/contracts';

import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { normalizeMemo, trigramSimilarity } from './memo-normalizer';

/** Tolerancia de data para considerar duas linhas o mesmo lancamento. */
export const SIMILARITY_DAY_TOLERANCE = 3;

/** Corte de similaridade, em milesimos (0,7 do documento). */
export const SIMILARITY_THRESHOLD = 700;

export interface CandidateTransaction {
  id: string;
  date: CalendarDate;
  amountInCents: number;
  normalizedMemo: string;
  externalId: string | null;
  importHash: string | null;
}

export interface StagedRow {
  date: CalendarDate;
  amountInCents: number;
  memo: string;
  /** FITID, quando a origem e' OFX. */
  fitId: string | null;
}

export interface MatchResult {
  status: MatchStatus;
  matchedTransactionId: string | null;
  /** Milesimos. Preenchido so em `SIMILAR`. */
  similarityScore: number | null;
  importHash: string;
  normalizedMemo: string;
}

/**
 * Deteccao de duplicata na importacao de extrato.
 *
 * Sem isso, importar o extrato de janeiro duas vezes dobra o mes inteiro, e o
 * usuario so descobre quando o saldo diverge do banco. A tela de conciliacao
 * nao e' luxo: e' o que torna a importacao confiavel.
 *
 * Tres niveis, do mais forte para o mais fraco:
 *
 * 1. **FITID (OFX)** -- autoritativo. O banco garante unicidade POR CONTA, e o
 *    indice unico `(accountId, externalId)` faz a duplicata ser impossivel por
 *    construcao. Note o "por conta": o FITID nao e' unico no mundo, e assumir
 *    que e' faria lancamentos de bancos diferentes se anularem.
 * 2. **Hash exato (CSV)** -- `sha256(accountId|data|centavos|memo normalizado)`.
 *    Mesma conta, mesmo dia, mesmo valor, mesma descricao: e' a mesma linha.
 * 3. **Heuristica** -- mesmo valor, data com tolerancia de +/-3 dias e
 *    descricao com similaridade acima de 0,7. NAO decide sozinha: marca
 *    `SIMILAR` e devolve para o usuario decidir, porque duas compras iguais no
 *    mesmo lugar em dias proximos sao perfeitamente possiveis.
 */
export class DuplicateDetector {
  /** `sha256(accountId|YYYY-MM-DD|centavos|memo normalizado)`. */
  static hash(
    accountId: string,
    date: CalendarDate,
    amountInCents: number,
    memo: string,
  ): string {
    return createHash('sha256')
      .update(`${accountId}|${date.toString()}|${amountInCents}|${normalizeMemo(memo)}`)
      .digest('hex');
  }

  static detect(
    accountId: string,
    row: StagedRow,
    candidates: readonly CandidateTransaction[],
  ): MatchResult {
    const normalized = normalizeMemo(row.memo);
    const importHash = DuplicateDetector.hash(accountId, row.date, row.amountInCents, row.memo);

    const base = { importHash, normalizedMemo: normalized };

    // 1. FITID: autoritativo quando existe.
    if (row.fitId !== null && row.fitId !== '') {
      const byExternalId = candidates.find((candidate) => candidate.externalId === row.fitId);

      if (byExternalId) {
        return {
          ...base,
          status: MatchStatus.DUPLICATE,
          matchedTransactionId: byExternalId.id,
          similarityScore: null,
        };
      }
    }

    // 2. Hash exato.
    const byHash = candidates.find((candidate) => candidate.importHash === importHash);

    if (byHash) {
      return {
        ...base,
        status: MatchStatus.DUPLICATE,
        matchedTransactionId: byHash.id,
        similarityScore: null,
      };
    }

    // 3. Heuristica: valor igual, data proxima, descricao parecida.
    let best: { id: string; score: number } | null = null;

    for (const candidate of candidates) {
      if (candidate.amountInCents !== row.amountInCents) {
        continue;
      }

      if (Math.abs(row.date.daysUntil(candidate.date)) > SIMILARITY_DAY_TOLERANCE) {
        continue;
      }

      const score = trigramSimilarity(normalized, candidate.normalizedMemo);

      if (score >= SIMILARITY_THRESHOLD && (best === null || score > best.score)) {
        best = { id: candidate.id, score };
      }
    }

    if (best !== null) {
      return {
        ...base,
        status: MatchStatus.SIMILAR,
        matchedTransactionId: best.id,
        similarityScore: best.score,
      };
    }

    return { ...base, status: MatchStatus.NEW, matchedTransactionId: null, similarityScore: null };
  }
}
