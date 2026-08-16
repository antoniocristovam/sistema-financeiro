import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  updateProfileBodySchema,
  verifyEmailBodySchema,
  type AuthenticatedUser,
  type Session,
} from '@finapp/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { type Request, type Response } from 'express';

import { type Env } from '../../../../../config/env';
import { CurrentUser, type CurrentUserData } from '../../../../../shared/decorators/current-user.decorator';
import { Public } from '../../../../../shared/decorators/public.decorator';
import { DomainHttpException } from '../../../../../shared/filters/domain-exception.filter';
import {
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from '../../../../../shared/http/refresh-cookie';
import { ZodValidationPipe } from '../../../../../shared/pipes/zod-validation.pipe';
import { type IssuedSession } from '../../../core/application/services/session-issuer';
import { AuthenticateUserUseCase } from '../../../core/application/use-cases/authenticate-user';
import { ChangePasswordUseCase } from '../../../core/application/use-cases/change-password';
import { GetAuthenticatedUserUseCase } from '../../../core/application/use-cases/get-authenticated-user';
import { RefreshSessionUseCase } from '../../../core/application/use-cases/refresh-session';
import { RegisterUserUseCase } from '../../../core/application/use-cases/register-user';
import { RequestPasswordResetUseCase } from '../../../core/application/use-cases/request-password-reset';
import { ResetPasswordUseCase } from '../../../core/application/use-cases/reset-password';
import { RevokeSessionUseCase } from '../../../core/application/use-cases/revoke-session';
import { UpdateProfileUseCase } from '../../../core/application/use-cases/update-profile';
import { VerifyEmailUseCase } from '../../../core/application/use-cases/verify-email';
import { UserPresenter } from '../presenters/user-presenter';

/**
 * Rotas de autenticacao.
 *
 * O controller so faz tres coisas: validar a entrada com o schema do contrato,
 * chamar o caso de uso e traduzir o `Either` em resposta HTTP. Nenhuma regra de
 * negocio mora aqui -- nem autorizacao, que fica no caso de uso.
 *
 * Rate limit em TODAS as rotas de entrada. Sem ele, o login vira um oraculo de
 * forca bruta e o "esqueci a senha" vira uma maquina de spam com o nosso
 * dominio no remetente.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly authenticateUser: AuthenticateUserUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly verifyEmailUseCase: VerifyEmailUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly getAuthenticatedUser: GetAuthenticatedUserUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    const input = body as { name: string; email: string; password: string };
    const result = await this.registerUser.execute(input);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    // Cadastro ja entra logado: mandar para o login logo depois de criar a
    // conta e' friccao sem ganho de seguranca.
    const login = await this.authenticateUser.execute({
      email: input.email,
      password: input.password,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    });

    if (login.isLeft()) {
      throw new DomainHttpException(login.value);
    }

    this.attachRefreshCookie(response, login.value.session);
    response.status(HttpStatus.CREATED);

    return {
      user: UserPresenter.toHttp(result.value.user, null, result.value.personalWorkspace),
      tokens: toTokens(login.value.session),
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginBodySchema)) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    const input = body as { email: string; password: string };

    const result = await this.authenticateUser.execute({
      ...input,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    this.attachRefreshCookie(response, result.value.session);

    const profile = await this.getAuthenticatedUser.execute(result.value.user.id);

    if (profile.isLeft()) {
      throw new DomainHttpException(profile.value);
    }

    return {
      user: UserPresenter.toHttp(
        profile.value.user,
        profile.value.profile,
        profile.value.personalWorkspace,
      ),
      tokens: toTokens(result.value.session),
    };
  }

  /**
   * Renovacao de sessao.
   *
   * O refresh token vem do COOKIE, nunca do corpo: no corpo ele precisaria
   * passar pelo JavaScript da pagina, que e' exatamente o que o `httpOnly`
   * evita.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session> {
    const token = readRefreshCookie(request);

    const result = await this.refreshSession.execute({
      refreshToken: token ?? '',
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    });

    if (result.isLeft()) {
      // Sessao morta: limpa o cookie para o cliente parar de tentar.
      this.clearRefresh(response);
      throw new DomainHttpException(result.value);
    }

    this.attachRefreshCookie(response, result.value.session);

    const profile = await this.getAuthenticatedUser.execute(result.value.user.id);

    if (profile.isLeft()) {
      throw new DomainHttpException(profile.value);
    }

    return {
      user: UserPresenter.toHttp(
        profile.value.user,
        profile.value.profile,
        profile.value.personalWorkspace,
      ),
      tokens: toTokens(result.value.session),
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.revokeSession.execute({ refreshToken: readRefreshCookie(request) });
    this.clearRefresh(response);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailBodySchema)) body: unknown,
  ): Promise<void> {
    const result = await this.verifyEmailUseCase.execute(body as { token: string });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }
  }

  /** Sempre 204, exista o e-mail ou nao. Ver o caso de uso. */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordBodySchema)) body: unknown,
  ): Promise<void> {
    await this.requestPasswordReset.execute(body as { email: string });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordBodySchema)) body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const input = body as { token: string; password: string };
    const result = await this.resetPasswordUseCase.execute(input);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    // Todas as sessoes cairam, inclusive a de quem esta neste navegador.
    this.clearRefresh(response);
  }

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const input = body as { currentPassword: string; password: string };

    const result = await this.changePasswordUseCase.execute({
      userId: user.id,
      currentPassword: input.currentPassword,
      password: input.password,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    });

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    this.attachRefreshCookie(response, result.value);

    return toTokens(result.value);
  }

  @Get('me')
  async me(@CurrentUser() user: CurrentUserData): Promise<AuthenticatedUser> {
    const result = await this.getAuthenticatedUser.execute(user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return UserPresenter.toHttp(
      result.value.user,
      result.value.profile,
      result.value.personalWorkspace,
    );
  }

  @Patch('me')
  async updateMe(
    @Body(new ZodValidationPipe(updateProfileBodySchema)) body: unknown,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AuthenticatedUser> {
    const updated = await this.updateProfile.execute({
      userId: user.id,
      ...(body as Record<string, never>),
    });

    if (updated.isLeft()) {
      throw new DomainHttpException(updated.value);
    }

    const result = await this.getAuthenticatedUser.execute(user.id);

    if (result.isLeft()) {
      throw new DomainHttpException(result.value);
    }

    return UserPresenter.toHttp(
      result.value.user,
      result.value.profile,
      result.value.personalWorkspace,
    );
  }

  private attachRefreshCookie(response: Response, session: IssuedSession): void {
    setRefreshCookie(
      response,
      session.refreshToken,
      session.refreshTokenExpiresAt,
      this.config.get('COOKIE_DOMAIN', { infer: true }),
      this.config.get('NODE_ENV', { infer: true }) === 'production',
    );
  }

  private clearRefresh(response: Response): void {
    clearRefreshCookie(
      response,
      this.config.get('COOKIE_DOMAIN', { infer: true }),
      this.config.get('NODE_ENV', { infer: true }) === 'production',
    );
  }
}

/** So o access token vai no corpo. O refresh fica no cookie httpOnly. */
function toTokens(session: IssuedSession): { accessToken: string; expiresIn: number } {
  return { accessToken: session.accessToken, expiresIn: session.expiresIn };
}

function readRefreshCookie(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;

  return cookies?.[REFRESH_COOKIE_NAME];
}
