import { Injectable } from '@nestjs/common';

import { PrismaTransactionManager } from '../../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';
import { type Invitation } from '../../../core/domain/entities/invitation';
import { type Workspace } from '../../../core/domain/entities/workspace';
import { type WorkspaceMember } from '../../../core/domain/entities/workspace-member';
import {
  type InvitationRepository,
  type WorkspaceRepository,
  type WorkspaceWithRole,
} from '../../../core/domain/repositories/workspace-repository';
import {
  InvitationMapper,
  WorkspaceMapper,
  WorkspaceMemberMapper,
} from '../mappers/workspace-mapper';

@Injectable()
export class PrismaWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(id: UniqueEntityId): Promise<Workspace | null> {
    const raw = await this.tx.client.workspace.findUnique({ where: { id: id.toValue() } });

    return raw ? WorkspaceMapper.toDomain(raw) : null;
  }

  /** Workspace e dono nascem juntos: um workspace sem dono ja nasce orfao. */
  async create(workspace: Workspace, owner: WorkspaceMember): Promise<void> {
    // No create aninhado o Prisma deriva o `workspaceId` do pai; manda-lo
    // explicitamente e' erro de validacao.
    const { workspaceId: _ownedBy, ...member } = WorkspaceMemberMapper.toPrisma(owner);

    await this.tx.client.workspace.create({
      data: {
        ...WorkspaceMapper.toPrisma(workspace),
        members: { create: member },
      },
    });
  }

  async save(workspace: Workspace): Promise<void> {
    const data = WorkspaceMapper.toPrisma(workspace);

    await this.tx.client.workspace.update({
      where: { id: data.id },
      data: { name: data.name, baseCurrency: data.baseCurrency },
    });
  }

  async delete(id: UniqueEntityId): Promise<void> {
    await this.tx.client.workspace.delete({ where: { id: id.toValue() } });
  }

  async listForUser(userId: UniqueEntityId): Promise<WorkspaceWithRole[]> {
    const memberships = await this.tx.client.workspaceMember.findMany({
      where: { userId: userId.toValue() },
      include: {
        workspace: { include: { _count: { select: { members: true } } } },
      },
    });

    return memberships.map((membership) => ({
      workspace: WorkspaceMapper.toDomain(membership.workspace),
      member: WorkspaceMemberMapper.toDomain(membership),
      memberCount: membership.workspace._count.members,
    }));
  }

  /**
   * Associacao de UM usuario em UM workspace.
   *
   * Os dois ids sao obrigatorios na assinatura: e' o que impede, por
   * construcao, uma consulta de autorizacao sem escopo.
   */
  async findMember(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
  ): Promise<WorkspaceMember | null> {
    const raw = await this.tx.client.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceId.toValue(),
          userId: userId.toValue(),
        },
      },
    });

    return raw ? WorkspaceMemberMapper.toDomain(raw) : null;
  }

  async listMembers(workspaceId: UniqueEntityId): Promise<WorkspaceMember[]> {
    const rows = await this.tx.client.workspaceMember.findMany({
      where: { workspaceId: workspaceId.toValue() },
      orderBy: { joinedAt: 'asc' },
    });

    return rows.map(WorkspaceMemberMapper.toDomain);
  }

  async addMember(member: WorkspaceMember): Promise<void> {
    await this.tx.client.workspaceMember.create({
      data: WorkspaceMemberMapper.toPrisma(member),
    });
  }

  async saveMember(member: WorkspaceMember): Promise<void> {
    const data = WorkspaceMemberMapper.toPrisma(member);

    await this.tx.client.workspaceMember.update({
      where: { id: data.id },
      data: { role: data.role },
    });
  }

  async removeMember(workspaceId: UniqueEntityId, userId: UniqueEntityId): Promise<void> {
    await this.tx.client.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceId.toValue(),
          userId: userId.toValue(),
        },
      },
    });
  }

  async countMembers(workspaceId: UniqueEntityId): Promise<number> {
    return this.tx.client.workspaceMember.count({
      where: { workspaceId: workspaceId.toValue() },
    });
  }
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(id: UniqueEntityId): Promise<Invitation | null> {
    const raw = await this.tx.client.invitation.findUnique({ where: { id: id.toValue() } });

    return raw ? InvitationMapper.toDomain(raw) : null;
  }

  async findByHash(tokenHash: string): Promise<Invitation | null> {
    const raw = await this.tx.client.invitation.findUnique({ where: { tokenHash } });

    return raw ? InvitationMapper.toDomain(raw) : null;
  }

  async findPendingByEmail(
    workspaceId: UniqueEntityId,
    email: Email,
  ): Promise<Invitation | null> {
    const raw = await this.tx.client.invitation.findFirst({
      where: {
        workspaceId: workspaceId.toValue(),
        email: email.value,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    return raw ? InvitationMapper.toDomain(raw) : null;
  }

  async listByWorkspace(workspaceId: UniqueEntityId): Promise<Invitation[]> {
    const rows = await this.tx.client.invitation.findMany({
      where: { workspaceId: workspaceId.toValue() },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(InvitationMapper.toDomain);
  }

  async create(invitation: Invitation): Promise<void> {
    await this.tx.client.invitation.create({ data: InvitationMapper.toPrisma(invitation) });
  }

  async save(invitation: Invitation): Promise<void> {
    const data = InvitationMapper.toPrisma(invitation);

    await this.tx.client.invitation.update({
      where: { id: data.id },
      data: { status: data.status, acceptedAt: data.acceptedAt },
    });
  }
}
