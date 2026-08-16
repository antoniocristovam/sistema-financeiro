import { ApiErrorCode } from '@finapp/contracts';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';

/**
 * O workspace ficaria sem dono.
 *
 * Vale para remover, rebaixar e sair: sair do workspace e' permitido a todos,
 * menos ao ULTIMO owner. Sem dono, ninguem consegue excluir o workspace nem
 * transferir a posse -- o dado fica orfao.
 */
export class LastOwnerError extends DomainError {
  readonly code = ApiErrorCode.LAST_OWNER;
  readonly message =
    'Este e o unico dono do workspace. Transfira a posse antes de sair ou remover.';
}

export class AlreadyMemberError extends DomainError {
  readonly code = ApiErrorCode.ALREADY_MEMBER;
  readonly message = 'Esta pessoa ja participa do workspace.';
}

export class NotMemberError extends DomainError {
  readonly code = ApiErrorCode.NOT_FOUND;
  readonly message = 'Esta pessoa nao participa do workspace.';
}

export class InvitationExpiredError extends DomainError {
  readonly code = ApiErrorCode.RESOURCE_CONFLICT;
  readonly message = 'Este convite expirou. Peca um novo.';
}

export class InvitationNotPendingError extends DomainError {
  readonly code = ApiErrorCode.RESOURCE_CONFLICT;
  readonly message: string;

  constructor(status: string) {
    super();
    this.message = `Este convite ja foi ${status === 'ACCEPTED' ? 'aceito' : 'cancelado'}.`;
  }
}

/** Convite aceito por quem nao e' o destinatario. */
export class InvitationEmailMismatchError extends DomainError {
  readonly code = ApiErrorCode.FORBIDDEN;
  readonly message = 'Este convite foi enviado para outro e-mail.';
}

/** Workspace pessoal nao aceita membro nem exclusao. */
export class PersonalWorkspaceError extends DomainError {
  readonly code = ApiErrorCode.FORBIDDEN;
  readonly message: string;

  constructor(action: string) {
    super();
    this.message = `Nao e possivel ${action} em um workspace pessoal.`;
  }
}
