import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '../../../config/env';
import { CLOCK, type Clock } from '../../../shared/application/ports/clock';
import { MAIL_SERVICE, type MailService } from '../../../shared/application/ports/mail-service';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/ports/unit-of-work';
import {
  WORKSPACE_REPOSITORY,
  type WorkspaceRepository,
} from '../../workspace/core/domain/repositories/workspace-repository';
import { PrismaWorkspaceRepository } from '../../workspace/infra/prisma/repositories/prisma-workspace-repository';
import { ENCRYPTER, type Encrypter } from '../core/application/ports/encrypter';
import { HASHER, type Hasher } from '../core/application/ports/hasher';
import {
  TOKEN_GENERATOR,
  type TokenGenerator,
} from '../core/application/ports/token-generator';
import { SessionIssuer } from '../core/application/services/session-issuer';
import { AuthenticateUserUseCase } from '../core/application/use-cases/authenticate-user';
import { ChangePasswordUseCase } from '../core/application/use-cases/change-password';
import { GetAuthenticatedUserUseCase } from '../core/application/use-cases/get-authenticated-user';
import { RefreshSessionUseCase } from '../core/application/use-cases/refresh-session';
import { RegisterUserUseCase } from '../core/application/use-cases/register-user';
import { RequestPasswordResetUseCase } from '../core/application/use-cases/request-password-reset';
import { ResetPasswordUseCase } from '../core/application/use-cases/reset-password';
import { RevokeSessionUseCase } from '../core/application/use-cases/revoke-session';
import { UpdateProfileUseCase } from '../core/application/use-cases/update-profile';
import { VerifyEmailUseCase } from '../core/application/use-cases/verify-email';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../core/domain/repositories/refresh-token-repository';
import { USER_REPOSITORY, type UserRepository } from '../core/domain/repositories/user-repository';
import {
  USER_TOKEN_REPOSITORY,
  type UserTokenRepository,
} from '../core/domain/repositories/user-token-repository';
import { parseDuration } from '../../../shared/cryptography/jwt-encrypter';
import { AuthController } from './http/controllers/auth.controller';
import {
  PrismaRefreshTokenRepository,
  PrismaUserTokenRepository,
} from './prisma/repositories/prisma-token-repositories';
import { PrismaUserRepository } from './prisma/repositories/prisma-user-repository';

