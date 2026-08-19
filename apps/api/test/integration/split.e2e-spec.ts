import { WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '@/shared/database/prisma.service';

import { createTestApp } from './app-factory';

describe('Divisao de despesas e acertos (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  let token: string;
  let workspaceId: string;
  let userId: string;
  let accountId: string;
  let categoryId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    close = testApp.close;
    prisma = app.get(PrismaService);
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

  async function spend(amountInCents: number, date = '2026-03-10'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/transactions')
      .set(auth())
      .send({
        type: 'EXPENSE',
        accountId,
        categoryId,
        amountInCents,
        date,
        description: 'Jantar',
        status: 'SETTLED',
      })
      .expect(201);

    return response.body.id;
  }

  const splitOf = (transactionId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/transactions/${transactionId}/splits`)
      .set(auth())
      .send(body);

  const balances = () =>
    request(app.getHttpServer()).get('/api/splits/balances').set(auth()).expect(200);

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;

    userId = (
      await prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId, role: 'OWNER' },
      })
    ).userId;

    const account = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Conta corrente', type: 'CHECKING', initialBalanceInCents: 1_000_000 })
      .expect(201);

    accountId = account.body.id;

    const category = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Restaurante', type: 'EXPENSE' })
      .expect(201);

    categoryId = category.body.id;
  });

  describe('regra 7: a soma das partes fecha exatamente', () => {
    it('divisao igual distribui os centavos de resto', async () => {
      const transactionId = await spend(10_000);

      const response = await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
          { name: 'Carla', isOwner: false },
        ],
      }).expect(201);

      const partes = response.body.splits.map((split: { amountInCents: number }) => split.amountInCents);

      // R$ 100,00 em 3 nao da tres vezes 33,33 -- isso seria R$ 99,99.
      expect(partes.sort((a: number, b: number) => b - a)).toEqual([3_334, 3_333, 3_333]);
      expect(partes.reduce((a: number, b: number) => a + b, 0)).toBe(10_000);
    });

    it('percentual em pontos-base fecha em centavos inteiros', async () => {
      const transactionId = await spend(10_000);

      const response = await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { participantUserId: userId, name: 'Ana', shareValue: 3_333, isOwner: true },
          { name: 'Bruno', shareValue: 3_333, isOwner: false },
          { name: 'Carla', shareValue: 3_334, isOwner: false },
        ],
      }).expect(201);

      const soma = response.body.splits.reduce(
        (total: number, split: { amountInCents: number }) => total + split.amountInCents,
        0,
      );

      expect(soma).toBe(10_000);
    });

    it('recusa percentuais que nao somam 100%', async () => {
      const transactionId = await spend(10_000);

      await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { participantUserId: userId, name: 'Ana', shareValue: 5_000, isOwner: true },
          { name: 'Bruno', shareValue: 4_000, isOwner: false },
        ],
      }).expect(400);
    });

    it('recusa valores fixos que nao fecham com a despesa', async () => {
      const transactionId = await spend(10_000);

      await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [
          { participantUserId: userId, name: 'Ana', shareValue: 5_000, isOwner: true },
          { name: 'Bruno', shareValue: 4_000, isOwner: false },
        ],
      }).expect(400);
    });

    it('recusa divisao sem dono e com mais de um dono', async () => {
      const transactionId = await spend(10_000);

      await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { name: 'Ana', isOwner: false },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(400);

      await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: true },
        ],
      }).expect(400);
    });

    it('recusa a mesma pessoa duas vezes', async () => {
      const transactionId = await spend(10_000);

      // Dois saldos da mesma pessoa, cada um com metade da divida.
      await splitOf(transactionId, {
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', email: 'bruno@x.com', isOwner: false },
          { name: 'Bruno Silva', email: 'bruno@x.com', isOwner: false },
        ],
      }).expect(400);
    });

    it('so despesa pode ser dividida', async () => {
      const receita = await request(app.getHttpServer())
        .post('/api/transactions')
        .set(auth())
        .send({
          type: 'INCOME',
          accountId,
          amountInCents: 10_000,
          date: '2026-03-10',
          description: 'Salario',
          status: 'SETTLED',
        })
        .expect(201);

      await splitOf(receita.body.id, {
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(400);
    });
  });

  describe('regra 6: valor cheio no saldo, minha parte no relatorio', () => {
    it('o saldo NAO muda quando a despesa e dividida', async () => {
      const transactionId = await spend(60_000);

      const antes = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      await splitOf(transactionId, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const depois = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      const saldo = (body: { accounts: { id: string; balanceInCents: number }[] }) =>
        body.accounts.find((account) => account.id === accountId)!.balanceInCents;

      // Os R$ 600 sairam da conta inteiros: dividir o custo nao devolve dinheiro.
      expect(saldo(depois.body)).toBe(saldo(antes.body));
      expect(saldo(depois.body)).toBe(1_000_000 - 60_000);
    });

    it('o extrato mostra o valor cheio E a minha parte', async () => {
      const transactionId = await spend(60_000);

      await splitOf(transactionId, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const extrato = await request(app.getHttpServer())
        .get('/api/transactions?limit=10')
        .set(auth())
        .expect(200);

      const lancamento = extrato.body.items.find(
        (item: { id: string }) => item.id === transactionId,
      );

      expect(lancamento.amountInCents).toBe(60_000);
      expect(lancamento.ownerShareInCents).toBe(30_000);
      expect(lancamento.splitCount).toBe(2);
    });

    it('o ORCAMENTO conta a minha parte, nao o valor cheio', async () => {
      await request(app.getHttpServer())
        .post('/api/budgets')
        .set(auth())
        .send({ categoryId, referenceMonth: '2026-03', limitInCents: 100_000 })
        .expect(201);

      const transactionId = await spend(60_000);

      const antes = await request(app.getHttpServer())
        .get('/api/budgets?month=2026-03')
        .set(auth())
        .expect(200);

      expect(antes.body.items[0].consumedInCents).toBe(60_000);

      await splitOf(transactionId, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const depois = await request(app.getHttpServer())
        .get('/api/budgets?month=2026-03')
        .set(auth())
        .expect(200);

      // Aqui as duas regras se encontram: o saldo viu R$ 600, o orcamento ve
      // R$ 300.
      expect(depois.body.items[0].consumedInCents).toBe(30_000);
    });

    it('desfazer a divisao devolve o valor cheio ao orcamento', async () => {
      await request(app.getHttpServer())
        .post('/api/budgets')
        .set(auth())
        .send({ categoryId, referenceMonth: '2026-03', limitInCents: 100_000 })
        .expect(201);

      const transactionId = await spend(60_000);

      await splitOf(transactionId, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/transactions/${transactionId}/splits`)
        .set(auth())
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/api/budgets?month=2026-03')
        .set(auth())
        .expect(200);

      expect(response.body.items[0].consumedInCents).toBe(60_000);
    });

    it('redividir substitui a divisao inteira', async () => {
      const transactionId = await spend(90_000);

      await splitOf(transactionId, {
        amountInCents: 90_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const response = await splitOf(transactionId, {
        amountInCents: 90_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
          { name: 'Carla', isOwner: false },
        ],
      }).expect(201);

      expect(response.body.splits).toHaveLength(3);
      expect(response.body.ownerShareInCents).toBe(30_000);
      expect(await prisma.expenseSplit.count({ where: { transactionId } })).toBe(3);
    });
  });

  describe('saldos', () => {
    it('mostra quanto cada pessoa me deve', async () => {
      const jantar = await spend(90_000);

      await splitOf(jantar, {
        amountInCents: 90_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
          { name: 'Carla', isOwner: false },
        ],
      }).expect(201);

      const response = await balances();

      expect(response.body.balances).toHaveLength(2);
      expect(response.body.totalToReceiveInCents).toBe(60_000);
      expect(response.body.totalToPayInCents).toBe(0);

      const bruno = response.body.balances.find(
        (balance: { participantName: string }) => balance.participantName === 'Bruno',
      );

      expect(bruno.netInCents).toBe(30_000);
      expect(bruno.owedToMeInCents).toBe(30_000);
      expect(bruno.pendingSplitCount).toBe(1);
    });

    it('a parte de quem pagou nao entra no saldo', async () => {
      const jantar = await spend(60_000);

      await splitOf(jantar, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const response = await balances();

      // Ana nao deve para si mesma.
      expect(
        response.body.balances.some(
          (balance: { participantUserId: string | null }) => balance.participantUserId === userId,
        ),
      ).toBe(false);
    });

    it('acumula varias despesas da mesma pessoa', async () => {
      for (const valor of [30_000, 20_000]) {
        const transactionId = await spend(valor);

        await splitOf(transactionId, {
          amountInCents: valor,
          shareType: 'EQUAL',
          participants: [
            { participantUserId: userId, name: 'Ana', isOwner: true },
            { name: 'Bruno', isOwner: false },
          ],
        }).expect(201);
      }

      const response = await balances();
      const bruno = response.body.balances[0];

      expect(bruno.netInCents).toBe(25_000);
      expect(bruno.pendingSplitCount).toBe(2);
    });
  });

  describe('acertos', () => {
    async function dividir(valor = 60_000): Promise<string> {
      const transactionId = await spend(valor);

      await splitOf(transactionId, {
        amountInCents: valor,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', email: 'bruno@x.com', isOwner: false },
        ],
      }).expect(201);

      return transactionId;
    }

    const settle = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/splits/settlements').set(auth()).send(body);

    it('quita a divisao e zera o saldo', async () => {
      await dividir();

      const response = await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        participantEmail: 'bruno@x.com',
        amountInCents: 30_000,
        direction: 'RECEIVED',
      }).expect(201);

      expect(response.body.settledSplits).toBe(1);

      const depois = await balances();

      expect(depois.body.balances).toHaveLength(0);
      expect(depois.body.totalToReceiveInCents).toBe(0);
    });

    it('acerto PARCIAL deixa o resto pendente', async () => {
      /*
       * Duas despesas em dias diferentes: R$ 300 em 05/03 e R$ 200 em 12/03.
       * O Bruno deve 150 + 100 = R$ 250.
       *
       * As datas distintas sao o que da sentido a "mais antiga primeiro" -- com
       * as duas no mesmo dia, a ordem seria a do id e o teste passaria a
       * verificar coincidencia em vez de regra.
       */
      for (const [valor, data] of [
        [30_000, '2026-03-05'],
        [20_000, '2026-03-12'],
      ] as const) {
        const transactionId = await spend(valor, data);

        await splitOf(transactionId, {
          amountInCents: valor,
          shareType: 'EQUAL',
          participants: [
            { participantUserId: userId, name: 'Ana', isOwner: true },
            { name: 'Bruno', email: 'bruno@x.com', isOwner: false },
          ],
        }).expect(201);
      }

      // Paga so o suficiente para a mais antiga.
      const response = await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        participantEmail: 'bruno@x.com',
        amountInCents: 15_000,
        direction: 'RECEIVED',
      }).expect(201);

      expect(response.body.settledSplits).toBe(1);

      const depois = await balances();

      // Sobra a segunda, inteira: uma linha nao e' quitada pela metade.
      expect(depois.body.balances[0].netInCents).toBe(10_000);
      expect(depois.body.balances[0].pendingSplitCount).toBe(1);
    });

    it('paga uma despesa MENOR sem quitar a mais antiga, que nao cabe', async () => {
      /*
       * Aconteceu num passo a passo: o Bruno devia R$ 162,50 de um mercado e
       * R$ 33,33 de um jantar, pagou exatamente R$ 33,33, e o acerto registrou
       * o dinheiro sem quitar nada -- o saldo continuava cheio, com um recibo
       * ao lado dizendo que tinha sido pago. Agora a busca segue procurando uma
       * linha que caiba em vez de parar na primeira que nao cabe.
       */
      for (const [valor, data] of [
        [30_000, '2026-03-05'],
        [4_000, '2026-03-12'],
      ] as const) {
        const transactionId = await spend(valor, data);

        await splitOf(transactionId, {
          amountInCents: valor,
          shareType: 'EQUAL',
          participants: [
            { participantUserId: userId, name: 'Ana', isOwner: true },
            { name: 'Bruno', email: 'bruno@x.com', isOwner: false },
          ],
        }).expect(201);
      }

      const response = await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        participantEmail: 'bruno@x.com',
        amountInCents: 2_000,
        direction: 'RECEIVED',
      }).expect(201);

      expect(response.body.settledSplits).toBe(1);

      const depois = await balances();

      expect(depois.body.balances[0].netInCents).toBe(15_000);
    });

    it('registra o lancamento quando pedido', async () => {
      await dividir();

      const antes = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        participantEmail: 'bruno@x.com',
        amountInCents: 30_000,
        direction: 'RECEIVED',
        accountId,
        createTransaction: true,
        date: '2026-03-20',
      }).expect(201);

      const depois = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      const saldo = (body: { accounts: { id: string; balanceInCents: number }[] }) =>
        body.accounts.find((account) => account.id === accountId)!.balanceInCents;

      expect(saldo(depois.body) - saldo(antes.body)).toBe(30_000);
    });

    it('NAO registra lancamento quando o acerto foi em especie', async () => {
      await dividir();

      const antes = await prisma.transaction.count({ where: { workspaceId } });

      await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        amountInCents: 30_000,
        direction: 'RECEIVED',
      }).expect(201);

      // Inventar um movimento que a conta nunca viu seria pior do que nao
      // registrar nada.
      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(antes);
    });

    it('exige a conta para registrar o lancamento', async () => {
      await dividir();

      await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        amountInCents: 30_000,
        direction: 'RECEIVED',
        createTransaction: true,
      }).expect(400);
    });

    it('guarda o historico com quem pagou e quem recebeu', async () => {
      await dividir();

      await settle({
        participantKey: 'email:bruno@x.com',
        participantName: 'Bruno',
        amountInCents: 30_000,
        direction: 'RECEIVED',
        note: 'Pix',
      }).expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/splits/settlements')
        .set(auth())
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].fromName).toBe('Bruno');
      // O outro lado e' o NOME de quem recebeu, nao o e-mail: o historico e'
      // lido meses depois e precisa ser uma frase legivel.
      expect(response.body.items[0].toName).toBe('Ana');
      expect(response.body.items[0].note).toBe('Pix');
      expect(response.body.items[0].settledSplitCount).toBe(1);
    });
  });

  describe('escopo', () => {
    it('nao divide lancamento de outro workspace', async () => {
      const transactionId = await spend(10_000);
      const bruno = await signUp('bruno@finapp.local');

      await request(app.getHttpServer())
        .post(`/api/transactions/${transactionId}/splits`)
        .set(auth(bruno.token, bruno.workspaceId))
        .send({
          amountInCents: 10_000,
          shareType: 'EQUAL',
          participants: [
            { name: 'Bruno', isOwner: true },
            { name: 'Carla', isOwner: false },
          ],
        })
        .expect(404);
    });

    it('nao vaza saldo de outro workspace', async () => {
      const transactionId = await spend(60_000);

      await splitOf(transactionId, {
        amountInCents: 60_000,
        shareType: 'EQUAL',
        participants: [
          { participantUserId: userId, name: 'Ana', isOwner: true },
          { name: 'Bruno', isOwner: false },
        ],
      }).expect(201);

      const bruno = await signUp('bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .get('/api/splits/balances')
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(200);

      expect(response.body.balances).toHaveLength(0);
    });
  });
});
