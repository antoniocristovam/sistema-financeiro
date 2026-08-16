import { type Clock } from '../../../../../shared/application/ports/clock';
import { type MailService } from '../../../../../shared/application/ports/mail-service';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { type Either, right } from '../../../../../shared/either';
import { UserToken } from '../../domain/entities/user-token';
import { type UserRepository } from '../../domain/repositories/user-repository';
import { type UserTokenRepository } from '../../domain/repositories/user-token-repository';
import { type TokenGenerator } from '../ports/token-generator';
import { buildPasswordResetEmail } from '../mail/verification-email';

export interface RequestPasswordResetInput {
  email: string;
}

/**
 * Pedido de redefinicao de senha.
 *
 * SEMPRE devolve sucesso, exista o e-mail ou nao. Responder "e-mail nao
 * cadastrado" transformaria esta rota em um verificador de cadastro aberto ao
 * publico -- da para varrer uma lista de e-mails e descobrir quem usa o
 * sistema.
 *
 * O token anterior e' invalidado a cada pedido: dois links validos ao mesmo
 * tempo dobram a janela de ataque sem beneficio nenhum para o usuario.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userTokens: UserTokenRepository,
    private readonly tokens: TokenGenerator,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly webUrl: string,
  ) {}

  async execute(input: RequestPasswordResetInput): Promise<Either<never, void>> {
    const emailResult = Email.create(input.email);

    if (emailResult.isLeft()) {
      return right(undefined);
    }

    const user = await this.users.findByEmail(emailResult.value);

    if (!user) {
      return right(undefined);
    }

    const now = this.clock.now();

    await this.userTokens.invalidateAllForUser(user.id, 'PASSWORD_RESET', now);

    const opaque = this.tokens.generate();

    await this.userTokens.create(
      UserToken.create({
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: opaque.hash,
        expiresAt: new Date(now.getTime() + UserToken.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
        createdAt: now,
      }),
    );

    await this.mail.send(
      buildPasswordResetEmail({
        name: user.name,
        to: user.email.value,
        token: opaque.plain,
        webUrl: this.webUrl,
      }),
    );

    return right(undefined);
  }
}
