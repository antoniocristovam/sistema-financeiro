import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '../../../config/env';
import { AUDIT_LOGGER, type AuditLogger } from '../../../shared/application/ports/audit-logger';
import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { MAIL_SERVICE, type MailService } from '../../../shared/application/ports/mail-service';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/ports/unit-of-work';
import {
  TOKEN_GENERATOR,
  type TokenGenerator,
} from '../../identity/core/application/ports/token-generator';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/core/domain/repositories/user-repository';
import { PrismaUserRepository } from '../../identity/infra/prisma/repositories/prisma-user-repository';
import { WorkspaceAccessService } from '../core/application/services/workspace-access';
import { AcceptInvitationUseCase } from '../core/application/use-cases/accept-invitation';
import { CreateWorkspaceUseCase } from '../core/application/use-cases/create-workspace';
import { InviteMemberUseCase } from '../core/application/use-cases/invite-member';
import { ListWorkspacesUseCase } from '../core/application/use-cases/list-workspaces';
import {
  ChangeMemberRoleUseCase,
  DeleteWorkspaceUseCase,
  LeaveWorkspaceUseCase,
  ListInvitationsUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
  TransferOwnershipUseCase,
} from '../core/application/use-cases/manage-members';
import {
  INVITATION_REPOSITORY,
  WORKSPACE_REPOSITORY,
  type InvitationRepository,
  type WorkspaceRepository,
} from '../core/domain/repositories/workspace-repository';
import { WorkspaceController } from './http/controllers/workspace.controller';
import {
  PrismaInvitationRepository,
  PrismaWorkspaceRepository,
} from './prisma/repositories/prisma-workspace-repository';

/**
 * Composition root do modulo de workspace.
 *
 * Mesma regra do modulo de identidade: caso de uso e' classe pura, montada
 * aqui por `useFactory`. O `WorkspaceAccessService` tambem -- ele e' aplicacao,
 * nao infraestrutura, e e' por onde TODA autorizacao de workspace passa.
 */
@Module({
  controllers: [WorkspaceController],
  providers: [
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },

    {
      provide: WorkspaceAccessService,
      useFactory: (workspaces: WorkspaceRepository) => new WorkspaceAccessService(workspaces),
      inject: [WORKSPACE_REPOSITORY],
    },

    {
      provide: ListWorkspacesUseCase,
      useFactory: (workspaces: WorkspaceRepository) => new ListWorkspacesUseCase(workspaces),
      inject: [WORKSPACE_REPOSITORY],
    },

    {
      provide: CreateWorkspaceUseCase,
      useFactory: (workspaces: WorkspaceRepository, clock: Clock, unitOfWork: UnitOfWork) =>
        new CreateWorkspaceUseCase(workspaces, clock, unitOfWork),
      inject: [WORKSPACE_REPOSITORY, CLOCK, UNIT_OF_WORK],
    },

    {
      provide: InviteMemberUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        invitations: InvitationRepository,
        users: UserRepository,
        tokens: TokenGenerator,
        mail: MailService,
        audit: AuditLogger,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new InviteMemberUseCase(
          access,
          workspaces,
          invitations,
          users,
          tokens,
          mail,
          audit,
          clock,
          config.get('WEB_URL', { infer: true }),
        ),
      inject: [
        WorkspaceAccessService,
        WORKSPACE_REPOSITORY,
        INVITATION_REPOSITORY,
        USER_REPOSITORY,
        TOKEN_GENERATOR,
        MAIL_SERVICE,
        AUDIT_LOGGER,
        CLOCK,
        ConfigService,
      ],
    },

    {
      provide: AcceptInvitationUseCase,
      useFactory: (
        invitations: InvitationRepository,
        workspaces: WorkspaceRepository,
        users: UserRepository,
        tokens: TokenGenerator,
        audit: AuditLogger,
        clock: Clock,
        unitOfWork: UnitOfWork,
      ) =>
        new AcceptInvitationUseCase(
          invitations,
          workspaces,
          users,
          tokens,
          audit,
          clock,
          unitOfWork,
        ),
      inject: [
        INVITATION_REPOSITORY,
        WORKSPACE_REPOSITORY,
        USER_REPOSITORY,
        TOKEN_GENERATOR,
        AUDIT_LOGGER,
        CLOCK,
        UNIT_OF_WORK,
      ],
    },

    {
      provide: RevokeInvitationUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        invitations: InvitationRepository,
        audit: AuditLogger,
      ) => new RevokeInvitationUseCase(access, invitations, audit),
      inject: [WorkspaceAccessService, INVITATION_REPOSITORY, AUDIT_LOGGER],
    },

    {
      provide: ListInvitationsUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        invitations: InvitationRepository,
        users: UserRepository,
      ) => new ListInvitationsUseCase(access, invitations, users),
      inject: [WorkspaceAccessService, INVITATION_REPOSITORY, USER_REPOSITORY],
    },

    {
      provide: ListMembersUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        users: UserRepository,
      ) => new ListMembersUseCase(access, workspaces, users),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, USER_REPOSITORY],
    },

    {
      provide: ChangeMemberRoleUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        audit: AuditLogger,
      ) => new ChangeMemberRoleUseCase(access, workspaces, audit),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, AUDIT_LOGGER],
    },

    {
      provide: RemoveMemberUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        audit: AuditLogger,
      ) => new RemoveMemberUseCase(access, workspaces, audit),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, AUDIT_LOGGER],
    },

    {
      provide: LeaveWorkspaceUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        audit: AuditLogger,
      ) => new LeaveWorkspaceUseCase(access, workspaces, audit),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, AUDIT_LOGGER],
    },

    {
      provide: TransferOwnershipUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        audit: AuditLogger,
        unitOfWork: UnitOfWork,
      ) => new TransferOwnershipUseCase(access, workspaces, audit, unitOfWork),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, AUDIT_LOGGER, UNIT_OF_WORK],
    },

    {
      provide: DeleteWorkspaceUseCase,
      useFactory: (
        access: WorkspaceAccessService,
        workspaces: WorkspaceRepository,
        audit: AuditLogger,
        clock: Clock,
      ) => new DeleteWorkspaceUseCase(access, workspaces, audit, clock),
      inject: [WorkspaceAccessService, WORKSPACE_REPOSITORY, AUDIT_LOGGER, CLOCK],
    },
  ],
  exports: [WorkspaceAccessService, WORKSPACE_REPOSITORY],
})
export class WorkspaceModule {}
