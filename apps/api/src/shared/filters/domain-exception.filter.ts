import { ApiErrorCode, type ApiError } from '@finapp/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Response } from 'express';
import { randomUUID } from 'node:crypto';

import { DomainError } from '../domain/errors/domain-error';

/**
 * Excecao que carrega um erro de dominio ate a camada HTTP.
 *
 * O caso de uso devolve o erro pelo `left` do Either; o controller o embrulha
 * aqui e deixa este filtro traduzir para HTTP. O dominio nunca conhece status
 * code.
 */
export class DomainHttpException extends HttpException {
  constructor(readonly domainError: DomainError) {
    super(domainError.message, statusFor(domainError.code));
  }
}

/** Mapa unico de codigo de dominio para status HTTP. */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  [ApiErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,

  [ApiErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.TOKEN_REUSED]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.EMAIL_NOT_VERIFIED]: HttpStatus.UNAUTHORIZED,

  [ApiErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ApiErrorCode.INSUFFICIENT_ROLE]: HttpStatus.FORBIDDEN,
  [ApiErrorCode.NOT_WORKSPACE_MEMBER]: HttpStatus.FORBIDDEN,
  [ApiErrorCode.ONBOARDING_REQUIRED]: HttpStatus.FORBIDDEN,

  [ApiErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,

  [ApiErrorCode.EMAIL_ALREADY_USED]: HttpStatus.CONFLICT,
  [ApiErrorCode.ALREADY_MEMBER]: HttpStatus.CONFLICT,
  [ApiErrorCode.RESOURCE_CONFLICT]: HttpStatus.CONFLICT,
  [ApiErrorCode.DUPLICATE_TRANSACTION]: HttpStatus.CONFLICT,

  [ApiErrorCode.SPLIT_DOES_NOT_CLOSE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.CATEGORY_DEPTH_EXCEEDED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.CATEGORY_IN_USE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.ACCOUNT_IN_USE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.LAST_OWNER]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.INVOICE_ALREADY_PAID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.IMPORT_ALREADY_COMMITTED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.IMPORT_NOT_REVERTIBLE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.CURRENCY_MISMATCH]: HttpStatus.UNPROCESSABLE_ENTITY,

  [ApiErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
};

function statusFor(code: string): HttpStatus {
  return STATUS_BY_CODE[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * Traduz tudo que sai da aplicacao para o envelope de erro do contrato.
 *
 * Erro inesperado vira 500 com mensagem generica e um `traceId`: detalhe de
 * excecao interna (stack, nome de tabela, query) nao vai para o cliente. O
 * `traceId` correlaciona a resposta com o log do servidor.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainHttpException) {
      const { domainError } = exception;

      response.status(statusFor(domainError.code)).json({
        code: domainError.code,
        message: domainError.message,
        ...(domainError.field
          ? { issues: [{ path: [domainError.field], message: domainError.message }] }
          : {}),
      } satisfies ApiError);

      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      response.status(status).json(normalizeHttpException(status, payload));

      return;
    }

    const traceId = randomUUID();

    this.logger.error(
      `Erro nao tratado (traceId=${traceId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
      traceId,
    } satisfies ApiError);
  }
}

function normalizeHttpException(status: number, payload: unknown): ApiError {
  // Erros que o proprio Nest levanta (guard, throttler, 404 de rota) ja vem em
  // formatos diferentes; aqui todos viram o mesmo envelope.
  if (typeof payload === 'object' && payload !== null && 'code' in payload) {
    return payload as ApiError;
  }

  const message =
    typeof payload === 'string'
      ? payload
      : ((payload as { message?: string | string[] } | null)?.message ?? 'Erro na requisicao.');

  const codeByStatus: Record<number, string> = {
    [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHENTICATED,
    [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
    [HttpStatus.TOO_MANY_REQUESTS]: ApiErrorCode.RATE_LIMITED,
  };

  return {
    code: codeByStatus[status] ?? ApiErrorCode.VALIDATION_FAILED,
    message: Array.isArray(message) ? message.join(' ') : message,
  };
}
