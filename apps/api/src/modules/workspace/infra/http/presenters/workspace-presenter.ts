import {
  type Invitation as InvitationContract,
  type Workspace as WorkspaceContract,
  type WorkspaceMember as MemberContract,
} from '@finapp/contracts';

import { type Invitation } from '../../../core/domain/entities/invitation';
import { type WorkspaceMember } from '../../../core/domain/entities/workspace-member';
import { type WorkspaceWithRole } from '../../../core/domain/repositories/workspace-repository';

export class WorkspacePresenter {
  static toHttp(entry: WorkspaceWithRole): WorkspaceContract {
    return {
      id: entry.workspace.id.toValue(),
      name: entry.workspace.name,
      type: entry.workspace.type,
      baseCurrency: entry.workspace.baseCurrency,
      // Papel de QUEM pediu. A UI usa para esconder acao proibida; a barreira
      // continua sendo a checagem no caso de uso.
      role: entry.member.role.value,
      memberCount: entry.memberCount,
      createdAt: entry.workspace.createdAt.toISOString(),
    };
  }
}

/** Dados do usuario que acompanham o membro na listagem. */
export interface MemberUserInfo {
  name: string;
  email: string;
}

export class WorkspaceMemberPresenter {
  static toHttp(member: WorkspaceMember, user: MemberUserInfo): MemberContract {
    return {
      id: member.id.toValue(),
      userId: member.userId.toValue(),
      name: user.name,
      email: user.email,
      role: member.role.value,
      joinedAt: member.joinedAt.toISOString(),
    };
  }
}

export class InvitationPresenter {
  static toHttp(
    invitation: Invitation,
    workspaceName: string,
    invitedByName: string,
  ): InvitationContract {
    return {
      id: invitation.id.toValue(),
      workspaceId: invitation.workspaceId.toValue(),
      workspaceName,
      email: invitation.email.value,
      role: invitation.role,
      status: invitation.status,
      invitedByName,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
