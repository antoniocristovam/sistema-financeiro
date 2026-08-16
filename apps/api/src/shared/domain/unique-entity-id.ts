import { randomUUID } from 'node:crypto';

/**
 * Identidade de uma entidade.
 *
 * O id nasce no DOMINIO, nao no banco. Isso permite montar um agregado inteiro
 * (transacao + parcelas + rateios, todos se referenciando) antes de qualquer
 * INSERT, e persistir tudo em uma transacao so.
 */
export class UniqueEntityId {
  readonly #value: string;

  constructor(value?: string) {
    this.#value = value ?? randomUUID();
  }

  toString(): string {
    return this.#value;
  }

  toValue(): string {
    return this.#value;
  }

  equals(other: UniqueEntityId): boolean {
    return this.#value === other.toValue();
  }
}
