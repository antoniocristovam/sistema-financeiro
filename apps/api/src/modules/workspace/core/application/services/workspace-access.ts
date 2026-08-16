import { type WorkspacePermission } from '@finapp/contracts';

import {
  InsufficientRoleError,
  NotWorkspaceMemberError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type Workspace } from '../../domain/entities/workspace';
import { type WorkspaceMember } from '../../domain/entities/workspace-member';
import { type WorkspaceRepository } from '../../domain/repositories/workspace-repository';

export interface AuthorizedAccess {
  workspace: Workspace;
  member: WorkspaceMember;
}

export type AccessError = NotWorkspaceMemberError | InsufficientRoleError | ResourceNotFoundError;

/** Rotulo humano da permissao, para a mensagem de erro fazer sentido. */
const ACTION_LABEL: Record<WorkspacePermission, string> = {
  'data:read': 'ver estes dados',
  'transaction:write': 'criar ou editar lancamentos',
  'account:manage': 'gerenciar contas e categorias',
  'category:manage': 'gerenciar categorias',
  'member:manage': 'gerenciar membros',
  'workspace:delete': 'excluir o workspace',
  'workspace:transfer-ownership': 'transferir a posse',
};

/**
 * Resolucao de acesso a um workspace.
 *
 * Todo caso de uso escopado comeca por aqui. O guard HTTP resolve QUEM esta
 * pedindo; esta classe resolve SE aquele papel pode fazer aquilo -- e ela vive
 * na camada de aplicacao justamente para que job, CLI e webhook passem pela
 * mesma checagem. Se a decisao morasse no controller, todo ponto de entrada
 * novo nasceria sem protecao.
 *
 * A distincao entre "nao encontrado" e "sem acesso" e' deliberada: para quem
 * nao e' membro, o workspace responde NOT_WORKSPACE_MEMBER e nao 404 -- o 404
 * revelaria, por eliminacao, quais ids existem.
 */
export class WorkspaceAccessService {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async authorize(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
    permission: WorkspacePermission,
  ): Promise<Either<AccessError, AuthorizedAccess>> {
    const membership = await this.resolve(workspaceId, userId);

    if (membership.isLeft()) {
      return left(membership.value);
    }

    if (!membership.value.member.can(permission)) {
      return left(new InsufficientRoleError(ACTION_LABEL[permission]));
    }

    return right(membership.value);
  }

  /** So a associacao, sem checar permissao. Para quando o caso de uso decide. */
  async resolve(
    workspaceId: UniqueEntityId,
    userId: UniqueEntityId,
  ): Promise<Either<AccessError, AuthorizedAccess>> {
    const member = await this.workspaces.findMember(workspaceId, userId);

    if (!member) {
      return left(new NotWorkspaceMemberError());
    }

    const workspace = await this.workspaces.findById(workspaceId);

    if (!workspace) {
      return left(new ResourceNotFoundError('Workspace'));
    }

    return right({ workspace, member });
  }
}