/**
 * Composition root do modulo de identidade.
 *
 * Os casos de uso sao classes PURAS -- sem `@Injectable`, sem decorator nenhum.
 * Quem monta as dependencias e' o `useFactory` daqui, o que faz do container do
 * Nest o composition root sem que o framework contamine o dominio. Um caso de
 * uso pode ser instanciado a mao em um teste, em um script ou em um job, e
 * funciona igual.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
    { provide: USER_TOKEN_REPOSITORY, useClass: PrismaUserTokenRepository },
    { provide: WORKSPACE_REPOSITORY, useClass: PrismaWorkspaceRepository },

    {
      provide: SessionIssuer,
      useFactory: (
        refreshTokens: RefreshTokenRepository,
        encrypter: Encrypter,
        tokens: TokenGenerator,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new SessionIssuer(
          refreshTokens,
          encrypter,
          tokens,
          clock,
          parseDuration(config.get('JWT_REFRESH_TTL', { infer: true })),
        ),
      inject: [REFRESH_TOKEN_REPOSITORY, ENCRYPTER, TOKEN_GENERATOR, CLOCK, ConfigService],
    },

    {
      provide: RegisterUserUseCase,
      useFactory: (
        users: UserRepository,
        workspaces: WorkspaceRepository,
        userTokens: UserTokenRepository,
        hasher: Hasher,
        tokens: TokenGenerator,
        mail: MailService,
        clock: Clock,
        unitOfWork: UnitOfWork,
        config: ConfigService<Env, true>,
      ) =>
        new RegisterUserUseCase(
          users,
          workspaces,
          userTokens,
          hasher,
          tokens,
          mail,
          clock,
          unitOfWork,
          config.get('WEB_URL', { infer: true }),
        ),
      inject: [
        USER_REPOSITORY,
        WORKSPACE_REPOSITORY,
        USER_TOKEN_REPOSITORY,
        HASHER,
        TOKEN_GENERATOR,
        MAIL_SERVICE,
        CLOCK,
        UNIT_OF_WORK,
        ConfigService,
      ],
    },

    {
      provide: AuthenticateUserUseCase,
      useFactory: (users: UserRepository, hasher: Hasher, sessions: SessionIssuer) =>
        new AuthenticateUserUseCase(users, hasher, sessions),
      inject: [USER_REPOSITORY, HASHER, SessionIssuer],
    },

    {
      provide: RefreshSessionUseCase,
      useFactory: (
        refreshTokens: RefreshTokenRepository,
        users: UserRepository,
        tokens: TokenGenerator,
        sessions: SessionIssuer,
        clock: Clock,
      ) => new RefreshSessionUseCase(refreshTokens, users, tokens, sessions, clock),
      inject: [REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY, TOKEN_GENERATOR, SessionIssuer, CLOCK],
    },

    {
      provide: RevokeSessionUseCase,
      useFactory: (
        refreshTokens: RefreshTokenRepository,
        tokens: TokenGenerator,
        clock: Clock,
      ) => new RevokeSessionUseCase(refreshTokens, tokens, clock),
      inject: [REFRESH_TOKEN_REPOSITORY, TOKEN_GENERATOR, CLOCK],
    },

    {
      provide: VerifyEmailUseCase,
      useFactory: (
        userTokens: UserTokenRepository,
        users: UserRepository,
        tokens: TokenGenerator,
        clock: Clock,
      ) => new VerifyEmailUseCase(userTokens, users, tokens, clock),
      inject: [USER_TOKEN_REPOSITORY, USER_REPOSITORY, TOKEN_GENERATOR, CLOCK],
    },

    {
      provide: RequestPasswordResetUseCase,
      useFactory: (
        users: UserRepository,
        userTokens: UserTokenRepository,
        tokens: TokenGenerator,
        mail: MailService,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new RequestPasswordResetUseCase(
          users,
          userTokens,
          tokens,
          mail,
          clock,
          config.get('WEB_URL', { infer: true }),
        ),
      inject: [
        USER_REPOSITORY,
        USER_TOKEN_REPOSITORY,
        TOKEN_GENERATOR,
        MAIL_SERVICE,
        CLOCK,
        ConfigService,
      ],
    },

    {
      provide: ResetPasswordUseCase,
      useFactory: (
        userTokens: UserTokenRepository,
        users: UserRepository,
        refreshTokens: RefreshTokenRepository,
        hasher: Hasher,
        tokens: TokenGenerator,
        clock: Clock,
      ) => new ResetPasswordUseCase(userTokens, users, refreshTokens, hasher, tokens, clock),
      inject: [
        USER_TOKEN_REPOSITORY,
        USER_REPOSITORY,
        REFRESH_TOKEN_REPOSITORY,
        HASHER,
        TOKEN_GENERATOR,
        CLOCK,
      ],
    },

    {
      provide: ChangePasswordUseCase,
      useFactory: (
        users: UserRepository,
        refreshTokens: RefreshTokenRepository,
        hasher: Hasher,
        sessions: SessionIssuer,
        clock: Clock,
      ) => new ChangePasswordUseCase(users, refreshTokens, hasher, sessions, clock),
      inject: [USER_REPOSITORY, REFRESH_TOKEN_REPOSITORY, HASHER, SessionIssuer, CLOCK],
    },

    {
      provide: GetAuthenticatedUserUseCase,
      useFactory: (users: UserRepository, workspaces: WorkspaceRepository) =>
        new GetAuthenticatedUserUseCase(users, workspaces),
      inject: [USER_REPOSITORY, WORKSPACE_REPOSITORY],
    },

    {
      provide: UpdateProfileUseCase,
      useFactory: (users: UserRepository) => new UpdateProfileUseCase(users),
      inject: [USER_REPOSITORY],
    },
  ],
  exports: [USER_REPOSITORY, WORKSPACE_REPOSITORY],
})
export class IdentityModule {}
