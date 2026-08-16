import { beforeEach, describe, expect, it } from 'vitest';

import { Email } from '@/shared/domain/value-objects/email';
import { AuthenticateUserUseCase } from '@/modules/identity/core/application/use-cases/authenticate-user';
import { ChangePasswordUseCase } from '@/modules/identity/core/application/use-cases/change-password';
import { RefreshSessionUseCase } from '@/modules/identity/core/application/use-cases/refresh-session';
import {
  EmailAlreadyUsedError,
  RegisterUserUseCase,
} from '@/modules/identity/core/application/use-cases/register-user';
import { RequestPasswordResetUseCase } from '@/modules/identity/core/application/use-cases/request-password-reset';
import { ResetPasswordUseCase } from '@/modules/identity/core/application/use-cases/reset-password';
import { RevokeSessionUseCase } from '@/modules/identity/core/application/use-cases/revoke-session';
import { VerifyEmailUseCase } from '@/modules/identity/core/application/use-cases/verify-email';
import { SessionIssuer } from '@/modules/identity/core/application/services/session-issuer';
import { UserToken } from '@/modules/identity/core/domain/entities/user-token';

import {
  FakeClock,
  FakeEncrypter,
  FakeHasher,
  FakeMailService,
  FakeTokenGenerator,
  FakeUnitOfWork,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  InMemoryUserTokenRepository,
  InMemoryWorkspaceRepository,
} from '../doubles/in-memory-repositories';

const WEB_URL = 'http://localhost:5173';
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 dias em segundos

function setup() {
  const users = new InMemoryUserRepository();
  const workspaces = new InMemoryWorkspaceRepository();
  const userTokens = new InMemoryUserTokenRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const hasher = new FakeHasher();
  const encrypter = new FakeEncrypter();
  const tokens = new FakeTokenGenerator();
  const mail = new FakeMailService();
  const clock = new FakeClock();
  const unitOfWork = new FakeUnitOfWork();

  const sessions = new SessionIssuer(refreshTokens, encrypter, tokens, clock, REFRESH_TTL);

  return {
    users,
    workspaces,
    userTokens,
    refreshTokens,
    hasher,
    tokens,
    mail,
    clock,
    unitOfWork,
    sessions,
    register: new RegisterUserUseCase(
      users,
      workspaces,
      userTokens,
      hasher,
      tokens,
      mail,
      clock,
      unitOfWork,
      WEB_URL,
    ),
    authenticate: new AuthenticateUserUseCase(users, hasher, sessions),
    refresh: new RefreshSessionUseCase(refreshTokens, users, tokens, sessions, clock),
    revoke: new RevokeSessionUseCase(refreshTokens, tokens, clock),
    verifyEmail: new VerifyEmailUseCase(userTokens, users, tokens, clock),
    requestReset: new RequestPasswordResetUseCase(users, userTokens, tokens, mail, clock, WEB_URL),
    resetPassword: new ResetPasswordUseCase(
      userTokens,
      users,
      refreshTokens,
      hasher,
      tokens,
      clock,
    ),
    changePassword: new ChangePasswordUseCase(users, refreshTokens, hasher, sessions, clock),
  };
}

type Context = ReturnType<typeof setup>;

async function registerAna(context: Context) {
  const result = await context.register.execute({
    name: 'Ana Ribeiro',
    email: 'ana@finapp.local',
    password: 'Finapp@123',
  });

  if (result.isLeft()) {
    throw new Error('cadastro deveria ter funcionado');
  }

  return result.value;
}

