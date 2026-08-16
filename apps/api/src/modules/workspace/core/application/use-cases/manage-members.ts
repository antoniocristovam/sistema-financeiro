import { type WorkspaceRole } from '@finapp/contracts';

import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  NotAllowedError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { type Invitation } from '../../domain/entities/invitation';
import { type WorkspaceMember } from '../../domain/entities/workspace-member';
import {
  type LastOwnerError,
  type NotMemberError,
  type PersonalWorkspaceError,
} from '../../domain/errors/workspace-errors';
import {
  type InvitationRepository,
  type WorkspaceRepository,
} from '../../domain/repositories/workspace-repository';
import { MembershipList } from '../../domain/value-objects/membership-list';
import { type AccessError, type WorkspaceAccessService } from '../services/workspace-access';

type MemberError = AccessError | LastOwnerError | NotMemberError | NotAllowedError;

/** Membro + os dados do usuario dele, prontos para a tela. */
export interface MemberWithUser {
  member: WorkspaceMember;
  name: string;
  email: string;
}

/** Membros de um workspace. Qualquer papel pode ver quem participa. */
export class ListMembersUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    actorUserId: UniqueEntityId,
  ): Promise<Either<AccessError, MemberWithUser[]>> {
    const authorized = await this.access.authorize(workspaceId, actorUserId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const members = await this.workspaces.listMembers(workspaceId);
    // Uma consulta para todos, nao uma por membro.
    const directory = await this.users.findManyByIds(members.map((member) => member.userId));

    return right(
      members.map((member) => {
        const user = directory.get(member.userId.toValue());

        return {
          member,
          name: user?.name ?? 'Usuario removido',
          email: user?.email.value ?? '',
        };
      }),
    );
  }
}

export interface ChangeMemberRoleInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  targetUserId: UniqueEntityId;
  role: WorkspaceRole;
  ipAddress?: string;
}

/**
 * Troca de papel de um membro.
 *
 * Duas regras que a matriz de permissoes sozinha nao cobre:
 *
 * 1. **Ninguem promove alguem a OWNER por aqui.** Posse se transfere, e
 *    transferir e' outra operacao -- com dois donos simultaneos, "ultimo dono"
 *    deixaria de ser uma invariante checavel.
 * 2. **O ultimo dono nao pode ser rebaixado.** A `MembershipList` cuida disso.
 */
export class ChangeMemberRoleUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: ChangeMemberRoleInput): Promise<Either<MemberError, WorkspaceMember>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'member:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    if (input.role === 'OWNER') {
      return left(
        new NotAllowedError('Para tornar alguem dono, use a transferencia de posse.'),
      );
    }

    const members = MembershipList.create(await this.workspaces.listMembers(input.workspaceId));
    const target = members.find(input.targetUserId);

    if (!target) {
      return left(new ResourceNotFoundError('Membro'));
    }

    const previousRole = target.role.value;

    // Um ADMIN nao rebaixa um OWNER: so o proprio dono abre mao da posse.
    if (target.isOwner() && !authorized.value.member.isOwner()) {
      return left(new NotAllowedError('Apenas o dono pode alterar o papel de outro dono.'));
    }

    const changed = members.changeRole(input.targetUserId, input.role);

    if (changed.isLeft()) {
      return left(changed.value);
    }

    await this.workspaces.saveMember(changed.value);

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'MEMBER_ROLE_CHANGED',
      entityType: 'WorkspaceMember',
      entityId: changed.value.id.toValue(),
      metadata: { targetUserId: input.targetUserId.toValue(), from: previousRole, to: input.role },
      ipAddress: input.ipAddress,
    });

    return right(changed.value);
  }
}

export interface RemoveMemberInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  targetUserId: UniqueEntityId;
  ipAddress?: string;
}

/** Remocao de membro por quem gerencia. Sair por conta propria e' outro caso. */
export class RemoveMemberUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: RemoveMemberInput): Promise<Either<MemberError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'member:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    if (input.actorUserId.equals(input.targetUserId)) {
      return left(new NotAllowedError('Para sair do workspace, use a opcao de sair.'));
    }

    const members = MembershipList.create(await this.workspaces.listMembers(input.workspaceId));
    const target = members.find(input.targetUserId);

    if (!target) {
      return left(new ResourceNotFoundError('Membro'));
    }

    if (target.isOwner() && !authorized.value.member.isOwner()) {
      return left(new NotAllowedError('Apenas o dono pode remover outro dono.'));
    }

    const removed = members.remove(input.targetUserId);

    if (removed.isLeft()) {
      return left(removed.value);
    }

    await this.workspaces.removeMember(input.workspaceId, input.targetUserId);

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'MEMBER_REMOVED',
      entityType: 'WorkspaceMember',
      entityId: removed.value.id.toValue(),
      metadata: { targetUserId: input.targetUserId.toValue(), role: removed.value.role.value },
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}

export interface LeaveWorkspaceInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Sair do workspace.
 *
 * Permitido a TODOS os papeis -- menos ao ultimo dono, que precisa transferir a
 * posse antes. E nao vale para o workspace pessoal: sair dele deixaria os
 * proprios dados inacessiveis.
 */
