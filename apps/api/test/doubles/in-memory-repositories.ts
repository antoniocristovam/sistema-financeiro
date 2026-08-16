import { createHash } from 'node:crypto';

import { type UserTokenType } from '@finapp/contracts';

import { type Clock } from '../../src/shared/application/ports/clock';
import {
  type AuditEntry,
  type AuditLogger,
} from '../../src/shared/application/ports/audit-logger';
import {
  type MailService,
  type SendMailInput,
} from '../../src/shared/application/ports/mail-service';
import { type UnitOfWork } from '../../src/shared/application/ports/unit-of-work';
import { type UniqueEntityId } from '../../src/shared/domain/unique-entity-id';
import { type Email } from '../../src/shared/domain/value-objects/email';
import { type Hasher } from '../../src/modules/identity/core/application/ports/hasher';
import {
  type AccessTokenPayload,
  type Encrypter,
} from '../../src/modules/identity/core/application/ports/encrypter';
import {
  type OpaqueToken,
  type TokenGenerator,
} from '../../src/modules/identity/core/application/ports/token-generator';
import { type FinancialProfile } from '../../src/modules/identity/core/domain/entities/financial-profile';
import { type RefreshToken } from '../../src/modules/identity/core/domain/entities/refresh-token';
import { type User } from '../../src/modules/identity/core/domain/entities/user';
import { type UserToken } from '../../src/modules/identity/core/domain/entities/user-token';
import { type RefreshTokenRepository } from '../../src/modules/identity/core/domain/repositories/refresh-token-repository';
import { type UserRepository } from '../../src/modules/identity/core/domain/repositories/user-repository';
import { type UserTokenRepository } from '../../src/modules/identity/core/domain/repositories/user-token-repository';
import { type Invitation } from '../../src/modules/workspace/core/domain/entities/invitation';
import { type Workspace } from '../../src/modules/workspace/core/domain/entities/workspace';
import { type WorkspaceMember } from '../../src/modules/workspace/core/domain/entities/workspace-member';
import {
  type InvitationRepository,
  type WorkspaceRepository,
  type WorkspaceWithRole,
} from '../../src/modules/workspace/core/domain/repositories/workspace-repository';

/**
 * Dublês em memoria para os testes de caso de uso.
 *
 * Sao implementacoes REAIS das portas, nao mocks com `vi.fn()`. A diferenca
 * importa: um mock verifica que um metodo foi chamado; um duble em memoria
 * verifica que o ESTADO ficou certo depois. Testar "chamou save()" passa mesmo
 * quando o objeto salvo esta errado.
 */

export class InMemoryUserRepository implements UserRepository {
  readonly items: User[] = [];
  readonly profiles: FinancialProfile[] = [];

  async findById(id: UniqueEntityId): Promise<User | null> {
    return this.items.find((user) => user.id.equals(id)) ?? null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    return this.items.find((user) => user.email.equals(email)) ?? null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    return this.items.some((user) => user.email.equals(email));
  }

  async findManyByIds(ids: UniqueEntityId[]): Promise<Map<string, User>> {
    const wanted = new Set(ids.map((id) => id.toValue()));

    return new Map(
      this.items
        .filter((user) => wanted.has(user.id.toValue()))
        .map((user) => [user.id.toValue(), user]),
    );
  }

