import { ApiErrorCode } from '@finapp/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { ENCRYPTER, type Encrypter } from '../../modules/identity/core/application/ports/encrypter';
import { Inject } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Identidade resolvida pelo guard e anexada a requisicao. */
export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
  workspaceId?: string;
}

/**
 * Autenticacao por access token no header `Authorization: Bearer`.
 *
 * O guard resolve QUEM esta pedindo -- so isso. Ele nao decide o que a pessoa
 * pode fazer: essa decisao mora no caso de uso, para que job, CLI e webhook
 * passem pela mesma regra.
 *
 * Global por padrao; rotas de entrada (login, cadastro) se marcam com
 * `@Public()`. Assim uma rota nova nasce PROTEGIDA -- esquecer o decorator
 * fecha a porta em vez de abri-la.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ENCRYPTER) private readonly encrypter: Encrypter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException({
        code: ApiErrorCode.UNAUTHENTICATED,
        message: 'Faca login para continuar.',
      });
    }

    const payload = await this.encrypter.decrypt(token);

    if (!payload) {
      throw new UnauthorizedException({
        code: ApiErrorCode.TOKEN_EXPIRED,
        message: 'Sessao expirada. Entre novamente.',
      });
    }

    request.user = { id: payload.sub, email: payload.email };

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
