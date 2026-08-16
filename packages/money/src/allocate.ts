import { InvalidAllocationError } from './errors.js';

/**
 * Reparte `total` centavos entre pesos, sem perder nem inventar um centavo.
 *
 * Este e' o algoritmo mais importante do pacote. R$ 100,00 dividido por 3 nao
 * da tres vezes R$ 33,33 -- sobra um centavo. Truncar faz a soma dos rateios
 * nao bater com o lancamento, e um relatorio errado por UM centavo e' pior do
 * que errado por dez reais: ninguem acha o bug.
 *
 * Metodo do maior resto: cada parte leva a divisao truncada, e os centavos que
 * sobram vao um a um para quem tem o maior resto. Empate resolve pelo menor
 * indice, entao a divisao igualitaria entrega o resto aos PRIMEIROS
 * participantes, de forma estavel e reproduzivel:
 *
 *   allocate(10000, [1, 1, 1]) -> [3334, 3333, 3333]
 *
 * Os pesos sao INTEIROS nao-negativos de proposito. Com peso fracionario o
 * resto teria de ser comparado em ponto flutuante, e o desempate passaria a
 * depender de ruido de precisao -- o mesmo rateio poderia mudar de resultado
 * conforme a magnitude do valor. Para percentual, passe pontos-base
 * (33,33% = 3333); toda a aritmetica aqui e' inteira e exata.
 *
 * Garantias:
 *   - `sum(resultado) === total`, sempre
 *   - mesma entrada => mesmo resultado, em qualquer plataforma
 *   - funciona com total negativo (estorno), preservando o sinal
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total)) {
    throw new InvalidAllocationError(`Total precisa ser inteiro em centavos: ${String(total)}`);
  }

  if (weights.length === 0) {
    throw new InvalidAllocationError('Rateio precisa de ao menos uma parte.');
  }

  let weightSum = 0;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new InvalidAllocationError(
        `Peso invalido: ${String(weight)}. Use inteiros >= 0 (percentual em pontos-base).`,
      );
    }
    weightSum += weight;
  }

  if (weightSum <= 0) {
    throw new InvalidAllocationError('A soma dos pesos precisa ser maior que zero.');
  }

  // Aritmetica inteira: `numerator - base * weightSum` e' o resto EXATO da
  // divisao, sem passar por fracao em nenhum momento.
  const shares = weights.map((weight) => {
    const numerator = total * weight;

    if (!Number.isSafeInteger(numerator)) {
      throw new InvalidAllocationError(
        `Rateio fora do intervalo seguro: ${String(total)} x ${String(weight)}.`,
      );
    }

    const base = Math.trunc(numerator / weightSum);
    return { value: base, remainder: Math.abs(numerator - base * weightSum) };
  });

  const distributed = shares.reduce((sum, share) => sum + share.value, 0);
  let leftover = total - distributed;
  const step = leftover < 0 ? -1 : 1;

  // Maior resto primeiro; empate mantem a ordem original dos participantes.
  // A ordem carrega REFERENCIA para o objeto, nao o indice: uma passada de
  // `for...of` basta e nao sobra caminho impossivel para testar.
  const order = shares
    .map((share, index) => ({ share, index }))
    .sort((a, b) => b.share.remainder - a.share.remainder || a.index - b.index);

  // Cada `trunc` perde menos de uma unidade, entao |leftover| < shares.length --
  // uma passada distribui tudo.
  for (const { share } of order) {
    if (leftover === 0) {
      break;
    }

    share.value += step;
    leftover -= step;
  }

  return shares.map((share) => share.value);
}

/** Divide em `parts` partes iguais. Atalho de `allocate` com pesos unitarios. */
export function allocateEvenly(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new InvalidAllocationError(`Numero de partes invalido: ${String(parts)}`);
  }

  return allocate(total, new Array<number>(parts).fill(1));
}
