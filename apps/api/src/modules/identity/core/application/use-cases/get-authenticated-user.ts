import { ResourceNotFoundError } from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Either, left, right } from '../../../../../shared/either';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { type Workspace } from '../../../../workspace/core/domain/entities/workspace';
import { type FinancialProfile } from '../../domain/entities/financial-profile';
import { type User } from '../../domain/entities/user';
import { type UserRepository } from '../../domain/repositories/user-repository';

export interface GetAuthenticatedUserOutput {
  user: User;
  profile: FinancialProfile | null;
  personalWorkspace: Workspace;
}

/**
 * Dados de quem esta logado, para o boot do app.
 *
 * Devolve tambem o workspace pessoal e o estado do onboarding porque o front
 * precisa dos dois na primeira pintura: sem workspace ativo nao da para montar
 * nenhuma tela, e sem saber do onboarding o app pisca o dashboard antes de
 * redirecionar para o wizard.
 */
export class GetAuthenticatedUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(
    userId: UniqueEntityId,
  ): Promise<Either<ResourceNotFoundError, GetAuthenticatedUserOutput>> {
    const user = await this.users.findById(userId);

    if (!user) {
      return left(new ResourceNotFoundError('Usuario'));
    }

    const memberships = await this.workspaces.listForUser(userId);
    const personal = memberships.find((entry) => entry.workspace.isPersonal());

    if (!personal) {
      // Invariante do cadastro: todo usuario ganha um workspace pessoal. Se
      // sumiu, e' inconsistencia de dados, nao um estado esperado.
      return left(new ResourceNotFoundError('Workspace pessoal'));
    }

    const profile = await this.users.findProfileByUserId(userId);

    return right({ user, profile, personalWorkspace: personal.workspace });
  }
}
