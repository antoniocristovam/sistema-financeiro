import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, right } from '../../../../../shared/either';
import {
  type WorkspaceRepository,
  type WorkspaceWithRole,
} from '../../domain/repositories/workspace-repository';

/**
 * Workspaces do usuario, com o papel dele em cada um.
 *
 * Alimenta o seletor no topo da sidebar. O papel vem junto para a UI conseguir
 * esconder o que aquele papel nao pode fazer -- ergonomia, nao seguranca: a
 * barreira continua sendo a checagem no caso de uso.
 */
export class ListWorkspacesUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(userId: UniqueEntityId): Promise<Either<never, WorkspaceWithRole[]>> {
    const entries = await this.workspaces.listForUser(userId);

    // Pessoal primeiro, depois os compartilhados por nome.
    const sorted = [...entries].sort((a, b) => {
      if (a.workspace.isPersonal() !== b.workspace.isPersonal()) {
        return a.workspace.isPersonal() ? -1 : 1;
      }

      return a.workspace.name.localeCompare(b.workspace.name, 'pt-BR');
    });

    return right(sorted);
  }
}
