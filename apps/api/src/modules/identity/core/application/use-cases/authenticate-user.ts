import { ApiErrorCode } from '@finapp/contracts';

import { DomainError } from '../../../../../shared/domain/errors/domain-error';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { type Either, left, right } from '../../../../../shared/either';
import { type User } from '../../domain/entities/user';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type Hasher } from '../ports/hasher';
import {
  type IssuedSession,
  type SessionContext,
  type SessionIssuer,
} from '../services/session-issuer';

export class InvalidCredentialsError extends DomainError {
  readonly code = ApiErrorCode.INVALID_CREDENTIALS;
  readonly message = 'E-mail ou senha incorretos.';
}

export interface AuthenticateUserInput extends SessionContext {
  email: string;
  password: string;
}

export interface AuthenticateUserOutput {
  user: User;
  session: IssuedSession;
}

/**
 * Login.
 *
 * Duas decisoes de seguranca que parecem detalhe e nao sao:
 *
 * 1. **A mesma mensagem para e-mail inexistente e senha errada.** Diferenciar
 *    transforma o login em um verificador de cadastro: da para descobrir quem
 *    tem conta no sistema so pela resposta.
 * 2. **O hash e' comparado mesmo quando o usuario nao existe.** Sem isso, a
 *    resposta para e-mail inexistente volta em microssegundos e a de senha
 *    errada demora o tempo do argon2 -- a diferenca de tempo entrega a mesma
 *    informacao que a mensagem entregaria.
 */
export class AuthenticateUserUseCase {
  /**
   * Hash descartavel com o mesmo custo dos reais, usado so para gastar tempo
   * quando o usuario nao existe.
   */
  private dummyHash: string | null = null;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: Hasher,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(
    input: AuthenticateUserInput,
  ): Promise<Either<InvalidCredentialsError, AuthenticateUserOutput>> {
    const emailResult = Email.create(input.email);

    if (emailResult.isLeft()) {
      return left(new InvalidCredentialsError());
    }

    const user = await this.users.findByEmail(emailResult.value);

    if (!user) {
      await this.burnTime(input.password);
      return left(new InvalidCredentialsError());
    }

    const matches = await this.hasher.compare(input.password, user.passwordHash);

    if (!matches) {
      return left(new InvalidCredentialsError());
    }

    const session = await this.sessions.issue(user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return right({ user, session });
  }

  private async burnTime(password: string): Promise<void> {
    this.dummyHash ??= await this.hasher.hash('senha-que-nao-existe');
    await this.hasher.compare(password, this.dummyHash);
  }
}
