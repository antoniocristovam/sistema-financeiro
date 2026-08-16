import { ApiErrorCode } from '@finapp/contracts';

import { DomainError } from './domain-error';

/** Recurso inexistente OU fora do workspace de quem pediu. */
export class ResourceNotFoundError extends DomainError {
  readonly code = ApiErrorCode.NOT_FOUND;
  readonly message: string;

  constructor(resource: string) {
    super();
    this.message = `${resource} nao encontrado.`;
  }
}

/**
 * O papel do usuario nao permite a acao.
 *
 * Quem decide isso e' o CASO DE USO, nunca o controller: qualquer novo ponto de
 * entrada (job, CLI, webhook) nasceria sem protecao se a regra morasse na
 * camada HTTP.
 */
export class InsufficientRoleError extends DomainError {
  readonly code = ApiErrorCode.INSUFFICIENT_ROLE;
  readonly message: string;

  constructor(action: string) {
    super();
    this.message = `Seu papel neste workspace nao permite ${action}.`;
  }
}

/** O usuario nao pertence ao workspace pedido. Barreira contra IDOR. */
export class NotWorkspaceMemberError extends DomainError {
  readonly code = ApiErrorCode.NOT_WORKSPACE_MEMBER;
  readonly message = 'Voce nao tem acesso a este workspace.';
}

/** Acao proibida por regra, sem relacao com papel. */
export class NotAllowedError extends DomainError {
  readonly code = ApiErrorCode.FORBIDDEN;
  readonly message: string;

  constructor(reason: string) {
    super();
    this.message = reason;
  }
}

/** Valor invalido detectado no dominio (nao pelo schema de entrada). */
export class InvalidValueError extends DomainError {
  readonly code = ApiErrorCode.VALIDATION_FAILED;
  readonly message: string;
  override readonly field?: string;

  constructor(message: string, field?: string) {
    super();
    this.message = message;
    this.field = field;
  }
}

/** Estado atual do recurso conflita com a operacao. */
export class ConflictError extends DomainError {
  readonly code = ApiErrorCode.RESOURCE_CONFLICT;
  readonly message: string;

  constructor(message: string) {
    super();
    this.message = message;
  }
}

/** Operacao entre moedas diferentes. Nao existe conversao implicita. */
export class CurrencyMismatchError extends DomainError {
  readonly code = ApiErrorCode.CURRENCY_MISMATCH;
  readonly message: string;

  constructor(expected: string, received: string) {
    super();
    this.message = `Este workspace opera em ${expected}; o valor veio em ${received}.`;
  }
}