describe('RegisterUserUseCase', () => {
  let context: Context;

  beforeEach(() => {
    context = setup();
  });

  it('cria usuario, workspace pessoal, associacao de dono e perfil', async () => {
    const { user, personalWorkspace } = await registerAna(context);

    expect(context.users.items).toHaveLength(1);
    expect(context.users.profiles).toHaveLength(1);
    expect(context.workspaces.items).toHaveLength(1);
    expect(context.workspaces.members).toHaveLength(1);

    expect(personalWorkspace.isPersonal()).toBe(true);
    expect(context.workspaces.members[0]?.role.value).toBe('OWNER');
    expect(context.workspaces.members[0]?.userId.equals(user.id)).toBe(true);
  });

  it('cria tudo dentro de UMA transacao', async () => {
    // Usuario sem workspace nao consegue fazer nada; workspace sem dono e orfao.
    await registerAna(context);

    expect(context.unitOfWork.calls).toBe(1);
  });

  it('nunca guarda a senha em claro', async () => {
    const { user } = await registerAna(context);

    expect(user.passwordHash).not.toContain('Finapp@123');
    expect(user.passwordHash).toBe(context.hasher.digest('Finapp@123'));
  });

  it('normaliza o e-mail', async () => {
    await context.register.execute({
      name: 'Ana',
      email: '  ANA@Finapp.Local ',
      password: 'Finapp@123',
    });

    expect(context.users.items[0]?.email.value).toBe('ana@finapp.local');
  });

  it('recusa e-mail ja usado', async () => {
    await registerAna(context);

    const result = await context.register.execute({
      name: 'Outra Ana',
      email: 'ANA@finapp.local',
      password: 'Outra@123',
    });

    expect(result.isLeft() && result.value).toBeInstanceOf(EmailAlreadyUsedError);
    expect(context.users.items).toHaveLength(1);
  });

  it('envia o e-mail de verificacao com um token de 24h', async () => {
    await registerAna(context);

    const mail = context.mail.lastTo('ana@finapp.local');

    expect(mail?.subject).toContain('Confirme');
    expect(mail?.html).toContain('/verificar-email?token=');
    expect(context.userTokens.items[0]?.type).toBe('EMAIL_VERIFICATION');
    expect(context.userTokens.items[0]?.expiresAt.toISOString()).toBe('2026-03-16T12:00:00.000Z');
  });

  it('o e-mail comeca NAO verificado', async () => {
    const { user } = await registerAna(context);

    expect(user.isEmailVerified()).toBe(false);
  });
});

describe('AuthenticateUserUseCase', () => {
  let context: Context;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);
  });

  it('autentica com credenciais corretas', async () => {
    const result = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });

    expect(result.isRight()).toBe(true);
    expect(result.isRight() && result.value.session.accessToken).toBeTruthy();
    expect(result.isRight() && result.value.session.refreshToken).toBeTruthy();
  });

  it('devolve a MESMA mensagem para e-mail inexistente e senha errada', async () => {
    // Diferenciar transformaria o login em um verificador de cadastro.
    const semConta = await context.authenticate.execute({
      email: 'ninguem@finapp.local',
      password: 'Finapp@123',
    });

    const senhaErrada = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'Errada@123',
    });

    expect(semConta.isLeft()).toBe(true);
    expect(senhaErrada.isLeft()).toBe(true);
    expect(semConta.isLeft() && semConta.value.message).toBe(
      senhaErrada.isLeft() ? senhaErrada.value.message : '',
    );
    expect(semConta.isLeft() && semConta.value.code).toBe('INVALID_CREDENTIALS');
  });

  it('recusa e-mail malformado sem vazar que o formato era o problema', async () => {
    const result = await context.authenticate.execute({
      email: 'nao-e-email',
      password: 'Finapp@123',
    });

    expect(result.isLeft() && result.value.code).toBe('INVALID_CREDENTIALS');
  });

  it('guarda o refresh token como HASH, nunca em claro', async () => {
    const result = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });

    if (result.isLeft()) throw new Error('deveria ter autenticado');

    const stored = context.refreshTokens.items.at(-1);

    expect(stored?.tokenHash).not.toBe(result.value.session.refreshToken);
    expect(stored?.tokenHash).toBe(`hash:${result.value.session.refreshToken}`);
  });

  it('cada login abre uma familia nova', async () => {
    await context.authenticate.execute({ email: 'ana@finapp.local', password: 'Finapp@123' });
    await context.authenticate.execute({ email: 'ana@finapp.local', password: 'Finapp@123' });

    const families = new Set(context.refreshTokens.items.map((t) => t.familyId.toValue()));

    expect(families.size).toBe(2);
  });
});

