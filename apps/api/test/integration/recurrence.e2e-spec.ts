import { NotificationType, RecurrenceFrequency, WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MaterializeRecurrencesUseCase,
  SendRecurrenceRemindersUseCase,
} from '@/modules/transaction/core/application/use-cases/run-recurrence-jobs';
import { PrismaService } from '@/shared/database/prisma.service';
import { CalendarDate } from '@/shared/domain/value-objects/calendar-date';

import { createTestApp } from './app-factory';
import { type FakeMailService } from '../doubles/in-memory-repositories';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

describe('Contas fixas (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let close: () => Promise<void>;
  let materialize: MaterializeRecurrencesUseCase;
  let reminders: SendRecurrenceRemindersUseCase;

  let token: string;
  let workspaceId: string;
  let accountId: string;
  let categoryId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    mail = testApp.mail;
    close = testApp.close;
    prisma = app.get(PrismaService);
    materialize = app.get(MaterializeRecurrencesUseCase);
    reminders = app.get(SendRecurrenceRemindersUseCase);
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

  /** Corpo valido de conta fixa mensal, com sobreposicoes por teste. */
  const body = (overrides: Record<string, unknown> = {}) => ({
    name: 'Aluguel',
    template: {
      type: 'EXPENSE',
      accountId,
      categoryId,
      amountInCents: 210_000,
      description: 'Aluguel do apartamento',
    },
    frequency: RecurrenceFrequency.MONTHLY,
    dayOfMonth: 10,
    startDate: '2026-01-10',
    ...overrides,
  });

  const createRecurrence = (payload: Record<string, unknown> = body(), as = auth()) =>
    request(app.getHttpServer()).post('/api/recurrences').set(as).send(payload);

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;
    mail.sent.length = 0;

    const account = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Conta corrente', type: 'CHECKING', initialBalanceInCents: 500_000 })
      .expect(201);

    accountId = account.body.id;

    const category = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Moradia', type: 'EXPENSE' })
      .expect(201);

    categoryId = category.body.id;
  });

  describe('cadastro', () => {
    it('cria a serie e devolve a proxima ocorrencia', async () => {
      const response = await createRecurrence().expect(201);

      expect(response.body.name).toBe('Aluguel');
      expect(response.body.template.accountName).toBe('Conta corrente');
      expect(response.body.template.categoryName).toBe('Moradia');
      expect(response.body.monthlyAmountInCents).toBe(210_000);
      expect(response.body.nextOccurrence).toMatch(/^\d{4}-\d{2}-10$/);
    });

    it('recusa combinacao sem sentido de periodicidade', async () => {
      // Semanal com dia do mes: quase sempre formulario mal preenchido.
      await createRecurrence(
        body({ frequency: RecurrenceFrequency.WEEKLY, dayOfMonth: 10 }),
      ).expect(400);
    });

    it('recusa conta de outro workspace', async () => {
      const bruno = await signUp('bruno@finapp.local');

      const outraConta = await request(app.getHttpServer())
        .post('/api/accounts')
        .set(auth(bruno.token, bruno.workspaceId))
        .send({ name: 'Conta do Bruno', type: 'CHECKING', initialBalanceInCents: 0 })
        .expect(201);

      // Ana informa o id da conta do Bruno na mao.
      const response = await createRecurrence(
        body({ template: { ...body().template, accountId: outraConta.body.id } }),
      );

      expect(response.status).toBe(404);
    });

    it('guarda quem cadastrou a serie', async () => {
      const response = await createRecurrence().expect(201);

      const row = await prisma.recurrence.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { createdByUserId: true },
      });

      const membro = await prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId, role: 'OWNER' },
        select: { userId: true },
      });

      expect(row.createdByUserId).toBe(membro.userId);
    });
  });

  describe('listagem', () => {
    it('soma o comprometimento mensal normalizando a semanal por 52/12', async () => {
      await createRecurrence().expect(201);
      await createRecurrence(
        body({
          name: 'Faxina',
          frequency: RecurrenceFrequency.WEEKLY,
          dayOfMonth: null,
          weekday: 1,
          template: { ...body().template, amountInCents: 5_000, description: 'Faxina' },
        }),
      ).expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/recurrences')
        .set(auth())
        .expect(200);

      // R$ 50 por semana sao R$ 216,67 por mes -- nao R$ 200.
      expect(response.body.monthlyCommittedInCents).toBe(210_000 + 21_667);
    });

    it('esconde as inativas por padrao', async () => {
      const criada = await createRecurrence().expect(201);

      await request(app.getHttpServer())
        .patch(`/api/recurrences/${criada.body.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200);

      const semInativas = await request(app.getHttpServer())
        .get('/api/recurrences')
        .set(auth())
        .expect(200);

      const comInativas = await request(app.getHttpServer())
        .get('/api/recurrences?includeInactive=true')
        .set(auth())
        .expect(200);

      expect(semInativas.body.items).toHaveLength(0);
      expect(comInativas.body.items).toHaveLength(1);
      expect(comInativas.body.monthlyCommittedInCents).toBe(0);
    });

    it('nao vaza serie de outro workspace', async () => {
      await createRecurrence().expect(201);

      const bruno = await signUp('bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .get('/api/recurrences')
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(200);

      expect(response.body.items).toHaveLength(0);
    });
  });

  describe('materializacao', () => {
    it('cria os lancamentos da janela como PENDENTES', async () => {
      await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      const report = await materialize.execute(day('2026-03-01'));

      expect(report.transactionsCreated).toBe(2);

      const criados = await prisma.transaction.findMany({
        where: { workspaceId },
        orderBy: { date: 'asc' },
        select: { date: true, status: true, amountInCents: true, occurrenceDate: true },
      });

      expect(criados).toHaveLength(2);
      expect(criados.every((item) => item.status === 'PENDING')).toBe(true);
      expect(criados.every((item) => item.amountInCents === 210_000)).toBe(true);
      expect(criados[0]?.occurrenceDate).not.toBeNull();
    });

    it('e IDEMPOTENTE contra o indice unico do banco', async () => {
      /*
       * Aqui a idempotencia e' verificada onde ela realmente mora: no indice
       * `(recurrenceId, occurrenceDate)` do Postgres. Um duble em memoria
       * poderia estar simulando a regra errada -- este teste nao pode.
       */
      await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      const primeira = await materialize.execute(day('2026-03-01'));
      const segunda = await materialize.execute(day('2026-03-01'));

      expect(primeira.transactionsCreated).toBe(2);
      expect(segunda.transactionsCreated).toBe(0);
      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(2);
    });

    it('nao recria ocorrencia dispensada pelo usuario', async () => {
      const criada = await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      await request(app.getHttpServer())
        .post(`/api/recurrences/${criada.body.id}/skips`)
        .set(auth())
        .send({ occurrenceDate: '2026-03-10', reason: 'Paguei adiantado' })
        .expect(204);

      await materialize.execute(day('2026-03-01'));

      const datas = await prisma.transaction.findMany({
        where: { workspaceId },
        select: { date: true },
      });

      expect(datas.map((item) => item.date.toISOString().slice(0, 10))).toEqual(['2026-04-10']);
    });

    it('nao materializa serie inativa', async () => {
      const criada = await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/recurrences/${criada.body.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(200);

      const report = await materialize.execute(day('2026-03-01'));

      expect(report.transactionsCreated).toBe(0);
    });

    it('serie retroativa NAO despeja contas vencidas no extrato', async () => {
      // Cadastrada hoje "desde janeiro do ano passado": as vencidas ja foram
      // pagas, e como nascem PENDING estragariam o saldo projetado.
      await createRecurrence(body({ startDate: '2025-01-10' })).expect(201);

      await materialize.execute(day('2026-03-01'));

      const datas = await prisma.transaction.findMany({
        where: { workspaceId },
        select: { date: true },
        orderBy: { date: 'asc' },
      });

      expect(datas).toHaveLength(2);
      expect(datas[0]?.date.toISOString().slice(0, 10)).toBe('2026-03-10');
    });

    it('o lancamento gerado aparece no extrato ligado a serie', async () => {
      const criada = await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      await materialize.execute(day('2026-03-01'));

      const extrato = await request(app.getHttpServer())
        .get('/api/transactions?limit=10')
        .set(auth())
        .expect(200);

      expect(extrato.body.items).toHaveLength(2);
      expect(extrato.body.items[0].recurrenceId).toBe(criada.body.id);
      expect(extrato.body.items[0].status).toBe('PENDING');
    });
  });

  describe('linha do tempo', () => {
    it('mistura ocorrencia materializada, dispensada e futura', async () => {
      const hoje = new Date();
      const inicio = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}-10`;

      const criada = await createRecurrence(body({ startDate: inicio })).expect(201);

      await materialize.execute();

      const response = await request(app.getHttpServer())
        .get(`/api/recurrences/${criada.body.id}/occurrences`)
        .set(auth())
        .expect(200);

      const status = new Set(response.body.map((item: { status: string }) => item.status));

      expect(response.body.length).toBeGreaterThan(0);
      expect(status.has('MATERIALIZED') || status.has('SCHEDULED')).toBe(true);
      expect(
        response.body.every((item: { date: string }) => /^\d{4}-\d{2}-10$/.test(item.date)),
      ).toBe(true);
    });

    it('recusa dispensar data que a regra nao gera', async () => {
      const criada = await createRecurrence().expect(201);

      await request(app.getHttpServer())
        .post(`/api/recurrences/${criada.body.id}/skips`)
        .set(auth())
        .send({ occurrenceDate: '2026-03-11' })
        .expect(400);
    });
  });

  describe('lembretes', () => {
    /** Data em que o lembrete de `dias` de antecedencia deve disparar. */
    function reminderDay(occurrence: string, days: number): CalendarDate {
      return day(occurrence).addDays(-days);
    }

    it('cria o aviso e manda o e-mail uma unica vez', async () => {
      await createRecurrence(
        body({ startDate: '2026-03-10', reminderDaysBefore: 3 }),
      ).expect(201);

      const primeira = await reminders.execute(reminderDay('2026-03-10', 3));
      const segunda = await reminders.execute(reminderDay('2026-03-10', 3));

      expect(primeira.notificationsCreated).toBe(1);
      expect(primeira.emailsSent).toBe(1);

      // A reexecucao esbarra no indice unico `(userId, dedupeKey)`.
      expect(segunda.notificationsCreated).toBe(0);
      expect(segunda.emailsSent).toBe(0);
      expect(mail.sent).toHaveLength(1);

      const caixa = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth())
        .expect(200);

      expect(caixa.body.items).toHaveLength(1);
      expect(caixa.body.items[0].type).toBe(NotificationType.RECURRENCE_DUE_SOON);
      expect(caixa.body.unreadCount).toBe(1);
    });

    it('nao avisa fora da antecedencia configurada', async () => {
      await createRecurrence(
        body({ startDate: '2026-03-10', reminderDaysBefore: 3 }),
      ).expect(201);

      const report = await reminders.execute(reminderDay('2026-03-10', 5));

      expect(report.notificationsCreated).toBe(0);
    });

    it('avisa reajuste quando o valor destoa da media paga', async () => {
      const criada = await createRecurrence(
        body({ startDate: '2026-03-10', reminderDaysBefore: 3, template: { ...body().template, amountInCents: 235_000 } }),
      ).expect(201);

      // Historico de tres pagamentos de R$ 2.100 ja liquidados.
      for (const date of ['2025-12-10', '2026-01-10', '2026-02-10']) {
        await prisma.transaction.create({
          data: {
            workspaceId,
            accountId,
            categoryId,
            createdByUserId: (
              await prisma.workspaceMember.findFirstOrThrow({
                where: { workspaceId, role: 'OWNER' },
              })
            ).userId,
            type: 'EXPENSE',
            amountInCents: 210_000,
            date: new Date(`${date}T00:00:00.000Z`),
            description: 'Aluguel',
            status: 'SETTLED',
            recurrenceId: criada.body.id,
            occurrenceDate: new Date(`${date}T00:00:00.000Z`),
          },
        });
      }

      const report = await reminders.execute(reminderDay('2026-03-10', 3));

      expect(report.driftAlerts).toBe(1);

      const caixa = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth())
        .expect(200);

      const tipos = caixa.body.items.map((item: { type: string }) => item.type);

      expect(tipos).toContain(NotificationType.RECURRENCE_AMOUNT_DRIFT);
    });
  });

  describe('caixa de avisos', () => {
    async function gerarAviso(): Promise<void> {
      await createRecurrence(body({ startDate: '2026-03-10', reminderDaysBefore: 3 })).expect(201);
      await reminders.execute(day('2026-03-07'));
    }

    it('marca como lida e zera o contador', async () => {
      await gerarAviso();

      const resposta = await request(app.getHttpServer())
        .patch('/api/notifications/read')
        .set(auth())
        .send({})
        .expect(200);

      expect(resposta.body.updated).toBe(1);
      expect(resposta.body.unreadCount).toBe(0);

      const naoLidas = await request(app.getHttpServer())
        .get('/api/notifications?onlyUnread=true')
        .set(auth())
        .expect(200);

      expect(naoLidas.body.items).toHaveLength(0);
    });

    it('marcar de novo nao conta a mesma leitura duas vezes', async () => {
      await gerarAviso();

      await request(app.getHttpServer())
        .patch('/api/notifications/read')
        .set(auth())
        .send({})
        .expect(200);

      const segunda = await request(app.getHttpServer())
        .patch('/api/notifications/read')
        .set(auth())
        .send({})
        .expect(200);

      expect(segunda.body.updated).toBe(0);
    });

    it('a caixa e do USUARIO: ninguem le o aviso de outro', async () => {
      await gerarAviso();

      const bruno = await signUp('bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .get('/api/notifications')
        .set({ Authorization: `Bearer ${bruno.token}` })
        .expect(200);

      expect(response.body.items).toHaveLength(0);
      expect(response.body.unreadCount).toBe(0);
    });

    it('exige autenticacao', async () => {
      await request(app.getHttpServer()).get('/api/notifications').expect(401);
    });
  });

  describe('exclusao', () => {
    it('apaga a serie mas PRESERVA os lancamentos ja gerados', async () => {
      const criada = await createRecurrence(body({ startDate: '2026-03-10' })).expect(201);

      await materialize.execute(day('2026-03-01'));
      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(2);

      await request(app.getHttpServer())
        .delete(`/api/recurrences/${criada.body.id}`)
        .set(auth())
        .expect(204);

      // O aluguel de marco aconteceu: apagar a serie nao reescreve o extrato.
      const restantes = await prisma.transaction.findMany({
        where: { workspaceId },
        select: { recurrenceId: true },
      });

      expect(restantes).toHaveLength(2);
      expect(restantes.every((item) => item.recurrenceId === null)).toBe(true);

      const trilha = await prisma.auditLog.findMany({ where: { workspaceId } });

      expect(trilha.some((entry) => entry.action === 'RECURRENCE_DELETED')).toBe(true);
    });

    it('nao deixa outro workspace excluir a serie', async () => {
      const criada = await createRecurrence().expect(201);
      const bruno = await signUp('bruno@finapp.local');

      await request(app.getHttpServer())
        .delete(`/api/recurrences/${criada.body.id}`)
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(404);
    });
  });
});
