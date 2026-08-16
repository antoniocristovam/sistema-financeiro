import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';

export interface RefreshTokenProps {
  userId: UniqueEntityId;
  /** Só o hash. O token em claro vive no cookie do usuario. */
  tokenHash: string;
  /** Agrupa a cadeia de rotacoes de um mesmo login. */
  familyId: UniqueEntityId;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: UniqueEntityId | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

/**
 * Refresh token rotativo.
 *
 * Cada uso queima o token atual e emite um novo. A `familyId` amarra a cadeia
 * inteira de um login, e e' o que permite detectar REPLAY: se um token que ja
 * foi rotacionado reaparecer, ou alguem esta reusando um token roubado, ou o
 * legitimo perdeu a resposta da rotacao. Nos dois casos a resposta segura e' a
 * mesma -- derrubar a familia inteira e obrigar login de novo.
 *
 * Sem a familia, um token roubado sobreviveria indefinidamente: o atacante
 * rotacionaria em paralelo com o dono e nenhum dos dois notaria.
 */
export class RefreshToken extends Entity<RefreshTokenProps> {
  static create(
    props: Optional<
      RefreshTokenProps,
      'familyId' | 'revokedAt' | 'replacedByTokenId' | 'userAgent' | 'ipAddress' | 'createdAt'
    >,
    id?: UniqueEntityId,
  ): RefreshToken {
    return new RefreshToken(
      {
        ...props,
        familyId: props.familyId ?? new UniqueEntityId(),
        revokedAt: props.revokedAt ?? null,
        replacedByTokenId: props.replacedByTokenId ?? null,
        userAgent: props.userAgent ?? null,
        ipAddress: props.ipAddress ?? null,
        createdAt: props.createdAt ?? new Date(),
      },
      id,
    );
  }

  get userId(): UniqueEntityId {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get familyId(): UniqueEntityId {
    return this.props.familyId;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get replacedByTokenId(): UniqueEntityId | null {
    return this.props.replacedByTokenId;
  }

  get userAgent(): string | null {
    return this.props.userAgent;
  }

  get ipAddress(): string | null {
    return this.props.ipAddress;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  isActive(now: Date): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  /**
   * Token JA rotacionado que aparece de novo.
   *
   * E' o sinal de replay: um token substituido nunca deveria voltar.
   */
  wasAlreadyRotated(): boolean {
    return this.props.replacedByTokenId !== null;
  }

  revoke(now: Date): void {
    if (this.props.revokedAt === null) {
      this.props.revokedAt = now;
    }
  }

  /** Queima este token, apontando o sucessor da cadeia. */
  rotateTo(successorId: UniqueEntityId, now: Date): void {
    this.props.replacedByTokenId = successorId;
    this.revoke(now);
  }
}
