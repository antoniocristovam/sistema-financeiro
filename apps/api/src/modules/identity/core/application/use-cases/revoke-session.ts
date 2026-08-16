import { type Clock } from '../../../../../shared/application/ports/clock';
import { type Either, right } from '../../../../../shared/either';
import { type RefreshTokenRepository } from '../../domain/repositories/refresh-token-repository';
import { type TokenGenerator } from '../ports/token-generator';

export interface RevokeSessionInput {
  refreshToken?: string;
}

/**
 * Logout.
 *
 * Derruba a FAMILIA, nao so o token atual: se o usuario clicou em sair, ele
 * espera que a sessao acabe -- inclusive o token que estava a caminho numa
 * requisicao concorrente.
 *
 * Nunca falha. Sair com um token invalido ou ausente ja e' o resultado
 * desejado, e devolver erro so faria o cliente ficar preso numa tela de logout
 * que nao completa.
 */
export class RevokeSessionUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RevokeSessionInput): Promise<Either<never, void>> {
    if (!input.refreshToken) {
      return right(undefined);
    }

    const stored = await this.refreshTokens.findByHash(this.tokens.hashOf(input.refreshToken));

    if (stored) {
      await this.refreshTokens.revokeFamily(stored.familyId, this.clock.now());
    }

    return right(undefined);
  }
}
