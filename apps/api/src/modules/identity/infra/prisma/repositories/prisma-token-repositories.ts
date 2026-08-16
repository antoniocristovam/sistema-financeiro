import { type UserTokenType } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaTransactionManager } from '../../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type RefreshToken } from '../../../core/domain/entities/refresh-token';
import { type UserToken } from '../../../core/domain/entities/user-token';
import { type RefreshTokenRepository } from '../../../core/domain/repositories/refresh-token-repository';
import { type UserTokenRepository } from '../../../core/domain/repositories/user-token-repository';
import { RefreshTokenMapper, UserTokenMapper } from '../mappers/token-mappers';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const raw = await this.tx.client.refreshToken.findUnique({ where: { tokenHash } });

    return raw ? RefreshTokenMapper.toDomain(raw) : null;
  }

  async create(token: RefreshToken): Promise<void> {
    await this.tx.client.refreshToken.create({ data: RefreshTokenMapper.toPrisma(token) });
  }

  async save(token: RefreshToken): Promise<void> {
    const data = RefreshTokenMapper.toPrisma(token);

    await this.tx.client.refreshToken.update({
      where: { id: data.id },
      data: { revokedAt: data.revokedAt, replacedByTokenId: data.replacedByTokenId },
    });
  }

  /** Deteccao de replay: derruba a cadeia inteira de um login. */
  async revokeFamily(familyId: UniqueEntityId, revokedAt: Date): Promise<void> {
    await this.tx.client.refreshToken.updateMany({
      where: { familyId: familyId.toValue(), revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeAllForUser(userId: UniqueEntityId, revokedAt: Date): Promise<void> {
    await this.tx.client.refreshToken.updateMany({
      where: { userId: userId.toValue(), revokedAt: null },
      data: { revokedAt },
    });
  }
}

@Injectable()
export class PrismaUserTokenRepository implements UserTokenRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findByHash(tokenHash: string, type: UserTokenType): Promise<UserToken | null> {
    const raw = await this.tx.client.userToken.findUnique({ where: { tokenHash } });

    // O tipo faz parte da identidade do token: um token de verificacao de
    // e-mail nunca pode servir como token de redefinicao de senha.
    return raw && raw.type === type ? UserTokenMapper.toDomain(raw) : null;
  }

  async create(token: UserToken): Promise<void> {
    await this.tx.client.userToken.create({ data: UserTokenMapper.toPrisma(token) });
  }

  async save(token: UserToken): Promise<void> {
    const data = UserTokenMapper.toPrisma(token);

    await this.tx.client.userToken.update({
      where: { id: data.id },
      data: { usedAt: data.usedAt },
    });
  }

  async invalidateAllForUser(
    userId: UniqueEntityId,
    type: UserTokenType,
    at: Date,
  ): Promise<void> {
    await this.tx.client.userToken.updateMany({
      where: { userId: userId.toValue(), type, usedAt: null },
      data: { usedAt: at },
    });
  }
}
