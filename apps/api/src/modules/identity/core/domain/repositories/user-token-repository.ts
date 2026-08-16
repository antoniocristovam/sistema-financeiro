import { type UserTokenType } from '@finapp/contracts';

import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type UserToken } from '../entities/user-token';

export interface UserTokenRepository {
  findByHash(tokenHash: string, type: UserTokenType): Promise<UserToken | null>;
  create(token: UserToken): Promise<void>;
  save(token: UserToken): Promise<void>;
  /**
   * Invalida os tokens anteriores do mesmo tipo.
   *
   * Pedir um novo link de redefinicao precisa matar o anterior: dois links
   * validos ao mesmo tempo dobram a janela de ataque.
   */
  invalidateAllForUser(userId: UniqueEntityId, type: UserTokenType, at: Date): Promise<void>;
}

export const USER_TOKEN_REPOSITORY = Symbol('UserTokenRepository');
