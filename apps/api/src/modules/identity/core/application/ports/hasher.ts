/**
 * Hash de senha.
 *
 * O dominio nao sabe que o algoritmo e' argon2id -- so que existe uma forma de
 * transformar senha em hash e de conferir. Trocar de algoritmo (ou de custo)
 * nao toca em nenhum caso de uso.
 */
export interface Hasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export const HASHER = Symbol('Hasher');