  async save(user: User): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(user.id));

    if (index >= 0) {
      this.items[index] = user;
    } else {
      this.items.push(user);
    }
  }

  async findProfileByUserId(userId: UniqueEntityId): Promise<FinancialProfile | null> {
    return this.profiles.find((profile) => profile.userId.equals(userId)) ?? null;
  }

  async saveProfile(profile: FinancialProfile): Promise<void> {
    const index = this.profiles.findIndex((item) => item.userId.equals(profile.userId));

    if (index >= 0) {
      this.profiles[index] = profile;
    } else {
      this.profiles.push(profile);
    }
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly items: RefreshToken[] = [];

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.items.find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async create(token: RefreshToken): Promise<void> {
    this.items.push(token);
  }

  async save(token: RefreshToken): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(token.id));

    if (index >= 0) {
      this.items[index] = token;
    }
  }

  async revokeFamily(familyId: UniqueEntityId, revokedAt: Date): Promise<void> {
    for (const token of this.items) {
      if (token.familyId.equals(familyId)) {
        token.revoke(revokedAt);
      }
    }
  }

  async revokeAllForUser(userId: UniqueEntityId, revokedAt: Date): Promise<void> {
    for (const token of this.items) {
      if (token.userId.equals(userId)) {
        token.revoke(revokedAt);
      }
    }
  }
}

export class InMemoryUserTokenRepository implements UserTokenRepository {
  readonly items: UserToken[] = [];

  async findByHash(tokenHash: string, type: UserTokenType): Promise<UserToken | null> {
    return this.items.find((item) => item.tokenHash === tokenHash && item.type === type) ?? null;
  }

  async create(token: UserToken): Promise<void> {
    this.items.push(token);
  }

  async save(token: UserToken): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(token.id));

    if (index >= 0) {
      this.items[index] = token;
    }
  }

  async invalidateAllForUser(
    userId: UniqueEntityId,
    type: UserTokenType,
    at: Date,
  ): Promise<void> {
    for (const token of this.items) {
      if (token.userId.equals(userId) && token.type === type && !token.isUsed()) {
        token.consume(at);
      }
    }
  }
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly items: Workspace[] = [];
  readonly members: WorkspaceMember[] = [];

  async findById(id: UniqueEntityId): Promise<Workspace | null> {
    return this.items.find((workspace) => workspace.id.equals(id)) ?? null;
  }

  async create(workspace: Workspace, owner: WorkspaceMember): Promise<void> {
    this.items.push(workspace);
    this.members.push(owner);
  }

  async save(workspace: Workspace): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(workspace.id));

    if (index >= 0) {
      this.items[index] = workspace;
    }
  }

  async delete(id: UniqueEntityId): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(id));

    if (index >= 0) {
      this.items.splice(index, 1);
    }

    for (let i = this.members.length - 1; i >= 0; i -= 1) {
      if (this.members[i]!.workspaceId.equals(id)) {
        this.members.splice(i, 1);
      }
    }
  }

  async listForUser(userId: UniqueEntityId): Promise<WorkspaceWithRole[]> {
    return this.members
      .filter((member) => member.userId.equals(userId))
      .map((member) => {
        const workspace = this.items.find((item) => item.id.equals(member.workspaceId))!;

        return {
          workspace,
          member,
          memberCount: this.members.filter((item) => item.workspaceId.equals(workspace.id)).length,
        };
      });
  }

  async findMember(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
  ): Promise<WorkspaceMember | null> {
    return (
      this.members.find(
        (member) => member.workspaceId.equals(workspaceId) && member.userId.equals(userId),
      ) ?? null
    );
  }

  async listMembers(workspaceId: UniqueEntityId): Promise<WorkspaceMember[]> {
    return this.members.filter((member) => member.workspaceId.equals(workspaceId));
  }

  async addMember(member: WorkspaceMember): Promise<void> {
    this.members.push(member);
  }

  async saveMember(member: WorkspaceMember): Promise<void> {
    const index = this.members.findIndex((item) => item.id.equals(member.id));

    if (index >= 0) {
      this.members[index] = member;
    }
  }

  async removeMember(workspaceId: UniqueEntityId, userId: UniqueEntityId): Promise<void> {
    const index = this.members.findIndex(
      (member) => member.workspaceId.equals(workspaceId) && member.userId.equals(userId),
    );

    if (index >= 0) {
      this.members.splice(index, 1);
    }
  }

  async countMembers(workspaceId: UniqueEntityId): Promise<number> {
    return this.members.filter((member) => member.workspaceId.equals(workspaceId)).length;
  }
}

