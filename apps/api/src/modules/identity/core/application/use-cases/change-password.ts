import { type Clock } from '../../../../../shared/application/ports/clock';
import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type RefreshTokenRepository } from '../../domain/repositories/refresh-token-repository';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type Hasher } from '../ports/hasher';
import {
  type IssuedSession,
  type SessionContext,
  type SessionIssuer,
} from '../services/session-issuer';
import { InvalidCredentialsError } from './authenticate-user';

export interface ChangePasswordInput extends SessionContext {
  userId: UniqueEntityId;
  currentPassword: string;
  password: string;
}

/**
 * Troca de senha por quem ja esta logado.
 *
 * Exige a senha atual: sem isso, uma sessao sequestrada trocaria a senha e
 * tomaria a conta sem nunca ter sabido a senha original.
 *
 * Derruba TODAS as sessoes e emite uma nova para quem esta trocando. Trocar a
 * senha por suspeita de invasao precisa expulsar o invasor; deixar a sessao
 * atual de pe por "conveniencia" tambem deixaria a dele. A sessao nova evita
 * que o usuario seja deslogado no meio da propria acao.
 */
export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: Hasher,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ChangePasswordInput,
  ): Promise<Either<InvalidCredentialsError | ResourceNotFoundError, IssuedSession>> {
    const user = await this.users.findById(input.userId);

    if (!user) {
      return left(new ResourceNotFoundError('Usuario'));
    }

    const matches = await this.hasher.compare(input.currentPassword, user.passwordHash);

    if (!matches) {
      return left(new InvalidCredentialsError());
    }

    user.changePassword(await this.hasher.hash(input.password));

    await this.users.save(user);
    await this.refreshTokens.revokeAllForUser(user.id, this.clock.now());

    const session = await this.sessions.issue(user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return right(session);
  }
}
