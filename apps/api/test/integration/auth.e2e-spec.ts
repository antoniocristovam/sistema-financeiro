import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '@/shared/database/prisma.service';

import { type FakeMailService } from '../doubles/in-memory-repositories';
import { createTestApp, refreshCookieFrom, tokenFromEmail } from './app-factory';

describe('Auth (integracao)', () => {
  let app: INestApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    mail = testApp.mail;
    close = testApp.close;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await close();
  });

  const register = (overrides: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Ana Ribeiro',
        email: 'ana@finapp.local',
        password: 'Finapp@123',
        ...overrides,
      });

  describe('POST /auth/register', () => {
    it('cria conta, workspace pessoal e ja devolve sessao', async () => {
      const response = await register().expect(201);

      expect(response.body.user.email).toBe('ana@finapp.local');
      expect(response.body.user.personalWorkspaceId).toBeTruthy();
      expect(response.body.tokens.accessToken).toBeTruthy();

      // O refresh vai no cookie httpOnly, NUNCA no corpo.
      expect(JSON.stringify(response.body)).not.toContain('refreshToken');

      const cookie = refreshCookieFrom(response.headers as Record<string, unknown>);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('grava a senha como hash argon2id, nunca em claro', async () => {
      await register().expect(201);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'ana@finapp.local' },
      });

      expect(user.passwordHash).not.toContain('Finapp@123');
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('cria as quatro entidades do cadastro', async () => {
      await register().expect(201);

      const [users, workspaces, members, profiles] = await Promise.all([
        prisma.user.count(),
        prisma.workspace.count(),
        prisma.workspaceMember.count(),
        prisma.financialProfile.count(),
      ]);

      expect({ users, workspaces, members, profiles }).toEqual({
        users: 1,
        workspaces: 1,
        members: 1,
        profiles: 1,
      });

      const member = await prisma.workspaceMember.findFirstOrThrow();
      expect(member.role).toBe('OWNER');
    });

    it('recusa e-mail duplicado com 409', async () => {
      await register().expect(201);

      const response = await register({ name: 'Outra' }).expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_USED');
    });

    it('recusa senha fraca com 400 e diz o que falta', async () => {
      const response = await register({ password: 'fraca' }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.issues.length).toBeGreaterThan(0);
    });
  });

  describe('POST /auth/login', () => {
    beforeAll(async () => {
      // noop: cada teste cria o proprio usuario (o banco e' truncado antes).
    });

    it('autentica e devolve o usuario', async () => {
      await register().expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@finapp.local', password: 'Finapp@123' })
        .expect(200);

      expect(response.body.user.email).toBe('ana@finapp.local');
      expect(refreshCookieFrom(response.headers as Record<string, unknown>)).toBeTruthy();
    });

    it('devolve 401 identico para senha errada e conta inexistente', async () => {
      await register().expect(201);

      const senhaErrada = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@finapp.local', password: 'Errada@123' })
        .expect(401);

      const semConta = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ninguem@finapp.local', password: 'Finapp@123' })
        .expect(401);

      expect(senhaErrada.body).toEqual(semConta.body);
      expect(senhaErrada.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotaciona a sessao pelo cookie', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookieFrom(registered.headers as Record<string, unknown>)!;

      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);

      const rotated = refreshCookieFrom(response.headers as Record<string, unknown>);

      expect(response.body.tokens.accessToken).toBeTruthy();
      expect(rotated).not.toBe(cookie);
    });

    it('DETECTA replay: reusar o cookie antigo derruba a familia', async () => {
      const registered = await register().expect(201);
      const original = refreshCookieFrom(registered.headers as Record<string, unknown>)!;

      const rotatedResponse = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', original)
        .expect(200);

      const rotated = refreshCookieFrom(rotatedResponse.headers as Record<string, unknown>)!;

      // O cookie antigo volta: sinal de reuso.
      const replay = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', original)
        .expect(401);

      expect(replay.body.code).toBe('TOKEN_REUSED');

      // E o token legitimo tambem morreu, junto com a familia.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', rotated)
        .expect(401);

      const active = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(active).toBe(0);
    });

    it('recusa refresh sem cookie', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });
  });

  describe('Verificacao de e-mail', () => {
    it('confirma o e-mail com o token enviado', async () => {
      await register().expect(201);

      const token = tokenFromEmail(mail.lastTo('ana@finapp.local')!.html, '/verificar-email');

      await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({ token })
        .expect(204);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'ana@finapp.local' },
      });

      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('recusa o mesmo token duas vezes', async () => {
      await register().expect(201);
      const token = tokenFromEmail(mail.lastTo('ana@finapp.local')!.html, '/verificar-email');

      await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({ token })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({ token })
        .expect(401);
    });
  });

  describe('Recuperacao de senha', () => {
    it('troca a senha pelo link e derruba as sessoes antigas', async () => {
      const registered = await register().expect(201);
      const oldCookie = refreshCookieFrom(registered.headers as Record<string, unknown>)!;

      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'ana@finapp.local' })
        .expect(204);

      const token = tokenFromEmail(mail.lastTo('ana@finapp.local')!.html, '/redefinir-senha');

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token, password: 'NovaSenha@1', passwordConfirmation: 'NovaSenha@1' })
        .expect(204);

      // A senha nova funciona.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@finapp.local', password: 'NovaSenha@1' })
        .expect(200);

      // A antiga nao, e a sessao anterior morreu.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@finapp.local', password: 'Finapp@123' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', oldCookie)
        .expect(401);
    });

    it('responde 204 para e-mail inexistente, sem enviar nada', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'ninguem@finapp.local' })
        .expect(204);

      expect(mail.lastTo('ninguem@finapp.local')).toBeUndefined();
    });
  });

  describe('Rotas protegidas', () => {
    it('GET /auth/me exige token', async () => {
      const response = await request(app.getHttpServer()).get('/api/auth/me').expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('GET /auth/me devolve o usuario logado', async () => {
      const registered = await register().expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${registered.body.tokens.accessToken}`)
        .expect(200);

      expect(response.body.email).toBe('ana@finapp.local');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('recusa token invalido', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer nao-e-um-jwt')
        .expect(401);
    });

    it('PATCH /auth/me atualiza preferencias', async () => {
      const registered = await register().expect(201);

      const response = await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${registered.body.tokens.accessToken}`)
        .send({ theme: 'DARK', locale: 'EN_US' })
        .expect(200);

      expect(response.body.theme).toBe('DARK');
      expect(response.body.locale).toBe('EN_US');
    });
  });

  describe('Logout', () => {
    it('derruba a sessao e limpa o cookie', async () => {
      const registered = await register().expect(201);
      const cookie = refreshCookieFrom(registered.headers as Record<string, unknown>)!;

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });
  });
  describe('Health check', () => {
    it('responde sem autenticacao', async () => {
      // O JwtAuthGuard e global: sem @Public() explicito, o healthcheck do
      // Docker e o balanceador tomariam 401.
      const response = await request(app.getHttpServer()).get('/api/health').expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.database).toBe('up');
    });
  });
});
