import {
  acceptInvitationBodySchema,
  changeMemberRoleBodySchema,
  createWorkspaceBodySchema,
  inviteMemberBodySchema,
  transferOwnershipBodySchema,
  type Invitation as InvitationContract,
  type Workspace as WorkspaceContract,
  type WorkspaceMember as MemberContract,
  type WorkspaceRole,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { type Request } from 'express';

import {
  CurrentUser,
  type CurrentUserData,
} from '../../../../../shared/decorators/current-user.decorator';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { DomainHttpException } from '../../../../../shared/filters/domain-exception.filter';
import { ZodValidationPipe } from '../../../../../shared/pipes/zod-validation.pipe';
import { AcceptInvitationUseCase } from '../../../core/application/use-cases/accept-invitation';
import { CreateWorkspaceUseCase } from '../../../core/application/use-cases/create-workspace';
import { InviteMemberUseCase } from '../../../core/application/use-cases/invite-member';
import { ListWorkspacesUseCase } from '../../../core/application/use-cases/list-workspaces';
import {
  ChangeMemberRoleUseCase,
  DeleteWorkspaceUseCase,
  LeaveWorkspaceUseCase,
  ListInvitationsUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
  TransferOwnershipUseCase,
} from '../../../core/application/use-cases/manage-members';
import {
  InvitationPresenter,
  WorkspaceMemberPresenter,
  WorkspacePresenter,
} from '../presenters/workspace-presenter';

/**
 * Rotas de workspace, membros e convites.
 *
 * O workspace vem no PATH e nao no header `x-workspace-id`: estas rotas sao
 * sobre um workspace especifico, nao sobre dados dentro do workspace ativo. O
 * header e' para as rotas escopadas das proximas fases.
 *
 * Nenhuma checagem de papel aqui: quem decide e' o caso de uso.
 */
@Controller()
export class WorkspaceController {
  constructor(
    private readonly listWorkspaces: ListWorkspacesUseCase,
    private readonly createWorkspace: CreateWorkspaceUseCase,
    private readonly inviteMember: InviteMemberUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly listInvitations: ListInvitationsUseCase,
    private readonly listMembers: ListMembersUseCase,
    private readonly changeMemberRole: ChangeMemberRoleUseCase,
    private readonly removeMember: RemoveMemberUseCase,
    private readonly leaveWorkspace: LeaveWorkspaceUseCase,
    private readonly transferOwnership: TransferOwnershipUseCase,
    private readonly deleteWorkspace: DeleteWorkspaceUseCase,
  ) {}

  @Get('workspaces')
  async list(@CurrentUser() user: CurrentUserData): Promise<WorkspaceContract[]> {
    const result = await this.listWorkspaces.execute(user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value.map(WorkspacePresenter.toHttp);
  }

  @Post('workspaces')
  async create(
    @Body(new ZodValidationPipe(createWorkspaceBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
  ): Promise<WorkspaceContract> {
    const input = body as { name: string; baseCurrency: string };
    const result = await this.createWorkspace.execute({ userId: user.id, ...input });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    const workspaces = await this.listWorkspaces.execute(user.id);

    if (workspaces.isLeft()) {
      throw new DomainHttpException(workspaces.value);
    }

    const created = workspaces.value.find((entry) => entry.workspace.id.equals(result.value.id));

    return WorkspacePresenter.toHttp(created!);
  }

  @Delete('workspaces/:workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.deleteWorkspace.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Get('workspaces/:workspaceId/members')
  async members(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<MemberContract[]> {
    const result = await this.listMembers.execute(new UniqueEntityId(workspaceId), user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value.map((entry) =>
      WorkspaceMemberPresenter.toHttp(entry.member, { name: entry.name, email: entry.email }),
    );
  }

  @Patch('workspaces/:workspaceId/members/:userId')
  async changeRole(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body(new ZodValidationPipe(changeMemberRoleBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<{ role: WorkspaceRole }> {
    const result = await this.changeMemberRole.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      targetUserId: new UniqueEntityId(targetUserId),
      role: (body as { role: WorkspaceRole }).role,
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { role: result.value.role.value };
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async kick(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.removeMember.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      targetUserId: new UniqueEntityId(targetUserId),
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('workspaces/:workspaceId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.leaveWorkspace.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Post('workspaces/:workspaceId/transfer-ownership')
  @HttpCode(HttpStatus.NO_CONTENT)
  async transfer(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body(new ZodValidationPipe(transferOwnershipBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.transferOwnership.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      toUserId: new UniqueEntityId((body as { toUserId: string }).toUserId),
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  @Get('workspaces/:workspaceId/invitations')
  async invitations(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<InvitationContract[]> {
    const result = await this.listInvitations.execute(new UniqueEntityId(workspaceId), user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return result.value.map((entry) =>
      InvitationPresenter.toHttp(entry.invitation, entry.workspaceName, entry.invitedByName),
    );
  }

  @Post('workspaces/:workspaceId/invitations')
  async invite(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body(new ZodValidationPipe(inviteMemberBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<InvitationContract> {
    const input = body as { email: string; role: WorkspaceRole };

    const result = await this.inviteMember.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      email: input.email,
      role: input.role,
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return InvitationPresenter.toHttp(
      result.value.invitation,
      result.value.workspaceName,
      result.value.invitedByName,
    );
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelInvitation(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<void> {
    const result = await this.revokeInvitation.execute({
      workspaceId: new UniqueEntityId(workspaceId),
      actorUserId: user.id,
      invitationId: new UniqueEntityId(invitationId),
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value as never);
    }
  }

  /**
   * Aceite de convite.
   *
   * Exige estar logado: o aceite amarra o convite a uma CONTA, e o e-mail
   * precisa bater com o do convite.
   */
  @Post('invitations/accept')
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
  ): Promise<{ workspaceId: string; name: string }> {
    const result = await this.acceptInvitation.execute({
      token: (body as { token: string }).token,
      userId: user.id,
      ipAddress: request.ip,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return { workspaceId: result.value.id.toValue(), name: result.value.name };
  }
}
