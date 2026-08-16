import { WorkspaceType } from '@finapp/contracts';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, right } from '../../../../../shared/either';
import { Workspace } from '../../domain/entities/workspace';
import { WorkspaceMember } from '../../domain/entities/workspace-member';
import { type WorkspaceRepository } from '../../domain/repositories/workspace-repository';
import { Role } from '../../domain/value-objects/role';

export interface CreateWorkspaceInput {
  userId: UniqueEntityId;
  name: string;
  baseCurrency: string;
}

/**
 * Criacao de workspace COMPARTILHADO.
 *
 * O pessoal nasce no cadastro e nao passa por aqui. Quem cria vira OWNER na
 * mesma transacao -- um workspace sem dono ja nasceria orfao, sem ninguem que
 * possa convidar membro ou exclui-lo.
 */
export class CreateWorkspaceUseCase {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreateWorkspaceInput): Promise<Either<never, Workspace>> {
    const now = this.clock.now();

    const workspace = Workspace.create({
      name: input.name.trim(),
      type: WorkspaceType.SHARED,
      baseCurrency: input.baseCurrency,
      createdAt: now,
      updatedAt: now,
    });

    const owner = WorkspaceMember.create({
      workspaceId: workspace.id,
      userId: input.userId,
      role: Role.owner(),
      joinedAt: now,
    });

    await this.unitOfWork.run(async () => {
      await this.workspaces.create(workspace, owner);
    });

    return right(workspace);
  }
}
