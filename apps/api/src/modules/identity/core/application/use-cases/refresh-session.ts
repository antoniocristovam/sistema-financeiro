import { ApiErrorCode } from '@finapp/contracts';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { type Either, left, right } from '../../../../../shared/either';
import { type User } from '../../domain/entities/user';
import { type RefreshTokenRepository } from '../../domain/repositories/refresh-token-repository';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type TokenGenerator } from '../ports/token-generator';
import {
  type IssuedSession,
  type SessionContext,
  type SessionIssuer,
} from '../services/session-issuer';

export class InvalidRefreshTokenError extends DomainError {
  readonly code = ApiErrorCode.TOKEN_EXPIRED;
  readonly message = 'Sessao expirada. Entre novamente.';
}

/**
 * Reuso de um token ja rotacionado.
 *
 * Erro proprio para o cliente saber que nao adianta tentar de novo: a familia
 * inteira foi derrubada e o caminho e' um login novo.
 */
export class RefreshTokenReuseError extends DomainError {
  readonly code = ApiErrorCode.TOKEN_REUSED;
  readonly message = 'Detectamos reuso de sessao. Por seguranca, entre novamente.';
}

export interface RefreshSessionInput extends SessionContext {
  refreshToken: string;
}

export interface RefreshSessionOutput {
  user: User;
  session: IssuedSession;
}

type RefreshSessionError = InvalidRefreshTokenError | RefreshTokenReuseError;

/**
 * Renovacao de sessao com rotacao e deteccao de replay.
 *
 * O ponto delicado: um token JA rotacionado que reaparece significa uma de duas
 * coisas -- alguem esta reusando um token roubado, ou o dono legitimo perdeu a
 * resposta da rotacao (queda de rede no meio do refresh). Nao da para
 * distinguir os dois casos, e a resposta segura e' a mesma: derrubar a familia
 * inteira. O custo para o usuario legitimo e' um login; o custo de nao fazer e'
 * um atacante com sessao permanente.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenGenerator,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: RefreshSessionInput,
  ): Promise<Either<RefreshSessionError, RefreshSessionOutput>> {
    const now = this.clock.now();
    const stored = await this.refreshTokens.findByHash(this.tokens.hashOf(input.refreshToken));

    if (!stored) {
      return left(new InvalidRefreshTokenError());
    }

    if (stored.wasAlreadyRotated()) {
      await this.refreshTokens.revokeFamily(stored.familyId, now);
      return left(new RefreshTokenReuseError());
    }

    if (!stored.isActive(now)) {
      return left(new InvalidRefreshTokenError());
    }

    const user = await this.users.findById(stored.userId);

    if (!user) {
      await this.refreshTokens.revokeFamily(stored.familyId, now);
      return left(new InvalidRefreshTokenError());
    }

    const session = await this.sessions.rotate(user, stored, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return right({ user, session });
  }
}
