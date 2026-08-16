/**
 * Either: sucesso ou falha, sem exception.
 *
 * Caso de uso devolve `Either<DomainError, Resultado>` em vez de lancar. A
 * diferenca pratica: o TypeScript OBRIGA quem chama a tratar o erro antes de
 * acessar o valor. Com exception, esquecer o `catch` compila e so aparece em
 * producao.
 *
 *   const result = await useCase.execute(input);
 *   if (result.isLeft()) return presentError(result.value);
 *   return present(result.value); // aqui `value` ja e' o tipo de sucesso
 *
 * Exception continua existindo para o que e' bug de programacao (invariante
 * quebrada, falha de infra). Erro de REGRA DE NEGOCIO vem por aqui.
 */

export class Left<L, R> {
  readonly value: L;

  constructor(value: L) {
    this.value = value;
  }

  isLeft(): this is Left<L, R> {
    return true;
  }

  isRight(): this is Right<L, R> {
    return false;
  }
}

export class Right<L, R> {
  readonly value: R;

  constructor(value: R) {
    this.value = value;
  }

  isLeft(): this is Left<L, R> {
    return false;
  }

  isRight(): this is Right<L, R> {
    return true;
  }
}

export type Either<L, R> = Left<L, R> | Right<L, R>;

/** Falha. */
export const left = <L, R>(value: L): Either<L, R> => new Left<L, R>(value);

/** Sucesso. */
export const right = <L, R>(value: R): Either<L, R> => new Right<L, R>(value);
