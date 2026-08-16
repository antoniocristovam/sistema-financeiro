import {
  type Invitation as PrismaInvitation,
  type Workspace as PrismaWorkspace,
  type WorkspaceMember as PrismaMember,
} from '@prisma/client';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { Invitation } from '../../../core/domain/entities/invitation';
import { Workspace } from '../../../core/domain/entities/workspace';
import { WorkspaceMember } from '../../../core/domain/entities/workspace-member';
import { Role } from '../../../core/domain/value-objects/role';

export class WorkspaceMapper {
  static toDomain(raw: PrismaWorkspace): Workspace {
    return Workspace.create(
      {
        name: raw.name,
        type: raw.type,
        baseCurrency: raw.baseCurrency,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(workspace: Workspace) {
    return {
      id: workspace.id.toValue(),
      name: workspace.name,
      type: workspace.type,
      baseCurrency: workspace.baseCurrency,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }
}

export class WorkspaceMemberMapper {
  static toDomain(raw: PrismaMember): WorkspaceMember {
    return WorkspaceMember.create(
      {
        workspaceId: new UniqueEntityId(raw.workspaceId),
        userId: new UniqueEntityId(raw.userId),
        role: Role.create(raw.role),
        joinedAt: raw.joinedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(member: WorkspaceMember) {
    return {
      id: member.id.toValue(),
      workspaceId: member.workspaceId.toValue(),
      userId: member.userId.toValue(),
      role: member.role.value,
      joinedAt: member.joinedAt,
    };
  }
}

export class InvitationMapper {
  static toDomain(raw: PrismaInvitation): Invitation {
    const email = Email.create(raw.email);

    if (email.isLeft()) {
      throw new Error(`E-mail invalido no banco (invitation ${raw.id}): ${raw.email}`);
    }

    return Invitation.create(
      {
        workspaceId: new UniqueEntityId(raw.workspaceId),
        email: email.value,
        role: raw.role,
        tokenHash: raw.tokenHash,
        expiresAt: raw.expiresAt,
        status: raw.status,
        invitedByUserId: new UniqueEntityId(raw.invitedByUserId),
        acceptedAt: raw.acceptedAt,
        createdAt: raw.createdAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(invitation: Invitation) {
    return {
      id: invitation.id.toValue(),
      workspaceId: invitation.workspaceId.toValue(),
      email: invitation.email.value,
      role: invitation.role,
      tokenHash: invitation.tokenHash,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
      invitedByUserId: invitation.invitedByUserId.toValue(),
      acceptedAt: invitation.acceptedAt,
      createdAt: invitation.createdAt,
    };
  }
}
