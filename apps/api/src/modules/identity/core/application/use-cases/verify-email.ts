import { type Clock } from '../../../../../shared/application/ports/clock';
import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type Either, left, right } from '../../../../../shared/either';
import { type InvalidTokenError } from '../../domain/entities/user-token';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type UserTokenRepository } from '../../domain/repositories/user-token-repository';
import { type TokenGenerator } from '../ports/token-generator';

export interface VerifyEmailInput {
  token: string;
}

/** Confirmacao de e-mail pelo link enviado no cadastro. */
export class VerifyEmailUseCase {
  constructor(
    private readonly userTokens: UserTokenRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: VerifyEmailInput,
  ): Promise<Either<InvalidTokenError | ResourceNotFoundError, void>> {
    const now = this.clock.now();
    const stored = await this.userTokens.findByHash(
      this.tokens.hashOf(input.token),
      'EMAIL_VERIFICATION',
    );

    if (!stored) {
      // Mesmo erro de token expirado: dizer "nao existe" confirmaria para um
      // atacante quais tokens ja foram usados.
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

    user.verifyEmail(now);

    await this.users.save(user);
    await this.userTokens.save(stored);

    return right(undefined);
  }
}
