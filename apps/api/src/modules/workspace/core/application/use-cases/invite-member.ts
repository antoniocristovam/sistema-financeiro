import { type WorkspaceRole } from '@finapp/contracts';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type AuditLogger } from '../../../../../shared/application/ports/audit-logger';
import { type MailService } from '../../../../../shared/application/ports/mail-service';
import { type InvalidValueError } from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { type Either, left, right } from '../../../../../shared/either';
import { buildInvitationEmail } from '../../../../identity/core/application/mail/verification-email';
import { type TokenGenerator } from '../../../../identity/core/application/ports/token-generator';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import { Invitation } from '../../domain/entities/invitation';
import {
  AlreadyMemberError,
  type PersonalWorkspaceError,
} from '../../domain/errors/workspace-errors';
import {
  type InvitationRepository,
  type WorkspaceRepository,
} from '../../domain/repositories/workspace-repository';
import { type AccessError, type WorkspaceAccessService } from '../services/workspace-access';

export interface InviteMemberInput {
  workspaceId: UniqueEntityId;
  actorUserId: UniqueEntityId;
  email: string;
  role: WorkspaceRole;
  ipAddress?: string;
}

export interface InviteMemberOutput {
  invitation: Invitation;
  workspaceName: string;
  invitedByName: string;
}

type InviteMemberError =
  | AccessError
  | InvalidValueError
  | AlreadyMemberError
  | PersonalWorkspaceError;

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: 'dono',
  ADMIN: 'administrador',
  MEMBER: 'membro',
  VIEWER: 'visualizador',
};

/**
 * Convite por e-mail para um workspace compartilhado.
 *
 * Reenviar para o mesmo endereco NAO cria um segundo convite: o pendente e'
 * revogado e um novo e' emitido. Dois convites validos para a mesma pessoa
 * significariam dois tokens vivos, e o antigo continuaria funcionando depois de
 * a pessoa ter usado o novo.
 */
export class InviteMemberUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly workspaces: WorkspaceRepository,
    private readonly invitations: InvitationRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenGenerator,
    private readonly mail: MailService,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
    private readonly webUrl: string,
  ) {}

  async execute(input: InviteMemberInput): Promise<Either<InviteMemberError, InviteMemberOutput>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.actorUserId,
      'member:manage',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const { workspace, member: actor } = authorized.value;

    const supportsMembership = workspace.assertSupportsMembership('convidar membros');

    if (supportsMembership.isLeft()) {
      return left(supportsMembership.value);
    }

    const emailResult = Email.create(input.email);

    if (emailResult.isLeft()) {
      return left(emailResult.value);
    }

    const email = emailResult.value;

    // Ja e' membro? Convidar de novo nao faz nada alem de confundir.
    const existingUser = await this.users.findByEmail(email);

    if (existingUser) {
      const alreadyMember = await this.workspaces.findMember(input.workspaceId, existingUser.id);

      if (alreadyMember) {
        return left(new AlreadyMemberError());
      }
    }

    const pending = await this.invitations.findPendingByEmail(input.workspaceId, email);

    if (pending) {
      pending.revoke();
      await this.invitations.save(pending);
    }

    const now = this.clock.now();
    const opaque = this.tokens.generate();

    const invitation = Invitation.create({
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      tokenHash: opaque.hash,
      invitedByUserId: input.actorUserId,
      createdAt: now,
    });

    await this.invitations.create(invitation);

    const inviter = await this.users.findById(actor.userId);
    const invitedByName = inviter?.name ?? 'Alguem';

    await this.mail.send(
      buildInvitationEmail({
        to: email.value,
        token: opaque.plain,
        webUrl: this.webUrl,
        workspaceName: workspace.name,
        invitedByName,
        roleLabel: ROLE_LABEL[input.role],
      }),
    );

    await this.audit.record({
      workspaceId: input.workspaceId.toValue(),
      actorUserId: input.actorUserId.toValue(),
      action: 'MEMBER_INVITED',
      entityType: 'Invitation',
      entityId: invitation.id.toValue(),
      metadata: { email: email.value, role: input.role },
      ipAddress: input.ipAddress,
    });

    return right({ invitation, workspaceName: workspace.name, invitedByName });
  }
}
