import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';
import { type Invitation } from '../entities/invitation';
import { type Workspace } from '../entities/workspace';
import { type WorkspaceMember } from '../entities/workspace-member';

/** Workspace + o papel de quem pediu. E' o que a listagem devolve. */
export interface WorkspaceWithRole {
  workspace: Workspace;
  member: WorkspaceMember;
  memberCount: number;
}

/**
 * Porta do repositorio de workspaces.
 *
 * Repare que `findMember` recebe SEMPRE `workspaceId` junto do `userId`. Nao
 * existe consulta de associacao sem os dois -- e' essa assinatura que torna
 * impossivel, por construcao, esquecer o escopo na hora de autorizar.
 */
export interface WorkspaceRepository {
  findById(id: UniqueEntityId): Promise<Workspace | null>;
  create(workspace: Workspace, owner: WorkspaceMember): Promise<void>;
  save(workspace: Workspace): Promise<void>;
  delete(id: UniqueEntityId): Promise<void>;

  /** Workspaces em que o usuario participa, com o papel dele em cada um. */
  listForUser(userId: UniqueEntityId): Promise<WorkspaceWithRole[]>;

  /** Associacao de UM usuario em UM workspace. A base de toda autorizacao. */
  findMember(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
  ): Promise<WorkspaceMember | null>;
  listMembers(workspaceId: UniqueEntityId): Promise<WorkspaceMember[]>;
  addMember(member: WorkspaceMember): Promise<void>;
  saveMember(member: WorkspaceMember): Promise<void>;
  removeMember(workspaceId: UniqueEntityId, userId: UniqueEntityId): Promise<void>;
  countMembers(workspaceId: UniqueEntityId): Promise<number>;
}

export const WORKSPACE_REPOSITORY = Symbol('WorkspaceRepository');

export interface InvitationRepository {
  findById(id: UniqueEntityId): Promise<Invitation | null>;
  findByHash(tokenHash: string): Promise<Invitation | null>;
  findPendingByEmail(workspaceId: UniqueEntityId, email: Email): Promise<Invitation | null>;
  listByWorkspace(workspaceId: UniqueEntityId): Promise<Invitation[]>;
  create(invitation: Invitation): Promise<void>;
  save(invitation: Invitation): Promise<void>;
}

export const INVITATION_REPOSITORY = Symbol('InvitationRepository');
