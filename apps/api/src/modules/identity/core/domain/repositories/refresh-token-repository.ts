import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type RefreshToken } from '../entities/refresh-token';

export interface RefreshTokenRepository {
  /** Busca pelo HASH: o token em claro nunca chega ao banco. */
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  create(token: RefreshToken): Promise<void>;
  save(token: RefreshToken): Promise<void>;
  /** Deteccao de replay: derruba a cadeia inteira de um login. */
  revokeFamily(familyId: UniqueEntityId, revokedAt: Date): Promise<void>;
  /** Logout de todas as sessoes (troca de senha, remocao de acesso). */
  revokeAllForUser(userId: UniqueEntityId, revokedAt: Date): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('RefreshTokenRepository');
