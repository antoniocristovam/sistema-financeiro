import { ApiErrorCode, WORKSPACE_HEADER } from '@finapp/contracts';
import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { UniqueEntityId } from '../domain/unique-entity-id';
import { type AuthenticatedRequest } from '../guards/jwt-auth.guard';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Workspace ativo, lido do header `x-workspace-id`.
 *
 * O decorator so EXTRAI o id -- ele nao confere se o usuario pertence ao
 * workspace. Essa checagem e' do caso de uso (`WorkspaceAccessService`), e e'
 * de proposito: se ficasse aqui, qualquer ponto de entrada que nao passe por
 * HTTP nasceria sem protecao.
 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UniqueEntityId => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers[WORKSPACE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value || !UUID_PATTERN.test(value)) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: `Header ${WORKSPACE_HEADER} ausente ou invalido.`,
      });
    }

    return new UniqueEntityId(value);
  },
);
