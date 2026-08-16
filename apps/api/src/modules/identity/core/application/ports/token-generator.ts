/**
 * Geracao de token opaco (refresh, convite, verificacao de e-mail).
 *
 * Devolve o par claro/hash porque os dois tem destinos diferentes: o CLARO vai
 * uma unica vez para o usuario (cookie ou link do e-mail) e o HASH e' o que
 * fica no banco. Assim um vazamento do banco nao vira sessao nem convite valido.
 */
export interface OpaqueToken {
  plain: string;
  hash: string;
}

export interface TokenGenerator {
  generate(): OpaqueToken;
  /** Mesma funcao de hash usada em `generate`, para conferir um token recebido. */
  hashOf(plain: string): string;
}

export const TOKEN_GENERATOR = Symbol('TokenGenerator');