describe('RefreshSessionUseCase', () => {
  let context: Context;
  let refreshToken: string;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);

    const login = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });

    if (login.isLeft()) throw new Error('login deveria ter funcionado');
    refreshToken = login.value.session.refreshToken;
  });

  it('rotaciona o token mantendo a familia', async () => {
    const result = await context.refresh.execute({ refreshToken });

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;

    expect(result.value.session.refreshToken).not.toBe(refreshToken);

    const families = new Set(context.refreshTokens.items.map((t) => t.familyId.toValue()));
    expect(families.size).toBe(1);
  });

  it('queima o token anterior apontando o sucessor', async () => {
    await context.refresh.execute({ refreshToken });

    const previous = context.refreshTokens.items[0];

    expect(previous?.wasAlreadyRotated()).toBe(true);
    expect(previous?.isRevoked()).toBe(true);
  });

  it('DETECTA replay e derruba a familia inteira', async () => {
    // Um token ja rotacionado que reaparece: ou e reuso de token roubado, ou o
    // dono perdeu a resposta. Nao da para distinguir -- a resposta segura e a
    // mesma nos dois casos.
    const first = await context.refresh.execute({ refreshToken });
    if (first.isLeft()) throw new Error('primeira rotacao deveria ter funcionado');

    const replay = await context.refresh.execute({ refreshToken });

    expect(replay.isLeft()).toBe(true);
    expect(replay.isLeft() && replay.value.code).toBe('TOKEN_REUSED');

    // O token EMITIDO na rotacao legitima tambem morre.
    const stillValid = await context.refresh.execute({
      refreshToken: first.value.session.refreshToken,
    });

    expect(stillValid.isLeft()).toBe(true);
    expect(context.refreshTokens.items.every((token) => token.isRevoked())).toBe(true);
  });

  it('recusa token desconhecido', async () => {
    const result = await context.refresh.execute({ refreshToken: 'inventado' });

    expect(result.isLeft() && result.value.code).toBe('TOKEN_EXPIRED');
  });

  it('recusa token vencido', async () => {
    context.clock.advanceBy((REFRESH_TTL + 1) * 1000);

    const result = await context.refresh.execute({ refreshToken });

    expect(result.isLeft() && result.value.code).toBe('TOKEN_EXPIRED');
  });

  it('recusa token revogado por logout', async () => {
    await context.revoke.execute({ refreshToken });

    const result = await context.refresh.execute({ refreshToken });

    expect(result.isLeft()).toBe(true);
  });
});

describe('RevokeSessionUseCase', () => {
  it('derruba a familia inteira, nao so o token atual', async () => {
    const context = setup();
    await registerAna(context);

    const login = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });
    if (login.isLeft()) throw new Error('login deveria ter funcionado');

    const rotated = await context.refresh.execute({
      refreshToken: login.value.session.refreshToken,
    });
    if (rotated.isLeft()) throw new Error('rotacao deveria ter funcionado');

    await context.revoke.execute({ refreshToken: rotated.value.session.refreshToken });

    expect(context.refreshTokens.items.every((token) => token.isRevoked())).toBe(true);
  });

  it('nunca falha, mesmo sem token', async () => {
    const context = setup();

    await expect(context.revoke.execute({})).resolves.toMatchObject({ value: undefined });
    await expect(context.revoke.execute({ refreshToken: 'lixo' })).resolves.toMatchObject({
      value: undefined,
    });
  });
});

describe('VerifyEmailUseCase', () => {
  let context: Context;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);
  });

  it('confirma o e-mail com o token do cadastro', async () => {
    const result = await context.verifyEmail.execute({ token: 'token-1' });

    expect(result.isRight()).toBe(true);
    expect(context.users.items[0]?.isEmailVerified()).toBe(true);
  });

  it('recusa o mesmo token duas vezes', async () => {
    await context.verifyEmail.execute({ token: 'token-1' });

    const second = await context.verifyEmail.execute({ token: 'token-1' });

    expect(second.isLeft()).toBe(true);
  });

  it('recusa token vencido', async () => {
    context.clock.advanceBy(25 * 60 * 60 * 1000);

    const result = await context.verifyEmail.execute({ token: 'token-1' });

    expect(result.isLeft()).toBe(true);
    expect(context.users.items[0]?.isEmailVerified()).toBe(false);
  });

  it('recusa token inexistente', async () => {
    expect((await context.verifyEmail.execute({ token: 'inventado' })).isLeft()).toBe(true);
  });

  it('nao aceita token de redefinicao de senha', async () => {
    // O tipo faz parte da identidade do token.
    context.userTokens.items.push(
      UserToken.create({
        userId: context.users.items[0]!.id,
        type: 'PASSWORD_RESET',
        tokenHash: 'hash:reset-token',
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      }),
    );

    const result = await context.verifyEmail.execute({ token: 'reset-token' });

    expect(result.isLeft()).toBe(true);
  });
});

describe('RequestPasswordResetUseCase', () => {
  let context: Context;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);
  });

  it('envia o link de redefinicao', async () => {
    await context.requestReset.execute({ email: 'ana@finapp.local' });

    const mail = context.mail.lastTo('ana@finapp.local');

    expect(mail?.html).toContain('/redefinir-senha?token=');
    expect(
      context.userTokens.items.some((token) => token.type === 'PASSWORD_RESET'),
    ).toBe(true);
  });

  it('devolve sucesso mesmo para e-mail inexistente, e nao envia nada', async () => {
    // Responder "nao cadastrado" abriria um verificador de cadastro publico.
    const result = await context.requestReset.execute({ email: 'ninguem@finapp.local' });

    expect(result.isRight()).toBe(true);
    expect(context.mail.lastTo('ninguem@finapp.local')).toBeUndefined();
  });

  it('invalida o link anterior a cada pedido', async () => {
    await context.requestReset.execute({ email: 'ana@finapp.local' });
    await context.requestReset.execute({ email: 'ana@finapp.local' });

    const resetTokens = context.userTokens.items.filter((t) => t.type === 'PASSWORD_RESET');
    const usable = resetTokens.filter((token) => !token.isUsed());

    expect(resetTokens).toHaveLength(2);
    expect(usable).toHaveLength(1);
  });
});

