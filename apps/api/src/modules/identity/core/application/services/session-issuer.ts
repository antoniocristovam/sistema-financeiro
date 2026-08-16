import { type Clock } from '../../../../../shared/application/ports/clock';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { RefreshToken } from '../../domain/entities/refresh-token';
import { type User } from '../../domain/entities/user';
import { type RefreshTokenRepository } from '../../domain/repositories/refresh-token-repository';
import { type Encrypter } from '../ports/encrypter';
import { type TokenGenerator } from '../ports/token-generator';

export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface IssuedSession {
  accessToken: string;
  /** Segundos de validade do access token. */
  expiresIn: number;
  /** Vai para o cookie httpOnly. NUNCA para o corpo da resposta. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Emissao de sessao: access token curto (15 min) + refresh token rotativo.
 *
 * Usado no cadastro, no login e na renovacao. Ter um lugar so evita que um
 * deles esqueca de amarrar a familia -- e a familia e' o que torna o replay
 * detectavel.
 */
export class SessionIssuer {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly encrypter: Encrypter,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
    private readonly refreshTtlInSeconds: number,
  ) {}

  /** Login ou cadastro: abre uma familia nova. */
  async issue(user: User, context: SessionContext = {}): Promise<IssuedSession> {
    const { session } = await this.create(user, new UniqueEntityId(), context);

    return session;
  }

  /**
   * Renovacao.
   *
   * Mantem a familia e QUEIMA o token anterior apontando o sucessor. Se o
   * anterior reaparecer depois disso, e' replay -- e o `RefreshSessionUseCase`
   * derruba a familia inteira.
   */
  async rotate(
    user: User,
    previous: RefreshToken,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const { session, entity } = await this.create(user, previous.familyId, context, now);

    previous.rotateTo(entity.id, now);
    await this.refreshTokens.save(previous);

    return session;
  }

  private async create(
    user: User,
    familyId: UniqueEntityId,
    context: SessionContext,
    at?: Date,
  ): Promise<{ session: IssuedSession; entity: RefreshToken }> {
    const now = at ?? this.clock.now();
    const opaque = this.tokens.generate();
    const expiresAt = new Date(now.getTime() + this.refreshTtlInSeconds * 1000);

    const entity = RefreshToken.create({
      userId: user.id,
      tokenHash: opaque.hash,
      familyId,
      expiresAt,
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
      createdAt: now,
    });

    await this.refreshTokens.create(entity);

    const accessToken = await this.encrypter.encrypt({
      sub: user.id.toValue(),
      email: user.email.value,
    });

    return {
      session: {
        accessToken,
        expiresIn: this.encrypter.accessTokenTtlInSeconds(),
        refreshToken: opaque.plain,
        refreshTokenExpiresAt: expiresAt,
      },
      entity,
    };
  }
}
