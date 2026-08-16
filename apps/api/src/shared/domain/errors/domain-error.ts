import { ApiErrorCode } from '@finapp/contracts';

/**
 * Erro de REGRA DE NEGOCIO.
 *
 * Nao herda de `Error` de proposito: erro de dominio nao e' excecao, e' um dos
 * resultados possiveis do caso de uso. Ele volta no `left` do Either, atravessa
 * o controller e vira resposta HTTP pelo `DomainExceptionFilter`.
 *
 * O `code` vem de `@finapp/contracts` para que API e web falem do mesmo erro
 * pelo mesmo nome -- o front decide o que fazer pelo codigo, nunca pela
 * mensagem, que muda com traducao.
 */
export abstract class DomainError {
  abstract readonly code: ApiErrorCode;
  abstract readonly message: string;

  /** Campo que causou o erro, quando faz sentido apontar um. */
  readonly field?: string;

  toJSON(): { code: string; message: string; field?: string } {
    return this.field === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, field: this.field };
  }
}
