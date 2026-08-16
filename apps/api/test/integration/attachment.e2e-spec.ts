import { WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_SERVICE, type StorageService } from '@/shared/application/ports/storage-service';
import { PrismaService } from '@/shared/database/prisma.service';

import { createTestApp } from './app-factory';

const BUCKET = process.env.MINIO_BUCKET_ATTACHMENTS ?? 'finapp-attachments';

/** PNG 1x1 valido, o menor arquivo real que da para enviar. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Comprovantes (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let close: () => Promise<void>;

  let token: string;
  let workspaceId: string;
  let transactionId: string;
  let otherToken: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    close = testApp.close;
    prisma = app.get(PrismaService);
    // O storage NAO e' dublado: o teste sobe o arquivo no MinIO de verdade.
    storage = app.get(STORAGE_SERVICE);
  });

  afterAll(async () => {
    await close();
  });

  const auth = (accessToken = token, ws = workspaceId) => ({
    Authorization: `Bearer ${accessToken}`,
    [WORKSPACE_HEADER]: ws,
  });

  async function signUp(email: string): Promise<{ token: string; workspaceId: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ana', email, password: 'Finapp@123' })
      .expect(201);

    return {
      token: response.body.tokens.accessToken,
      workspaceId: response.body.user.personalWorkspaceId,
    };
  }

  /** Percorre os tres tempos: pedir URL, enviar ao MinIO, confirmar. */
  async function uploadReceipt(
    file: Buffer = PNG_1X1,
    fileName = 'comprovante.png',
    mimeType = 'image/png',
  ): Promise<{ id: string; objectKey: string }> {
    const ticket = await request(app.getHttpServer())
      .post(`/api/transactions/${transactionId}/attachments/upload-url`)
      .set(auth())
      .send({ fileName, mimeType, sizeInBytes: file.length })
      .expect(201);

    const put = await fetch(ticket.body.uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(file),
      headers: { 'Content-Type': mimeType },
    });

    expect(put.ok).toBe(true);

    const confirmed = await request(app.getHttpServer())
      .post(
        `/api/transactions/${transactionId}/attachments?fileName=${encodeURIComponent(fileName)}&mimeType=${encodeURIComponent(mimeType)}`,
      )
      .set(auth())
      .send({ objectKey: ticket.body.objectKey })
      .expect(201);

    return { id: confirmed.body.id, objectKey: ticket.body.objectKey };
  }

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;

    const bruno = await signUp('bruno@finapp.local');
    otherToken = bruno.token;
    otherWorkspaceId = bruno.workspaceId;

    const account = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: 0 })
      .expect(201);

    const transaction = await request(app.getHttpServer())
      .post('/api/transactions')
      .set(auth())
      .send({
        type: 'EXPENSE',
        accountId: account.body.id,
        amountInCents: 5000,
        date: '2026-08-15',
        description: 'Almoço',
      })
      .expect(201);

    transactionId = transaction.body.id;
  });

  describe('Upload em tres tempos', () => {
    it('sobe o arquivo direto no MinIO e registra o anexo', async () => {
      const { id, objectKey } = await uploadReceipt();

      // O objeto existe MESMO no storage.
      const stored = await storage.stat(BUCKET, objectKey);
      expect(stored?.sizeInBytes).toBe(PNG_1X1.length);

      const list = await request(app.getHttpServer())
        .get(`/api/transactions/${transactionId}/attachments`)
        .set(auth())
        .expect(200);

      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(id);
      expect(list.body[0].originalName).toBe('comprovante.png');
      expect(list.body[0].isImage).toBe(true);
      // O TAMANHO vem do storage, nao do que o cliente declarou.
      expect(list.body[0].sizeInBytes).toBe(PNG_1X1.length);
    });

    it('a chave do objeto NAO usa o nome enviado pelo usuario', async () => {
      // Nome de arquivo do cliente carrega `../`, caractere de controle e
      // colisao entre usuarios.
      const ticket = await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments/upload-url`)
        .set(auth())
        .send({ fileName: '../../etc/passwd.png', mimeType: 'image/png', sizeInBytes: 100 })
        .expect(201);

      expect(ticket.body.objectKey).not.toContain('..');
      expect(ticket.body.objectKey).not.toContain('passwd');
      expect(ticket.body.objectKey.startsWith(`${workspaceId}/${transactionId}/`)).toBe(true);
    });

    it('recusa confirmar sem o arquivo ter chegado', async () => {
      // O PUT acontece fora da API: sem esta checagem, uma conexao caida
      // criaria um anexo apontando para nada.
      const ticket = await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments/upload-url`)
        .set(auth())
        .send({ fileName: 'nada.png', mimeType: 'image/png', sizeInBytes: 100 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments`)
        .set(auth())
        .send({ objectKey: ticket.body.objectKey })
        .expect(409);

      expect(response.body.message).toContain('nao chegou');
      expect(await prisma.attachment.count()).toBe(0);
    });

    it('recusa confirmar chave de OUTRO workspace', async () => {
      // A chave volta pelo cliente: sem validar o prefixo, daria para
      // confirmar o objeto alheio e ganhar um link de leitura para ele.
      const { objectKey } = await uploadReceipt();

      const alheio = await request(app.getHttpServer())
        .post('/api/accounts')
        .set(auth(otherToken, otherWorkspaceId))
        .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: 0 })
        .expect(201);

      const outra = await request(app.getHttpServer())
        .post('/api/transactions')
        .set(auth(otherToken, otherWorkspaceId))
        .send({
          type: 'EXPENSE',
          accountId: alheio.body.id,
          amountInCents: 100,
          date: '2026-08-15',
          description: 'x',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/transactions/${outra.body.id}/attachments`)
        .set(auth(otherToken, otherWorkspaceId))
        .send({ objectKey })
        .expect(400);

      expect(response.body.message).toContain('invalida');
    });

    it('recusa tipo de arquivo fora da lista', async () => {
      await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments/upload-url`)
        .set(auth())
        .send({ fileName: 'script.exe', mimeType: 'application/x-msdownload', sizeInBytes: 100 })
        .expect(400);
    });

    it('recusa arquivo acima de 10 MB', async () => {
      await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments/upload-url`)
        .set(auth())
        .send({ fileName: 'grande.png', mimeType: 'image/png', sizeInBytes: 11 * 1024 * 1024 })
        .expect(400);
    });

    it('recusa anexar ao lancamento de outra pessoa', async () => {
      await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments/upload-url`)
        .set(auth(otherToken, otherWorkspaceId))
        .send({ fileName: 'x.png', mimeType: 'image/png', sizeInBytes: 100 })
        .expect(404);
    });

    it('recusa confirmar a mesma chave duas vezes', async () => {
      const { objectKey } = await uploadReceipt();

      await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/attachments`)
        .set(auth())
        .send({ objectKey })
        .expect(409);
    });
  });

  describe('Leitura', () => {
    it('devolve URL assinada que baixa o arquivo', async () => {
      const { id } = await uploadReceipt();

      const download = await request(app.getHttpServer())
        .get(`/api/transactions/${transactionId}/attachments/${id}/download-url`)
        .set(auth())
        .expect(200);

      expect(download.body.expiresInSeconds).toBeGreaterThan(0);

      const fetched = await fetch(download.body.url);
      const bytes = Buffer.from(await fetched.arrayBuffer());

      expect(fetched.ok).toBe(true);
      expect(bytes.equals(PNG_1X1)).toBe(true);
    });

    it('o bucket e PRIVADO: sem assinatura nao abre', async () => {
      const { objectKey } = await uploadReceipt();

      const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
      const port = process.env.MINIO_PORT ?? '9000';

      const direct = await fetch(`http://${endpoint}:${port}/${BUCKET}/${objectKey}`);

      expect(direct.ok).toBe(false);
      expect(direct.status).toBe(403);
    });

    it('nao devolve URL para anexo de outro workspace', async () => {
      const { id } = await uploadReceipt();

      await request(app.getHttpServer())
        .get(`/api/transactions/${transactionId}/attachments/${id}/download-url`)
        .set(auth(otherToken, otherWorkspaceId))
        .expect(404);
    });
  });

  describe('Exclusao (regra 8)', () => {
    it('excluir o comprovante remove o objeto do MinIO', async () => {
      const { id, objectKey } = await uploadReceipt();

      expect(await storage.stat(BUCKET, objectKey)).not.toBeNull();

      await request(app.getHttpServer())
        .delete(`/api/transactions/${transactionId}/attachments/${id}`)
        .set(auth())
        .expect(204);

      expect(await prisma.attachment.count()).toBe(0);
      expect(await storage.stat(BUCKET, objectKey)).toBeNull();
    });

    it('excluir o LANCAMENTO remove os objetos junto', async () => {
      // Regra 8. O cascade do banco apaga as linhas; o objeto no storage nao
      // tem cascade -- sem a limpeza, cada exclusao deixaria um arquivo orfao.
      const first = await uploadReceipt(PNG_1X1, 'um.png');
      const second = await uploadReceipt(PNG_1X1, 'dois.png');

      await request(app.getHttpServer())
        .delete(`/api/transactions/${transactionId}`)
        .set(auth())
        .expect(204);

      expect(await prisma.attachment.count()).toBe(0);
      expect(await storage.stat(BUCKET, first.objectKey)).toBeNull();
      expect(await storage.stat(BUCKET, second.objectKey)).toBeNull();
    });

    it('registra na auditoria quantos arquivos sairam', async () => {
      await uploadReceipt();

      await request(app.getHttpServer())
        .delete(`/api/transactions/${transactionId}`)
        .set(auth())
        .expect(204);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'TRANSACTION_DELETED' },
      });

      expect((log.metadata as { removedFiles?: number }).removedFiles).toBe(1);
    });

    it('nao exclui comprovante de outro workspace', async () => {
      const { id, objectKey } = await uploadReceipt();

      await request(app.getHttpServer())
        .delete(`/api/transactions/${transactionId}/attachments/${id}`)
        .set(auth(otherToken, otherWorkspaceId))
        .expect(404);

      // O arquivo continua la.
      expect(await storage.stat(BUCKET, objectKey)).not.toBeNull();
    });
  });

  describe('Permissoes', () => {
    it('VIEWER le mas nao anexa', async () => {
      const shared = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set({ Authorization: `Bearer ${token}` })
        .send({ name: 'Casa', baseCurrency: 'BRL' })
        .expect(201);

      const bruno = await prisma.user.findFirstOrThrow({
        where: { email: 'bruno@finapp.local' },
      });

      await prisma.workspaceMember.create({
        data: { workspaceId: shared.body.id, userId: bruno.id, role: 'VIEWER' },
      });

      const account = await request(app.getHttpServer())
        .post('/api/accounts')
        .set({ Authorization: `Bearer ${token}`, [WORKSPACE_HEADER]: shared.body.id })
        .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: 0 })
        .expect(201);

      const shift = await request(app.getHttpServer())
        .post('/api/transactions')
        .set({ Authorization: `Bearer ${token}`, [WORKSPACE_HEADER]: shared.body.id })
        .send({
          type: 'EXPENSE',
          accountId: account.body.id,
          amountInCents: 100,
          date: '2026-08-15',
          description: 'x',
        })
        .expect(201);

      const asViewer = {
        Authorization: `Bearer ${otherToken}`,
        [WORKSPACE_HEADER]: shared.body.id,
      };

      await request(app.getHttpServer())
        .get(`/api/transactions/${shift.body.id}/attachments`)
        .set(asViewer)
        .expect(200);

      const denied = await request(app.getHttpServer())
        .post(`/api/transactions/${shift.body.id}/attachments/upload-url`)
        .set(asViewer)
        .send({ fileName: 'x.png', mimeType: 'image/png', sizeInBytes: 100 })
        .expect(403);

      expect(denied.body.code).toBe('INSUFFICIENT_ROLE');
    });
  });
});
