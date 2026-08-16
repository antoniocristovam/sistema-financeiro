import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '@/shared/database/prisma.service';

import { type FakeMailService } from '../doubles/in-memory-repositories';
import { createTestApp, tokenFromEmail } from './app-factory';

interface Account {
  userId: string;
  accessToken: string;
  personalWorkspaceId: string;
}

describe('Workspace (integracao)', () => {
  let app: INestApplication;
  let mail: FakeMailService;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  let ana: Account;
  let bruno: Account;
  let carla: Account;

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

  async function signUp(name: string, email: string): Promise<Account> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name, email, password: 'Finapp@123' })
      .expect(201);

    return {
      userId: response.body.user.id,
      accessToken: response.body.tokens.accessToken,
      personalWorkspaceId: response.body.user.personalWorkspaceId,
    };
  }

  const as = (account: Account) => ({ Authorization: `Bearer ${account.accessToken}` });

  async function createShared(owner: Account, name = 'Casa'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/workspaces')
      .set(as(owner))
      .send({ name, baseCurrency: 'BRL' })
      .expect(201);

    return response.body.id;
  }

  /** Convida e ja aceita, devolvendo o workspace. */
  async function inviteAndAccept(
    workspaceId: string,
    owner: Account,
    guest: Account,
    guestEmail: string,
    role: 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER',
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set(as(owner))
      .send({ email: guestEmail, role })
      .expect(201);

    const token = tokenFromEmail(mail.lastTo(guestEmail)!.html, '/convite');

    await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .set(as(guest))
      .send({ token })
      .expect(201);
  }

  beforeEach(async () => {
    ana = await signUp('Ana Ribeiro', 'ana@finapp.local');
    bruno = await signUp('Bruno Alves', 'bruno@finapp.local');
    carla = await signUp('Carla Souza', 'carla@finapp.local');
  });

  describe('GET /workspaces', () => {
    it('devolve o pessoal criado no cadastro', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set(as(ana))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe('PERSONAL');
      expect(response.body[0].role).toBe('OWNER');
      expect(response.body[0].memberCount).toBe(1);
    });

    it('NAO devolve workspace de outra pessoa', async () => {
      await createShared(bruno, 'Casa do Bruno');

      const response = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set(as(ana))
        .expect(200);

      expect(response.body.map((w: { name: string }) => w.name)).toEqual(['Minhas finanças']);
    });
  });

  describe('Fluxo completo: convidar, aceitar, participar', () => {
    it('convida por e-mail, o convidado aceita e os dois veem o mesmo workspace', async () => {
      const workspaceId = await createShared(ana);

      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      const doAna = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set(as(ana))
        .expect(200);

      const doBruno = await request(app.getHttpServer())
        .get('/api/workspaces')
        .set(as(bruno))
        .expect(200);

      const casaDaAna = doAna.body.find((w: { id: string }) => w.id === workspaceId);
      const casaDoBruno = doBruno.body.find((w: { id: string }) => w.id === workspaceId);

      expect(casaDaAna.role).toBe('OWNER');
      expect(casaDoBruno.role).toBe('MEMBER');
      expect(casaDaAna.memberCount).toBe(2);
      expect(casaDoBruno.memberCount).toBe(2);
    });

    it('a listagem de membros traz nome e papel dos dois', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(ana))
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.map((m: { name: string }) => m.name)).toEqual([
        'Ana Ribeiro',
        'Bruno Alves',
      ]);
      expect(response.body.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'MEMBER']);
    });

    it('registra a auditoria do convite e da entrada', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      const logs = await prisma.auditLog.findMany({ where: { workspaceId } });

      expect(logs.map((log) => log.action).sort()).toEqual(['MEMBER_INVITED', 'MEMBER_JOINED']);
    });
  });

  describe('Isolamento entre workspaces (IDOR)', () => {
    it('quem nao e membro recebe 403, nao 404', async () => {
      // 404 revelaria, por eliminacao, quais ids existem.
      const workspaceId = await createShared(ana);

      const response = await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(bruno))
        .expect(403);

      expect(response.body.code).toBe('NOT_WORKSPACE_MEMBER');
    });

    it('workspace inexistente responde igual a workspace alheio', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/workspaces/00000000-0000-4000-8000-000000000000/members')
        .set(as(ana))
        .expect(403);

      expect(response.body.code).toBe('NOT_WORKSPACE_MEMBER');
    });

    it('nao da para entrar no workspace pessoal de outra pessoa', async () => {
      await request(app.getHttpServer())
        .get(`/api/workspaces/${bruno.personalWorkspaceId}/members`)
        .set(as(ana))
        .expect(403);
    });
  });

  describe('Permissoes por papel', () => {
    it('MEMBER nao convida (403 INSUFFICIENT_ROLE)', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'MEMBER');

      const response = await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(bruno))
        .send({ email: 'carla@finapp.local', role: 'MEMBER' })
        .expect(403);

      expect(response.body.code).toBe('INSUFFICIENT_ROLE');
    });

    it('ADMIN convida', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'ADMIN');

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(bruno))
        .send({ email: 'carla@finapp.local', role: 'MEMBER' })
        .expect(201);
    });

    it('ADMIN nao exclui o workspace', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'ADMIN');

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}`)
        .set(as(bruno))
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}`)
        .set(as(ana))
        .expect(204);
    });

    it('VIEWER le, mas nao gerencia', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'VIEWER');

      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(bruno))
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(bruno))
        .expect(403);
    });
  });

  describe('Convites', () => {
    it('recusa aceite por conta diferente da convidada', async () => {
      const workspaceId = await createShared(ana);

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(ana))
        .send({ email: 'bruno@finapp.local', role: 'MEMBER' })
        .expect(201);

      const token = tokenFromEmail(mail.lastTo('bruno@finapp.local')!.html, '/convite');

      // Carla tenta usar o token do Bruno.
      const response = await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set(as(carla))
        .send({ token })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(await prisma.workspaceMember.count({ where: { workspaceId } })).toBe(1);
    });

    it('recusa convidar quem ja e membro', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(ana))
        .send({ email: 'bruno@finapp.local', role: 'ADMIN' })
        .expect(409);

      expect(response.body.code).toBe('ALREADY_MEMBER');
    });

    it('guarda so o hash do token no banco', async () => {
      const workspaceId = await createShared(ana);

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(ana))
        .send({ email: 'bruno@finapp.local', role: 'MEMBER' })
        .expect(201);

      const token = tokenFromEmail(mail.lastTo('bruno@finapp.local')!.html, '/convite');
      const stored = await prisma.invitation.findFirstOrThrow({ where: { workspaceId } });

      expect(stored.tokenHash).not.toBe(token);
      expect(stored.tokenHash).toHaveLength(64);
    });

    it('convite revogado nao pode mais ser aceito', async () => {
      const workspaceId = await createShared(ana);

      const invited = await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/invitations`)
        .set(as(ana))
        .send({ email: 'bruno@finapp.local', role: 'MEMBER' })
        .expect(201);

      const token = tokenFromEmail(mail.lastTo('bruno@finapp.local')!.html, '/convite');

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}/invitations/${invited.body.id}`)
        .set(as(ana))
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set(as(bruno))
        .send({ token })
        .expect(409);
    });

    it('nao permite convidar para workspace pessoal', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/workspaces/${ana.personalWorkspaceId}/invitations`)
        .set(as(ana))
        .send({ email: 'bruno@finapp.local', role: 'MEMBER' })
        .expect(403);

      expect(response.body.message).toContain('pessoal');
    });
  });

  describe('Gestao de membros', () => {
    it('troca o papel de um membro', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'MEMBER');

      await request(app.getHttpServer())
        .patch(`/api/workspaces/${workspaceId}/members/${bruno.userId}`)
        .set(as(ana))
        .send({ role: 'ADMIN' })
        .expect(200);

      const members = await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(ana))
        .expect(200);

      const brunoMember = members.body.find((m: { userId: string }) => m.userId === bruno.userId);
      expect(brunoMember.role).toBe('ADMIN');
    });

    it('remove um membro', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}/members/${bruno.userId}`)
        .set(as(ana))
        .expect(204);

      // Bruno perde o acesso na hora.
      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(bruno))
        .expect(403);
    });

    it('membro removido perde acesso mesmo com access token ainda valido', async () => {
      // O papel NAO viaja no JWT: e resolvido no banco a cada requisicao. Se
      // viajasse, o removido continuaria entrando ate o token vencer.
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(bruno))
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}/members/${bruno.userId}`)
        .set(as(ana))
        .expect(204);

      // Mesmo token de antes.
      await request(app.getHttpServer())
        .get(`/api/workspaces/${workspaceId}/members`)
        .set(as(bruno))
        .expect(403);
    });

    it('MEMBER sai por conta propria', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/leave`)
        .set(as(bruno))
        .expect(204);

      expect(await prisma.workspaceMember.count({ where: { workspaceId } })).toBe(1);
    });

    it('o ULTIMO dono nao pode sair', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/leave`)
        .set(as(ana))
        .expect(422);

      expect(response.body.code).toBe('LAST_OWNER');
    });
  });

  describe('Transferencia de posse', () => {
    it('transfere e libera o antigo dono para sair', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/transfer-ownership`)
        .set(as(ana))
        .send({ toUserId: bruno.userId })
        .expect(204);

      const members = await prisma.workspaceMember.findMany({ where: { workspaceId } });
      const roles = Object.fromEntries(members.map((m) => [m.userId, m.role]));

      expect(roles[bruno.userId]).toBe('OWNER');
      expect(roles[ana.userId]).toBe('ADMIN');

      // Agora a Ana consegue sair.
      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/leave`)
        .set(as(ana))
        .expect(204);
    });

    it('so o dono transfere', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local', 'ADMIN');

      await request(app.getHttpServer())
        .post(`/api/workspaces/${workspaceId}/transfer-ownership`)
        .set(as(bruno))
        .send({ toUserId: bruno.userId })
        .expect(403);
    });
  });

  describe('Exclusao', () => {
    it('exclui o workspace e tudo que pende dele', async () => {
      const workspaceId = await createShared(ana);
      await inviteAndAccept(workspaceId, ana, bruno, 'bruno@finapp.local');

      await request(app.getHttpServer())
        .delete(`/api/workspaces/${workspaceId}`)
        .set(as(ana))
        .expect(204);

      expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(0);
      expect(await prisma.workspaceMember.count({ where: { workspaceId } })).toBe(0);
      expect(await prisma.invitation.count({ where: { workspaceId } })).toBe(0);
    });

    it('nao exclui workspace pessoal', async () => {
      await request(app.getHttpServer())
        .delete(`/api/workspaces/${ana.personalWorkspaceId}`)
        .set(as(ana))
        .expect(403);
    });
  });
});