export class InMemoryInvitationRepository implements InvitationRepository {
  readonly items: Invitation[] = [];

  async findById(id: UniqueEntityId): Promise<Invitation | null> {
    return this.items.find((item) => item.id.equals(id)) ?? null;
  }

  async findByHash(tokenHash: string): Promise<Invitation | null> {
    return this.items.find((item) => item.tokenHash === tokenHash) ?? null;
  }

  async findPendingByEmail(
    workspaceId: UniqueEntityId,
    email: Email,
  ): Promise<Invitation | null> {
    return (
      this.items.find(
        (item) =>
          item.workspaceId.equals(workspaceId) && item.email.equals(email) && item.isPending(),
      ) ?? null
    );
  }

  async listByWorkspace(workspaceId: UniqueEntityId): Promise<Invitation[]> {
    return this.items.filter((item) => item.workspaceId.equals(workspaceId));
  }

  async create(invitation: Invitation): Promise<void> {
    this.items.push(invitation);
  }

  async save(invitation: Invitation): Promise<void> {
    const index = this.items.findIndex((item) => item.id.equals(invitation.id));

    if (index >= 0) {
      this.items[index] = invitation;
    }
  }
}

// -- Portas de infraestrutura ------------------------------------------------

/**
 * Hash barato para teste -- o argon2 real levaria ~100ms por chamada.
 *
 * Usa sha256 de proposito, e nao algo como `hashed:${plain}`: um duble que
 * embute a senha em claro faz passar o teste de "o hash nao contem a senha"
 * sem ele significar nada.
 */
export class FakeHasher implements Hasher {
  async hash(plain: string): Promise<string> {
    return this.digest(plain);
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    return this.digest(plain) === hash;
  }

  /** Exposto para o teste conseguir montar o hash esperado. */
  digest(plain: string): string {
    return `fake$${createHash('sha256').update(plain).digest('hex')}`;
  }
}

export class FakeEncrypter implements Encrypter {
  async encrypt(payload: AccessTokenPayload): Promise<string> {
    return JSON.stringify(payload);
  }

  async decrypt(token: string): Promise<AccessTokenPayload | null> {
    try {
      return JSON.parse(token) as AccessTokenPayload;
    } catch {
      return null;
    }
  }

  accessTokenTtlInSeconds(): number {
    return 900;
  }
}

/** Token previsivel, para o teste conseguir apresentar o valor em claro. */
export class FakeTokenGenerator implements TokenGenerator {
  private counter = 0;

  generate(): OpaqueToken {
    this.counter += 1;
    const plain = `token-${this.counter}`;

    return { plain, hash: this.hashOf(plain) };
  }

  hashOf(plain: string): string {
    return `hash:${plain}`;
  }
}

/** Relogio parado, que o teste avanca quando quer. */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-03-15T12:00:00Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(date: Date): void {
    this.current = date;
  }
}

export class FakeMailService implements MailService {
  readonly sent: SendMailInput[] = [];
  /** Simula SMTP recusando o proximo envio, sem levantar excecao. */
  failNext = false;

  async send(input: SendMailInput): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false;

      return false;
    }

    this.sent.push(input);

    return true;
  }

  lastTo(email: string): SendMailInput | undefined {
    return [...this.sent].reverse().find((mail) => mail.to === email);
  }
}

export class FakeAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  has(action: string): boolean {
    return this.entries.some((entry) => entry.action === action);
  }
}

/**
 * Unidade de trabalho que so executa o bloco.
 *
 * Nao ha transacao para simular em memoria -- o que este duble garante e' que o
 * caso de uso CHAMA o `run`, e o teste de integracao contra o Postgres real e'
 * quem verifica a atomicidade de verdade.
 */
export class FakeUnitOfWork implements UnitOfWork {
  calls = 0;

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return work();
  }
}
