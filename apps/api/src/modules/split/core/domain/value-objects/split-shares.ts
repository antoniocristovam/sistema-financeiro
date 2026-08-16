import { ApiErrorCode, ShareType } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { type Either, left, right } from '../../../../../shared/either';

export class SplitDoesNotCloseError extends DomainError {
  readonly code = ApiErrorCode.SPLIT_DOES_NOT_CLOSE;
  readonly message: string;

  constructor(expected: Money, received: number) {
    super();
    const difference = expected.toCents() - received;
    this.message =
      difference > 0
        ? `A divisao nao fecha: faltam ${difference} centavo(s).`
        : `A divisao nao fecha: sobram ${-difference} centavo(s).`;
  }
}

export class InvalidSplitError extends DomainError {
  readonly code = ApiErrorCode.VALIDATION_FAILED;
  readonly message: string;

  constructor(message: string) {
    super();
    this.message = message;
  }
}

/** Entrada de um participante, antes do calculo. */
export interface ShareInput {
  /** Identifica o participante para o chamador reassociar o resultado. */
  key: string;
  /** EQUAL: ignorado. PERCENT: pontos-base. FIXED: centavos. */
  value?: number;
}

export interface ComputedShare {
  key: string;
  amount: Money;
}

/**
 * Calculo do rateio de uma despesa.
 *
 * Regra 7 do dominio, e a que mais da trabalho quando quebra: **a soma dos
 * rateios tem que fechar EXATAMENTE com o valor da transacao**. R$ 100,00
 * dividido por 3 nao da tres vezes R$ 33,33 -- sobra um centavo. Descartar
 * esse centavo faz o relatorio errar por um valor que ninguem consegue achar.
 *
 * A distribuicao dos centavos de resto e' delegada ao `Money.allocate`, que
 * usa maior-resto com desempate por indice: os primeiros participantes levam a
 * sobra, de forma estavel e reproduzivel.
 *
 * O VO nao sabe quem sao as pessoas -- so recebe chaves opacas. Quem amarra
 * chave a participante e' o caso de uso.
 */
export class SplitShares {
  private constructor(readonly shares: readonly ComputedShare[]) {}

  static compute(
    total: Money,
    shareType: ShareType,
    inputs: readonly ShareInput[],
  ): Either<InvalidSplitError | SplitDoesNotCloseError, SplitShares> {
    if (inputs.length < 2) {
      return left(new InvalidSplitError('Uma divisao precisa de pelo menos duas pessoas.'));
    }

    if (!total.isPositive()) {
      return left(new InvalidSplitError('O valor da despesa precisa ser maior que zero.'));
    }

    switch (shareType) {
      case ShareType.EQUAL:
        return SplitShares.fromWeights(total, inputs, inputs.map(() => 1));

      case ShareType.PERCENT:
        return SplitShares.fromPercent(total, inputs);

      case ShareType.FIXED:
        return SplitShares.fromFixed(total, inputs);

      default:
        return left(new InvalidSplitError('Modo de divisao desconhecido.'));
    }
  }

  /**
   * Percentual em pontos-base.
   *
   * Os percentuais precisam somar exatamente 100% -- em INTEIRO, entao 3333 +
   * 3333 + 3334 fecha e 33.33 tres vezes nao chega perto. O valor em centavos
   * sai do `allocate` com os pontos-base como peso, e nao de multiplicacoes
   * independentes: multiplicar cada parte e somar perde centavo.
   */
  private static fromPercent(
    total: Money,
    inputs: readonly ShareInput[],
  ): Either<InvalidSplitError | SplitDoesNotCloseError, SplitShares> {
    const weights: number[] = [];

    for (const input of inputs) {
      if (input.value === undefined) {
        return left(new InvalidSplitError('Informe o percentual de todos os participantes.'));
      }

      if (!Number.isInteger(input.value) || input.value < 0) {
        return left(
          new InvalidSplitError('Percentual precisa ser inteiro em pontos-base (33,33% = 3333).'),
        );
      }

      weights.push(input.value);
    }

    const sum = weights.reduce((acc, weight) => acc + weight, 0);

    if (sum !== 10_000) {
      return left(
        new InvalidSplitError(
          `Os percentuais precisam somar 100%. Somam ${(sum / 100).toFixed(2)}%.`,
        ),
      );
    }

    return SplitShares.fromWeights(total, inputs, weights);
  }

  /** Valores fixos: o usuario ja disse o centavo de cada um, so conferimos. */
  private static fromFixed(
    total: Money,
    inputs: readonly ShareInput[],
  ): Either<InvalidSplitError | SplitDoesNotCloseError, SplitShares> {
    const shares: ComputedShare[] = [];
    let sum = 0;

    for (const input of inputs) {
      if (input.value === undefined) {
        return left(new InvalidSplitError('Informe o valor de todos os participantes.'));
      }

      if (!Number.isInteger(input.value) || input.value <= 0) {
        return left(new InvalidSplitError('Cada parte precisa ser maior que zero.'));
      }

      sum += input.value;
      shares.push({ key: input.key, amount: Money.fromCents(input.value, total.currency) });
    }

    if (sum !== total.toCents()) {
      return left(new SplitDoesNotCloseError(total, sum));
    }

    return right(new SplitShares(shares));
  }

  private static fromWeights(
    total: Money,
    inputs: readonly ShareInput[],
    weights: readonly number[],
  ): Either<InvalidSplitError | SplitDoesNotCloseError, SplitShares> {
    const amounts = total.allocate(weights);

    const shares = inputs.map((input, index) => ({
      key: input.key,
      // `allocate` devolve exatamente `inputs.length` posicoes.
      amount: amounts[index] as Money,
    }));

    return right(new SplitShares(shares));
  }

  /** Soma dos rateios. Por construcao, igual ao total -- conferido nos testes. */
  totalInCents(): number {
    return this.shares.reduce((sum, share) => sum + share.amount.toCents(), 0);
  }

  find(key: string): ComputedShare | undefined {
    return this.shares.find((share) => share.key === key);
  }
}
