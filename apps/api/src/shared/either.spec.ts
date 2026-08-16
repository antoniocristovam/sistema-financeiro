import { describe, expect, it } from 'vitest';

import { type Either, left, right } from './either';

/** Caso de uso de mentira, para exercitar o padrao como ele e' usado. */
function divide(dividend: number, divisor: number): Either<string, number> {
  if (divisor === 0) {
    return left('Divisao por zero.');
  }

  return right(dividend / divisor);
}

describe('Either', () => {
  it('discrimina sucesso e falha', () => {
    const ok = divide(10, 2);
    const fail = divide(10, 0);

    expect(ok.isRight()).toBe(true);
    expect(ok.isLeft()).toBe(false);
    expect(fail.isLeft()).toBe(true);
    expect(fail.isRight()).toBe(false);
  });

  it('estreita o tipo apos a checagem', () => {
    const result = divide(10, 2);

    if (result.isRight()) {
      // Aqui `value` ja e' `number`, sem cast. E' esse estreitamento que obriga
      // quem chama a tratar o erro antes de usar o valor.
      expect(result.value + 1).toBe(6);
    } else {
      throw new Error('deveria ter dado certo');
    }
  });

  it('carrega o erro no left', () => {
    const result = divide(1, 0);

    expect(result.isLeft() && result.value).toBe('Divisao por zero.');
  });
});
