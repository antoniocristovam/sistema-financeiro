import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { UniqueEntityId } from '../domain/unique-entity-id';
import { type AuthenticatedRequest } from '../guards/jwt-auth.guard';

export interface CurrentUserData {
  id: UniqueEntityId;
  email: string;
}

/**
 * Usuario autenticado, resolvido pelo `JwtAuthGuard`.
 *
 * Lanca se nao houver usuario: isso so acontece se alguem usar o decorator em
 * rota `@Public()`, que e' erro de programacao -- melhor estourar em
 * desenvolvimento do que devolver `undefined` e virar um bug silencioso de
 * autorizacao la na frente.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserData => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new UnauthorizedException('Rota protegida sem usuario resolvido.');
    }

    return { id: new UniqueEntityId(request.user.id), email: request.user.email };
  },
);