export class LeaveWorkspaceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(
    input: LeaveWorkspaceInput,
  ): Promise<Either<MemberError | PersonalWorkspaceError, void>> {
    const resolved = await this.access.resolve(input.workspaceId, input.actorUserId);

    if (resolved.isLeft()) {
      return left(resolved.value);
    }

    const supportsMembership = resolved.value.workspace.assertSupportsMembership('sair');

    if (supportsMembership.isLeft()) {
      return left(supportsMembership.value);
    }

    const members = MembershipList.create(await this.workspaces.listMembers(input.workspaceId));
    const removed = members.remove(input.actorUserId);

    if (removed.isLeft()) {
      return left(removed.value);
    }

    await this.workspaces.removeMember(input.workspaceId, input.actorUserId);

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'MEMBER_LEFT',
      entityType: 'WorkspaceMember',
      entityId: removed.value.id.toValue(),
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}

export interface TransferOwnershipInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  toUserId: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Transferencia de posse.
 *
 * Promove o novo dono e rebaixa o antigo a ADMIN em UMA transacao. Em dois
 * passos existiria uma janela com zero ou dois donos -- e a invariante do
 * ultimo dono depende de haver exatamente um.
 */
export class TransferOwnershipUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: TransferOwnershipInput): Promise<Either<MemberError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'workspace:transfer-ownership',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    if (input.actorUserId.equals(input.toUserId)) {
      return left(new NotAllowedError('Voce ja e o dono deste workspace.'));
    }

    const members = MembershipList.create(await this.workspaces.listMembers(input.workspaceId));
    const transferred = members.transferOwnership(input.actorUserId, input.toUserId);

    if (transferred.isLeft()) {
      return left(transferred.value);
    }

    const { previousOwner, newOwner } = transferred.value;

    await this.unitOfWork.run(async () => {
      await this.workspaces.saveMember(newOwner);
      await this.workspaces.saveMember(previousOwner);
    });

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'OWNERSHIP_TRANSFERRED',
      entityType: 'Workspace',
      entityId: input.workspaceId.toValue(),
      metadata: { toUserId: input.toUserId.toValue() },
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}

export interface RevokeInvitationInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  invitationId: UniqueEntityId;
  ipAddress?: string;
}

/** Cancelamento de um convite pendente. */
export class RevokeInvitationUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly invitations: InvitationRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: RevokeInvitationInput): Promise<Either<MemberError | Error, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'member:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const invitation = await this.invitations.findById(input.invitationId);

    // Convite de OUTRO workspace nao existe para quem pergunta daqui.
    if (!invitation || !invitation.workspaceId.equals(input.workspaceId)) {
      return left(new ResourceNotFoundError('Convite'));
    }

    const revoked = invitation.revoke();

    if (revoked.isLeft()) {
      return left(revoked.value as unknown as Error);
    }

    await this.invitations.save(invitation);

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'INVITATION_REVOKED',
      entityType: 'Invitation',
      entityId: invitation.id.toValue(),
      ipAddress: input.ipAddress,
    });

    return right(undefined);
  }
}

/** Convite + os nomes que a tela precisa mostrar. */
export interface InvitationWithContext {
  invitation: Invitation;
  workspaceName: string;
  invitedByName: string;
}

/** Convites de um workspace, para a tela de membros. */
export class ListInvitationsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly invitations: InvitationRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(
    workspaceId: UniqueEntityId,
    actorUserId: UniqueEntityId,
  ): Promise<Either<AccessError, InvitationWithContext[]>> {
    const authorized = await this.access.authorize(workspaceId, actorUserId, 'member:manage');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const invitations = await this.invitations.listByWorkspace(workspaceId);
    const inviters = await this.users.findManyByIds(
      invitations.map((invitation) => invitation.invitedByUserId),
    );

    return right(
      invitations.map((invitation) => ({
        invitation,
        workspaceName: authorized.value.workspace.name,
        invitedByName: inviters.get(invitation.invitedByUserId.toValue())?.name ?? 'Alguem',
      })),
    );
  }
}

export interface DeleteWorkspaceInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  ipAddress?: string;
}

/**
 * Exclusao do workspace inteiro. So o OWNER.
 *
 * O pessoal nao pode ser excluido: ele e' a carteira individual da pessoa, e
 * apagar a conta e' outro fluxo.
 */
export class DeleteWorkspaceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: DeleteWorkspaceInput,
  ): Promise<Either<AccessError | PersonalWorkspaceError, void>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'workspace:delete',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const supportsDeletion = authorized.value.workspace.assertSupportsMembership('excluir');

    if (supportsDeletion.isLeft()) {
      return left(supportsDeletion.value);
    }

    // Auditoria ANTES do delete: o cascade leva os registros junto.
    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'WORKSPACE_DELETED',
      entityType: 'Workspace',
      entityId: input.workspaceId.toValue(),
      metadata: { name: authorized.value.workspace.name, at: this.clock.now().toISOString() },
      ipAddress: input.ipAddress,
    });

    await this.workspaces.delete(input.workspaceId);

    return right(undefined);
  }
}
