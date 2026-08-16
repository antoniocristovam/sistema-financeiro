import { type WorkspacePermission, type WorkspaceRole } from '@finapp/contracts';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Role } from '../value-objects/role';

export interface WorkspaceMemberProps {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  role: Role;
  joinedAt: Date;
}

export class WorkspaceMember extends Entity<WorkspaceMemberProps> {
  static create(
    props: Optional<WorkspaceMemberProps, 'joinedAt'>,
    id?: UniqueEntityId,
  ): WorkspaceMember {
    return new WorkspaceMember({ ...props, joinedAt: props.joinedAt ?? new Date() }, id);
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get userId(): UniqueEntityId {
    return this.props.userId;
  }

  get role(): Role {
    return this.props.role;
  }

  get joinedAt(): Date {
    return this.props.joinedAt;
  }

  /** Ponto unico de decisao de permissao para este membro. */
  can(permission: WorkspacePermission): boolean {
    return this.props.role.can(permission);
  }

  isOwner(): boolean {
    return this.props.role.isOwner();
  }

  is(userId: UniqueEntityId): boolean {
    return this.props.userId.equals(userId);
  }

  changeRole(role: WorkspaceRole): void {
    this.props.role = Role.create(role);
  }

  promoteToOwner(): void {
    this.props.role = Role.owner();
  }
}
