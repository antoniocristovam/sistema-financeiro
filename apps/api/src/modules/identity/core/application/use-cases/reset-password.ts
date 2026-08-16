import { type Clock } from '../../../../../shared/application/ports/clock';
import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type Either, left, right } from '../../../../../shared/either';
import { type InvalidTokenError } from '../../domain/entities/user-token';
import { type RefreshTokenRepository } from '../../domain/repositories/refresh-token-repository';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type UserTokenRepository } from '../../domain/repositories/user-token-repository';
import { type Hasher } from '../ports/hasher';
import { type TokenGenerator } from '../ports/token-generator';

export interface ResetPasswordInput {
  token: string;
  password: string;
}

/**
 * Redefinicao de senha pelo link recebido por e-mail.
 *
 * Derruba TODAS as sessoes do usuario. Quem redefine a senha em geral esta
 * fazendo isso porque suspeita de acesso indevido -- deixar as sessoes antigas
 * de pe manteria o invasor logado com a senha nova.
 *
 * Tambem marca o e-mail como verificado: quem provou que recebe mensagens
 * naquele endereco ja demonstrou o que a verificacao pede.
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly userTokens: UserTokenRepository,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: Hasher,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ResetPasswordInput,
  ): Promise<Either<InvalidTokenError | ResourceNotFoundError, void>> {
    const now = this.clock.now();
    const stored = await this.userTokens.findByHash(
      this.tokens.hashOf(input.token),
      'PASSWORD_RESET',
    );

    if (!stored) {
      return left(new ResourceNotFoundError('Link'));
    }

    const consumed = stored.consume(now);

    if (consumed.isLeft()) {
      return left(consumed.value);
    }

    const user = await this.users.findById(stored.userId);

    if (!user) {
      return left(new ResourceNotFoundError('Usuario'));
    }

    user.changePassword(await this.hasher.hash(input.password));
    user.verifyEmail(now);

    await this.users.save(user);
    await this.userTokens.save(stored);
    await this.refreshTokens.revokeAllForUser(user.id, now);

    return right(undefined);
  }
}
