import { type CookieOptions, type Response } from 'express';

export const REFRESH_COOKIE_NAME = 'finapp_refresh';

/**
 * Cookie do refresh token.
 *
 * `httpOnly` tira o token do alcance de qualquer JavaScript da pagina -- e' o
 * que faz um XSS nao virar sessao roubada. `sameSite=strict` bloqueia CSRF: o
 * navegador nao manda o cookie em requisicao originada de outro site.
 *
 * `path` restrito as rotas que realmente precisam dele. Nao ha motivo para o
 * refresh token viajar em toda chamada de API.
 */
export function refreshCookieOptions(domain: string, secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    domain,
    path: '/api/auth',
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  domain: string,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(domain, secure),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: Response, domain: string, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(domain, secure));
}
