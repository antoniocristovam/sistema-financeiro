import {
  type RefreshToken as PrismaRefreshToken,
  type UserToken as PrismaUserToken,
} from '@prisma/client';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { RefreshToken } from '../../../core/domain/entities/refresh-token';
import { UserToken } from '../../../core/domain/entities/user-token';

export class RefreshTokenMapper {
  static toDomain(raw: PrismaRefreshToken): RefreshToken {
    return RefreshToken.create(
      {
        userId: new UniqueEntityId(raw.userId),
        tokenHash: raw.tokenHash,
        familyId: new UniqueEntityId(raw.familyId),
        expiresAt: raw.expiresAt,
        revokedAt: raw.revokedAt,
        replacedByTokenId: raw.replacedByTokenId
          ? new UniqueEntityId(raw.replacedByTokenId)
          : null,
        userAgent: raw.userAgent,
        ipAddress: raw.ipAddress,
        createdAt: raw.createdAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(token: RefreshToken) {
    return {
      id: token.id.toValue(),
      userId: token.userId.toValue(),
      tokenHash: token.tokenHash,
      familyId: token.familyId.toValue(),
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      replacedByTokenId: token.replacedByTokenId?.toValue() ?? null,
      userAgent: token.userAgent,
      ipAddress: token.ipAddress,
      createdAt: token.createdAt,
    };
  }
}

export class UserTokenMapper {
  static toDomain(raw: PrismaUserToken): UserToken {
    return UserToken.create(
      {
        userId: new UniqueEntityId(raw.userId),
        type: raw.type,
        tokenHash: raw.tokenHash,
        expiresAt: raw.expiresAt,
        usedAt: raw.usedAt,
        createdAt: raw.createdAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(token: UserToken) {
    return {
      id: token.id.toValue(),
      userId: token.userId.toValue(),
      type: token.type,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      usedAt: token.usedAt,
      createdAt: token.createdAt,
    };
  }
}