describe('ResetPasswordUseCase', () => {
  let context: Context;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);
    await context.authenticate.execute({ email: 'ana@finapp.local', password: 'Finapp@123' });
    await context.requestReset.execute({ email: 'ana@finapp.local' });
  });

  it('troca a senha pelo token do e-mail', async () => {
    const result = await context.resetPassword.execute({
      token: 'token-3',
      password: 'NovaSenha@1',
    });

    expect(result.isRight()).toBe(true);
    expect(context.users.items[0]?.passwordHash).toBe(context.hasher.digest('NovaSenha@1'));

    const login = await context.authenticate.execute({
      email: 'ana@finapp.local',
      password: 'NovaSenha@1',
    });
    expect(login.isRight()).toBe(true);
  });

  it('derruba TODAS as sessoes', async () => {
    // Quem redefine em geral suspeita de acesso indevido: deixar as sessoes de
    // pe manteria o invasor logado com a senha nova.
    await context.resetPassword.execute({ token: 'token-3', password: 'NovaSenha@1' });

    expect(context.refreshTokens.items.every((token) => token.isRevoked())).toBe(true);
  });

  it('marca o e-mail como verificado', async () => {
    // Quem provou que recebe mensagens naquele endereco ja fez o que a
    // verificacao pede.
    await context.resetPassword.execute({ token: 'token-3', password: 'NovaSenha@1' });

    expect(context.users.items[0]?.isEmailVerified()).toBe(true);
  });

  it('recusa o mesmo link duas vezes', async () => {
    await context.resetPassword.execute({ token: 'token-3', password: 'NovaSenha@1' });

    const second = await context.resetPassword.execute({
      token: 'token-3',
      password: 'Outra@123',
    });

    expect(second.isLeft()).toBe(true);
    expect(context.users.items[0]?.passwordHash).toBe(context.hasher.digest('NovaSenha@1'));
  });

  it('recusa link vencido', async () => {
    context.clock.advanceBy(31 * 60 * 1000);

    const result = await context.resetPassword.execute({
      token: 'token-3',
      password: 'NovaSenha@1',
    });

    expect(result.isLeft()).toBe(true);
  });
});

describe('ChangePasswordUseCase', () => {
  let context: Context;

  beforeEach(async () => {
    context = setup();
    await registerAna(context);
    await context.authenticate.execute({ email: 'ana@finapp.local', password: 'Finapp@123' });
  });

  it('exige a senha atual', async () => {
    // Sem isso, uma sessao sequestrada tomaria a conta sem saber a senha.
    const result = await context.changePassword.execute({
      userId: context.users.items[0]!.id,
      currentPassword: 'Errada@123',
      password: 'NovaSenha@1',
    });

    expect(result.isLeft() && result.value.code).toBe('INVALID_CREDENTIALS');
    expect(context.users.items[0]?.passwordHash).toBe(context.hasher.digest('Finapp@123'));
  });

  it('troca a senha e emite uma sessao nova', async () => {
    const result = await context.changePassword.execute({
      userId: context.users.items[0]!.id,
      currentPassword: 'Finapp@123',
      password: 'NovaSenha@1',
    });

    expect(result.isRight()).toBe(true);
    expect(context.users.items[0]?.passwordHash).toBe(context.hasher.digest('NovaSenha@1'));

    // A sessao nova funciona; as antigas nao.
    if (result.isLeft()) return;
    const refreshed = await context.refresh.execute({
      refreshToken: result.value.refreshToken,
    });
    expect(refreshed.isRight()).toBe(true);
  });

  it('derruba as sessoes antigas', async () => {
    const oldToken = context.refreshTokens.items[0]!;

    await context.changePassword.execute({
      userId: context.users.items[0]!.id,
      currentPassword: 'Finapp@123',
      password: 'NovaSenha@1',
    });

    expect(oldToken.isRevoked()).toBe(true);
  });
});

describe('Email como value object', () => {
  it('impede duas contas com o mesmo e-mail em caixa diferente', async () => {
    const context = setup();

    await context.register.execute({
      name: 'Ana',
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });

    const duplicate = await context.users.existsByEmail(
      (Email.create('ANA@FINAPP.LOCAL') as { value: Email }).value,
    );

    expect(duplicate).toBe(true);
  });
});
