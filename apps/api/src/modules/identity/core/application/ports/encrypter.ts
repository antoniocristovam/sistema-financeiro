/** Conteudo do access token. Fica minusculo de proposito: JWT nao e' cache. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/** Emissao e leitura do access token. */
export interface Encrypter {
  encrypt(payload: AccessTokenPayload): Promise<string>;
  decrypt(token: string): Promise<AccessTokenPayload | null>;
  /** Segundos de validade. Vai no corpo da resposta para o cliente se programar. */
  accessTokenTtlInSeconds(): number;
}

export const ENCRYPTER = Symbol('Encrypter');
