/**
 * Normalizacao de descricao de extrato.
 *
 * O mesmo lancamento chega escrito diferente em cada exportacao do banco:
 *
 *   "SUPERMERCADO BOM PRECO LTDA   *1234"
 *   "Supermercado Bom Preco Ltda 12/03"
 *   "SUPERMERCADO BOM PRECO*4321"
 *
 * Normalizar antes de comparar e' o que faz o match acontecer. O que se remove
 * e' justamente o que MUDA entre exportacoes: caixa, acento, pontuacao, e os
 * numeros de documento/parcela que o banco costura na descricao.
 */

const ACCENTED = /[̀-ͯ]/g;
const DOCUMENT_NUMBERS = /\b\d[\d./-]{2,}\b/g;
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;

/** Palavras que so aparecem por ruido do banco e nao ajudam a identificar nada. */
const NOISE_WORDS = new Set([
  'ltda',
  'me',
  'sa',
  'eireli',
  'mei',
  'compra',
  'cartao',
  'debito',
  'credito',
  'pagamento',
  'pag',
  'tef',
  'pos',
]);

export function normalizeMemo(memo: string): string {
  const withoutAccents = memo.normalize('NFD').replace(ACCENTED, '');

  const cleaned = withoutAccents
    .toLowerCase()
    .replace(DOCUMENT_NUMBERS, ' ')
    .replace(PUNCTUATION, ' ')
    .replace(WHITESPACE, ' ')
    .trim();

  const words = cleaned.split(' ').filter((word) => word.length > 0 && !NOISE_WORDS.has(word));

  if (words.length > 0) {
    return words.join(' ');
  }

  // A partir daqui a normalizacao apagou tudo. Devolver string vazia seria pior
  // do que normalizar mal: duas linhas com descricao vazia teriam similaridade
  // 1000 entre si e o mesmo hash, virando duplicata uma da outra.
  if (cleaned !== '') {
    return cleaned;
  }

  // So havia numeros (a descricao era o proprio numero do documento). Preserva
  // os digitos, que aqui sao a unica coisa que distingue uma linha da outra.
  return withoutAccents.toLowerCase().replace(PUNCTUATION, ' ').replace(WHITESPACE, ' ').trim();
}

/**
 * Similaridade por trigrama, em MILESIMOS (0-1000).
 *
 * Inteiro de proposito: o limite de corte (0,7 = 700) vira comparacao exata,
 * sem depender de arredondamento de float.
 *
 * Usa coeficiente de Jaccard sobre os trigramas das duas strings ja
 * normalizadas.
 */
export function trigramSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1000;
  }

  const a = trigramsOf(left);
  const b = trigramsOf(right);

  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const trigram of a) {
    if (b.has(trigram)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;

  return union === 0 ? 0 : Math.round((intersection / union) * 1000);
}

/** Trigramas com padding nas pontas, como o `pg_trgm` faz. */
function trigramsOf(value: string): Set<string> {
  const padded = `  ${value} `;
  const trigrams = new Set<string>();

  for (let index = 0; index + 3 <= padded.length; index += 1) {
    trigrams.add(padded.slice(index, index + 3));
  }

  return trigrams;
}
