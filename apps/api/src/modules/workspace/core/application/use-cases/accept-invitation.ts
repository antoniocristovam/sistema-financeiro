import { type Clock } from '../../../../../shared/application/ports/clock';
import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type TokenGenerator } from '../../../../identity/core/application/ports/token-generator';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { type Workspace } from '../../domain/entities/workspace';
import { WorkspaceMember } from '../../domain/entities/workspace-member';
import {
  AlreadyMemberError,
  type InvitationEmailMismatchError,
  type InvitationExpiredError,
  type InvitationNotPendingError,
} from '../../domain/errors/workspace-errors';
import {
  type InvitationRepository,
  type WorkspaceRepository,
} from '../../domain/repositories/workspace-repository';
import { Role } from '../../domain/value-objects/role';

export interface AcceptInvitationInput {
  token: string;
  userId: UniqueEntityId;
  ipAddress?: string;
}

type AcceptInvitationError =
  | ResourceNotFoundError
  | InvitationNotPendingError
  | InvitationExpiredError
  | InvitationEmailMismatchError
  | AlreadyMemberError;

/**
 * Aceite de convite.
 *
 * Quem aceita precisa ser o dono do e-mail convidado -- a checagem esta na
 * entidade `Invitation`. Um token vazado nao pode virar acesso para qualquer
 * conta logada.
 *
 * A validade tambem e' conferida aqui, no aceite, e nao por um job de limpeza:
 * job criaria uma janela em que o convite vencido ainda funciona.
 */
export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenGenerator,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: AcceptInvitationInput): Promise<Either<AcceptInvitationError, Workspace>> {
    const invitation = await this.invitations.findByHash(this.tokens.hashOf(input.token));

    if (!invitation) {
      return left(new ResourceNotFoundError('Convite'));
    }

    const user = await this.users.findById(input.userId);

    if (!user) {
      return left(new ResourceNotFoundError('Usuario'));
    }

    const now = this.clock.now();
    const accepted = invitation.accept(user.email, now);

    if (accepted.isLeft()) {
      // O aceite pode ter marcado o convite como EXPIRED: persiste isso.
      await this.invitations.save(invitation);
      return left(accepted.value);
    }

    const workspace = await this.workspaces.findById(invitation.workspaceId);

    if (!workspace) {
      return left(new ResourceNotFoundError('Workspace'));
    }

    const existing = await this.workspaces.findMember(workspace.id, user.id);

    if (existing) {
      return left(new AlreadyMemberError());
    }

    const member = WorkspaceMember.create({
      workspaceId: workspace.id,
      userId: user.id,
      role: Role.create(invitation.role),
      joinedAt: now,
    });

    await this.unitOfWork.run(async () => {
      await this.workspaces.addMember(member);
      await this.invitations.save(invitation);
    });

    await this.audit.record({
      workspaceId: workspace.id.toValue(),
      actorUserId: user.id.toValue(),
      action: 'MEMBER_JOINED',
      entityType: 'WorkspaceMember',
      entityId: member.id.toValue(),
      metadata: { role: invitation.role },
      ipAddress: input.ipAddress,
    });

    return right(workspace);
  }
}
