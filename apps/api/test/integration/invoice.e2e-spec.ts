import { NotificationType, WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CloseInvoicesUseCase,
  SendInvoiceRemindersUseCase,
} from '@/modules/account/core/application/use-cases/manage-invoices';
import { PrismaService } from '@/shared/database/prisma.service';
import { CalendarDate } from '@/shared/domain/value-objects/calendar-date';

import { createTestApp } from './app-factory';

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

describe('Cartoes e faturas (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let closeInvoices: CloseInvoicesUseCase;
  let remindInvoices: SendInvoiceRemindersUseCase;

  let token: string;
  let workspaceId: string;
  let checkingId: string;
  let cardId: string;
  let categoryId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    close = testApp.close;
    prisma = app.get(PrismaService);
    closeInvoices = app.get(CloseInvoicesUseCase);
    remindInvoices = app.get(SendInvoiceRemindersUseCase);
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

  const buy = (body: Record<string, unknown>, as = auth()) =>
    request(app.getHttpServer()).post('/api/transactions').set(as).send(body);

  const openInvoiceOf = async (card = cardId) => {
    const cards = await request(app.getHttpServer()).get('/api/cards').set(auth()).expect(200);

    return cards.body.cards.find((entry: { accountId: string }) => entry.accountId === card);
  };

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;

    const checking = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Conta corrente', type: 'CHECKING', initialBalanceInCents: 500_000 })
      .expect(201);

    checkingId = checking.body.id;

    const card = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({
        name: 'Cartao Roxo',
        type: 'CREDIT_CARD',
        initialBalanceInCents: 0,
        creditCard: { limitInCents: 500_000, closingDay: 20, dueDay: 28 },
      })
      .expect(201);

    cardId = card.body.id;

    const category = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Mercado', type: 'EXPENSE' })
      .expect(201);

    categoryId = category.body.id;
  });

  describe('regra 5: compra no cartao nao debita a conta', () => {
    it('a compra entra na fatura e NAO mexe no saldo da conta corrente', async () => {
      const antes = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const saldoAntes = antes.body.accounts.find(
        (a: { id: string }) => a.id === checkingId,
      ).balanceInCents;

      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        categoryId,
        amountInCents: 25_000,
        date: '2026-03-15',
        description: 'Compra no cartao',
        status: 'SETTLED',
      }).expect(201);

      const depois = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const saldoDepois = depois.body.accounts.find(
        (a: { id: string }) => a.id === checkingId,
      ).balanceInCents;

      // O dinheiro continua na conta: ele so sai quando a fatura for paga.
      expect(saldoDepois).toBe(saldoAntes);

      const transacao = await prisma.transaction.findFirstOrThrow({
        where: { workspaceId, accountId: cardId },
        select: { invoiceId: true },
      });

      expect(transacao.invoiceId).not.toBeNull();
    });

    it('a fatura nasce da PRIMEIRA compra do ciclo', async () => {
      expect(await prisma.invoice.count()).toBe(0);

      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 10_000,
        date: '2026-03-15',
        description: 'Primeira',
        status: 'SETTLED',
      }).expect(201);

      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 5_000,
        date: '2026-03-16',
        description: 'Segunda',
        status: 'SETTLED',
      }).expect(201);

      // Duas compras no mesmo ciclo, UMA fatura.
      expect(await prisma.invoice.count()).toBe(1);

      const fatura = await prisma.invoice.findFirstOrThrow();

      expect(fatura.totalInCents).toBe(15_000);
    });

    it('compra DEPOIS do fechamento cai no ciclo seguinte', async () => {
      // Fechamento dia 20: 20/03 ainda entra, 21/03 ja e' abril.
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 10_000,
        date: '2026-03-20',
        description: 'No dia do fechamento',
        status: 'SETTLED',
      }).expect(201);

      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 7_000,
        date: '2026-03-21',
        description: 'Um dia depois',
        status: 'SETTLED',
      }).expect(201);

      const faturas = await prisma.invoice.findMany({ orderBy: { referenceMonth: 'asc' } });

      expect(faturas).toHaveLength(2);
      expect(faturas[0]?.referenceMonth.toISOString().slice(0, 7)).toBe('2026-03');
      expect(faturas[0]?.totalInCents).toBe(10_000);
      expect(faturas[1]?.referenceMonth.toISOString().slice(0, 7)).toBe('2026-04');
      expect(faturas[1]?.totalInCents).toBe(7_000);
    });

    it('editar o valor da compra recalcula a fatura', async () => {
      const compra = await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 10_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${compra.body.id}`)
        .set(auth())
        .send({ amountInCents: 33_333 })
        .expect(200);

      const fatura = await prisma.invoice.findFirstOrThrow();

      expect(fatura.totalInCents).toBe(33_333);
    });

    it('excluir a compra encolhe a fatura', async () => {
      const compra = await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 10_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 4_000,
        date: '2026-03-16',
        description: 'Outra',
        status: 'SETTLED',
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/transactions/${compra.body.id}`)
        .set(auth())
        .expect(204);

      const fatura = await prisma.invoice.findFirstOrThrow();

      expect(fatura.totalInCents).toBe(4_000);
    });

    it('despesa em conta comum NAO vira fatura', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: checkingId,
        amountInCents: 8_000,
        date: '2026-03-15',
        description: 'Padaria',
        status: 'SETTLED',
      }).expect(201);

      expect(await prisma.invoice.count()).toBe(0);
    });
  });

  describe('limite', () => {
    it('comprometido e disponivel refletem a fatura aberta', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 120_000,
        date: '2026-03-15',
        description: 'Compra grande',
        status: 'SETTLED',
      }).expect(201);

      const card = await openInvoiceOf();

      expect(card.usedLimitInCents).toBe(120_000);
      expect(card.availableLimitInCents).toBe(380_000);
      // A compra e' de um ciclo antigo; a tela ainda mostra a fatura de onde a
      // divida vem, em vez de um cartao comprometido sem nada em que clicar.
      expect(card.openInvoice.totalInCents).toBe(120_000);
    });
  });

  describe('fechamento', () => {
    it('fecha a fatura cujo dia ja passou e congela o valor', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      const report = await closeInvoices.execute(day('2026-03-21'));

      expect(report.invoicesClosed).toBe(1);

      const fatura = await prisma.invoice.findFirstOrThrow();

      expect(fatura.status).toBe('CLOSED');
      expect(fatura.totalInCents).toBe(30_000);
    });

    it('nao fecha fatura de ciclo que ainda esta correndo', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      const report = await closeInvoices.execute(day('2026-03-18'));

      expect(report.invoicesClosed).toBe(0);
    });

    it('rodar o fechamento duas vezes nao muda nada na segunda', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await closeInvoices.execute(day('2026-03-21'));
      const segunda = await closeInvoices.execute(day('2026-03-21'));

      expect(segunda.invoicesClosed).toBe(0);
    });
  });

  describe('pagamento', () => {
    async function faturaFechada(): Promise<string> {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await closeInvoices.execute(day('2026-03-21'));

      return (await prisma.invoice.findFirstOrThrow()).id;
    }

    it('debita a conta corrente e quita a fatura', async () => {
      const invoiceId = await faturaFechada();

      const antes = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const saldoAntes = antes.body.accounts.find(
        (a: { id: string }) => a.id === checkingId,
      ).balanceInCents;

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId, date: '2026-03-28' })
        .expect(201);

      const depois = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const saldoDepois = depois.body.accounts.find(
        (a: { id: string }) => a.id === checkingId,
      ).balanceInCents;

      // AGORA o dinheiro sai: e' este o momento em que o saldo muda (regra 5).
      expect(saldoAntes - saldoDepois).toBe(30_000);

      const fatura = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

      expect(fatura.status).toBe('PAID');
      expect(fatura.paidWithTransactionId).not.toBeNull();
    });

    it('o pagamento e TRANSFERENCIA: nao entra em receitas nem despesas (regra 4)', async () => {
      const invoiceId = await faturaFechada();

      const antes = await request(app.getHttpServer())
        .get('/api/transactions?limit=50')
        .set(auth())
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId, date: '2026-03-28' })
        .expect(201);

      const depois = await request(app.getHttpServer())
        .get('/api/transactions?limit=50')
        .set(auth())
        .expect(200);

      /*
       * A despesa ja foi reconhecida quando a compra entrou na fatura. Se o
       * pagamento tambem contasse como despesa, o mes do vencimento apareceria
       * como um desastre financeiro que nao aconteceu.
       */
      expect(depois.body.summary.expenseInCents).toBe(antes.body.summary.expenseInCents);
      expect(depois.body.summary.incomeInCents).toBe(antes.body.summary.incomeInCents);

      const pernas = await prisma.transaction.findMany({ where: { type: 'TRANSFER' } });

      expect(pernas).toHaveLength(2);
      expect(new Set(pernas.map((leg) => leg.transferLeg))).toEqual(
        new Set(['SOURCE', 'DESTINATION']),
      );
    });

    it('recusa pagar fatura ainda ABERTA', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      const invoiceId = (await prisma.invoice.findFirstOrThrow()).id;

      // Aberta ainda recebe compras: o valor pago nao bateria com o devido.
      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(409);
    });

    it('recusa pagar fatura com outro cartao', async () => {
      const invoiceId = await faturaFechada();

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: cardId })
        .expect(400);
    });

    it('recusa pagar duas vezes', async () => {
      const invoiceId = await faturaFechada();

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(409);
    });

    it('compra lancada depois do pagamento vai para a fatura ABERTA', async () => {
      const invoiceId = await faturaFechada();

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(201);

      // Compra com data do ciclo ja quitado: mexer no total de uma fatura paga
      // faria o valor pago deixar de bater com o devido, para sempre.
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 5_000,
        date: '2026-03-16',
        description: 'Atrasada',
        status: 'SETTLED',
      }).expect(201);

      const paga = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

      expect(paga.totalInCents).toBe(30_000);
      expect(await prisma.invoice.count()).toBe(2);
    });

    it('o limite volta depois do pagamento', async () => {
      const invoiceId = await faturaFechada();

      const antes = await openInvoiceOf();
      expect(antes.usedLimitInCents).toBe(30_000);

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(201);

      const depois = await openInvoiceOf();

      expect(depois.usedLimitInCents).toBe(0);
      expect(depois.availableLimitInCents).toBe(500_000);
    });
  });

  describe('compra parcelada', () => {
    it('cria uma parcela por fatura, fechando o total exatamente', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: cardId,
          categoryId,
          totalAmountInCents: 10_000,
          installments: 3,
          date: '2026-03-15',
          description: 'Geladeira',
        })
        .expect(201);

      // R$ 100,00 em 3x: 33,34 / 33,33 / 33,33. Somar 33,33 tres vezes daria
      // R$ 99,99 -- o centavo que some.
      expect(response.body.installments.map((i: { amountInCents: number }) => i.amountInCents)).toEqual([
        3_334, 3_333, 3_333,
      ]);

      const soma = response.body.installments.reduce(
        (total: number, i: { amountInCents: number }) => total + i.amountInCents,
        0,
      );

      expect(soma).toBe(10_000);

      const faturas = await prisma.invoice.findMany({ orderBy: { referenceMonth: 'asc' } });

      expect(faturas).toHaveLength(3);
      expect(faturas.map((f) => f.totalInCents)).toEqual([3_334, 3_333, 3_333]);
    });

    it('as parcelas caem em meses diferentes, nao todas na data da compra', async () => {
      await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: cardId,
          totalAmountInCents: 120_000,
          installments: 12,
          date: '2026-03-15',
          description: 'Notebook',
        })
        .expect(201);

      const meses = await prisma.invoice.findMany({
        select: { referenceMonth: true },
        orderBy: { referenceMonth: 'asc' },
      });

      expect(meses).toHaveLength(12);
      expect(meses[0]?.referenceMonth.toISOString().slice(0, 7)).toBe('2026-03');
      expect(meses[11]?.referenceMonth.toISOString().slice(0, 7)).toBe('2027-02');
    });

    it('numera as parcelas e liga todas ao mesmo grupo', async () => {
      await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: cardId,
          totalAmountInCents: 30_000,
          installments: 3,
          date: '2026-03-15',
          description: 'Fogao',
        })
        .expect(201);

      const parcelas = await prisma.transaction.findMany({
        where: { workspaceId },
        select: { installmentNumber: true, installmentGroupId: true },
        orderBy: { installmentNumber: 'asc' },
      });

      expect(parcelas.map((p) => p.installmentNumber)).toEqual([1, 2, 3]);
      expect(new Set(parcelas.map((p) => p.installmentGroupId)).size).toBe(1);
    });

    it('recusa parcelamento em conta que nao e cartao', async () => {
      await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: checkingId,
          totalAmountInCents: 30_000,
          installments: 3,
          date: '2026-03-15',
          description: 'Fogao',
        })
        .expect(404);
    });

    it('recusa valor pequeno demais para o numero de parcelas', async () => {
      await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: cardId,
          totalAmountInCents: 2,
          installments: 3,
          date: '2026-03-15',
          description: 'Bala',
        })
        .expect(400);
    });
  });

  describe('detalhe da fatura', () => {
    it('lista os itens com o rotulo da parcela', async () => {
      await request(app.getHttpServer())
        .post('/api/cards/installments')
        .set(auth())
        .send({
          cardAccountId: cardId,
          categoryId,
          totalAmountInCents: 30_000,
          installments: 3,
          date: '2026-03-15',
          description: 'Fogao',
        })
        .expect(201);

      const invoiceId = (
        await prisma.invoice.findFirstOrThrow({ orderBy: { referenceMonth: 'asc' } })
      ).id;

      const response = await request(app.getHttpServer())
        .get(`/api/cards/invoices/${invoiceId}`)
        .set(auth())
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].installmentNumber).toBe(1);
      expect(response.body.items[0].installmentTotal).toBe(3);
      expect(response.body.items[0].category.name).toBe('Mercado');
    });

    it('nao entrega a fatura de outro workspace', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 10_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      const invoiceId = (await prisma.invoice.findFirstOrThrow()).id;
      const bruno = await signUp('bruno@finapp.local');

      await request(app.getHttpServer())
        .get(`/api/cards/invoices/${invoiceId}`)
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(404);
    });
  });

  describe('lembrete de vencimento', () => {
    it('avisa tres dias antes, uma unica vez', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await closeInvoices.execute(day('2026-03-21'));

      // Vencimento dia 28: o aviso sai no dia 25.
      const primeira = await remindInvoices.execute(day('2026-03-25'));
      const segunda = await remindInvoices.execute(day('2026-03-25'));

      expect(primeira.notificationsCreated).toBe(1);
      expect(segunda.notificationsCreated).toBe(0);

      const caixa = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth())
        .expect(200);

      expect(caixa.body.items[0].type).toBe(NotificationType.INVOICE_DUE);
    });

    it('nao avisa sobre fatura ja paga', async () => {
      await buy({
        type: 'EXPENSE',
        accountId: cardId,
        amountInCents: 30_000,
        date: '2026-03-15',
        description: 'Compra',
        status: 'SETTLED',
      }).expect(201);

      await closeInvoices.execute(day('2026-03-21'));

      const invoiceId = (await prisma.invoice.findFirstOrThrow()).id;

      await request(app.getHttpServer())
        .post(`/api/cards/invoices/${invoiceId}/payment`)
        .set(auth())
        .send({ fromAccountId: checkingId })
        .expect(201);

      const report = await remindInvoices.execute(day('2026-03-25'));

      expect(report.notificationsCreated).toBe(0);
    });
  });
});
