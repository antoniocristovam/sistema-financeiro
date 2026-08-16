/** Erro base do pacote. Todos herdam daqui para facilitar o `catch`. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Operacao entre moedas diferentes.
 *
 * Nao existe conversao implicita: somar BRL com USD e' bug, nao arredondamento.
 */
export class CurrencyMismatchError extends MoneyError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`Operacao entre moedas diferentes: ${left} e ${right}.`);
  }
}

/** Valor que nao representa dinheiro (NaN, Infinity, fracao de centavo). */
export class InvalidMoneyError extends MoneyError {
  constructor(message: string) {
    super(message);
  }
}

/** Codigo de moeda fora do formato ISO 4217. */
export class InvalidCurrencyError extends MoneyError {
  constructor(readonly value: unknown) {
    super(`Codigo de moeda invalido: ${String(value)}. Esperado ISO 4217 (ex.: BRL).`);
  }
}

/** Rateio impossivel: zero partes, peso negativo ou soma de pesos igual a zero. */
export class InvalidAllocationError extends MoneyError {
  constructor(message: string) {
    super(message);
  }
}
