import { ApiErrorCode, type UserTokenType } from '@finapp/contracts';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';

export class InvalidTokenError extends DomainError {
  readonly code = ApiErrorCode.TOKEN_EXPIRED;
  readonly message = 'Link invalido ou expirado. Peca um novo.';
}

export interface UserTokenProps {
  userId: UniqueEntityId;
  type: UserTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * Token de uso unico: verificacao de e-mail e recuperacao de senha.
 *
 * `usedAt` e' o que impede o mesmo link de redefinicao ser usado duas vezes --
 * cenario real quando o e-mail e' encaminhado ou o link fica no historico do
 * navegador.
 */
export class UserToken extends Entity<UserTokenProps> {
  static readonly EMAIL_VERIFICATION_TTL_HOURS = 24;
  static readonly PASSWORD_RESET_TTL_MINUTES = 30;

  static create(
    props: Optional<UserTokenProps, 'usedAt' | 'createdAt'>,
    id?: UniqueEntityId,
  ): UserToken {
    return new UserToken(
      {
        ...props,
        usedAt: props.usedAt ?? null,
        createdAt: props.createdAt ?? new Date(),
      },
      id,
    );
  }

  get userId(): UniqueEntityId {
    return this.props.userId;
  }

  get type(): UserTokenType {
    return this.props.type;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get usedAt(): Date | null {
    return this.props.usedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isUsed(): boolean {
    return this.props.usedAt !== null;
  }

  /**
   * Marca como usado.
   *
   * Token expirado e token ja usado devolvem o MESMO erro de proposito: dizer
   * "este link ja foi usado" confirmaria para um atacante que o token existe.
   */
  consume(now: Date): Either<InvalidTokenError, void> {
    if (this.isUsed() || this.isExpired(now)) {
      return left(new InvalidTokenError());
    }

    this.props.usedAt = now;

    return right(undefined);
  }
}
