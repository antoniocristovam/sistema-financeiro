import { InvitationStatus, type WorkspaceRole } from '@finapp/contracts';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';
import { type Either, left, right } from '../../../../../shared/either';
import {
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationNotPendingError,
} from '../errors/workspace-errors';

export interface InvitationProps {
  workspaceId: UniqueEntityId;
  email: Email;
  role: WorkspaceRole;
  /** Só o HASH é persistido. O token em claro existe uma vez, no e-mail. */
  tokenHash: string;
  expiresAt: Date;
  status: InvitationStatus;
  invitedByUserId: UniqueEntityId;
  acceptedAt: Date | null;
  createdAt: Date;
}

/**
 * Convite para entrar em um workspace compartilhado.
 *
 * `expiresAt` e' checado no ACEITE, nao por um job: um convite expirado que
 * ninguem tentou usar continua PENDING no banco e nao faz mal a ninguem.
 * Depender de job para invalidar criaria uma janela em que o convite vencido
 * ainda funciona.
 */
export class Invitation extends Entity<InvitationProps> {
  static readonly DEFAULT_TTL_DAYS = 7;

  static create(
    props: Optional<InvitationProps, 'status' | 'acceptedAt' | 'createdAt' | 'expiresAt'>,
    id?: UniqueEntityId,
  ): Invitation {
    const now = props.createdAt ?? new Date();

    return new Invitation(
      {
        ...props,
        status: props.status ?? InvitationStatus.PENDING,
        acceptedAt: props.acceptedAt ?? null,
        createdAt: now,
        expiresAt:
          props.expiresAt ??
          new Date(now.getTime() + Invitation.DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get email(): Email {
    return this.props.email;
  }

  get role(): WorkspaceRole {
    return this.props.role;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get status(): InvitationStatus {
    return this.props.status;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get invitedByUserId(): UniqueEntityId {
    return this.props.invitedByUserId;
  }

  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isPending(): boolean {
    return this.props.status === InvitationStatus.PENDING;
  }

  /**
   * Aceite. Falha se ja foi usado, se venceu, ou se quem aceitou nao e' o
   * destinatario -- um token vazado nao deve virar acesso para qualquer conta.
   */
  accept(
    acceptedByEmail: Email,
    now: Date = new Date(),
  ): Either<
    InvitationNotPendingError | InvitationExpiredError | InvitationEmailMismatchError,
    void
  > {
    if (!this.isPending()) {
      return left(new InvitationNotPendingError(this.props.status));
    }

    if (this.isExpired(now)) {
      this.props.status = InvitationStatus.EXPIRED;
      return left(new InvitationExpiredError());
    }

    if (!this.props.email.equals(acceptedByEmail)) {
      return left(new InvitationEmailMismatchError());
    }

    this.props.status = InvitationStatus.ACCEPTED;
    this.props.acceptedAt = now;

    return right(undefined);
  }

  revoke(): Either<InvitationNotPendingError, void> {
    if (!this.isPending()) {
      return left(new InvitationNotPendingError(this.props.status));
    }

    this.props.status = InvitationStatus.REVOKED;

    return right(undefined);
  }
}
