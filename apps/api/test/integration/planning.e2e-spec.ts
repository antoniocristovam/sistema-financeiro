import { NotificationType, WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CheckBudgetAlertsUseCase } from '@/modules/budget/core/application/use-cases/manage-budgets';
import { PrismaService } from '@/shared/database/prisma.service';
import { MonthReference } from '@/shared/domain/value-objects/month-reference';

import { createTestApp } from './app-factory';

/** Dia 10 dos ultimos tres meses, do mais antigo para o mais novo. */
function lastThreeMonths(): string[] {
  const now = new Date();

  return [2, 1, 0].map((back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 10));

    return date.toISOString().slice(0, 10);
  });
}

const month = (value: string): MonthReference => {
  const result = MonthReference.create(value);
  if (result.isLeft()) throw new Error(`Mes invalido: ${value}`);
  return result.value;
};

describe('Orcamentos e metas (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let checkAlerts: CheckBudgetAlertsUseCase;

  let token: string;
  let workspaceId: string;
  let userId: string;
  let checkingId: string;
  let savingsId: string;
  let parentCategoryId: string;
  let childCategoryId: string;
  let otherCategoryId: string;

  const MONTH = '2026-03';

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    close = testApp.close;
    prisma = app.get(PrismaService);
    checkAlerts = app.get(CheckBudgetAlertsUseCase);
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

  const spend = (amountInCents: number, categoryId: string | null, date = `${MONTH}-10`) =>
    request(app.getHttpServer())
      .post('/api/transactions')
      .set(auth())
      .send({
        type: 'EXPENSE',
        accountId: checkingId,
        categoryId,
        amountInCents,
        date,
        description: 'Compra',
        status: 'SETTLED',
      })
      .expect(201);

  const createBudget = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/budgets').set(auth()).send(body);

  const listBudgets = (m = MONTH) =>
    request(app.getHttpServer()).get(`/api/budgets?month=${m}`).set(auth()).expect(200);

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;

    userId = (
      await prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId, role: 'OWNER' },
      })
    ).userId;

    const checking = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Conta corrente', type: 'CHECKING', initialBalanceInCents: 1_000_000 })
      .expect(201);

    checkingId = checking.body.id;

    const savings = await request(app.getHttpServer())
      .post('/api/accounts')
      .set(auth())
      .send({ name: 'Reserva', type: 'SAVINGS', initialBalanceInCents: 0 })
      .expect(201);

    savingsId = savings.body.id;

    const parent = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Alimentacao', type: 'EXPENSE' })
      .expect(201);

    parentCategoryId = parent.body.id;

    const child = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Mercado', type: 'EXPENSE', parentId: parentCategoryId })
      .expect(201);

    childCategoryId = child.body.id;

    const other = await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth())
      .send({ name: 'Transporte', type: 'EXPENSE' })
      .expect(201);

    otherCategoryId = other.body.id;
  });

  describe('orcamento', () => {
    it('a categoria-mae inclui as filhas no consumo', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await spend(30_000, parentCategoryId);
      await spend(20_000, childCategoryId);

      const response = await listBudgets();

      /*
       * Orcar "Alimentacao" e ver so o que foi lancado exatamente nela --
       * ignorando Mercado -- daria um consumo proximo de zero e um orcamento
       * inutil.
       */
      expect(response.body.items[0].consumedInCents).toBe(50_000);
      expect(response.body.items[0].percent).toBe(50);
      expect(response.body.items[0].band).toBe('OK');
    });

    it('REGRA 6: despesa dividida consome a MINHA parte, nao o valor cheio', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      const compra = await spend(60_000, parentCategoryId);

      /*
       * R$ 600 saiu da conta e afeta o SALDO. Mas a conta foi dividida com
       * outra pessoa: o orcamento mede o que e' meu, R$ 300. Contar o valor
       * cheio estouraria o orcamento por uma despesa que so metade e' minha.
       */
      await prisma.expenseSplit.createMany({
        data: [
          {
            workspaceId,
            transactionId: compra.body.id,
            participantName: 'Ana',
            participantUserId: userId,
            shareType: 'EQUAL',
            amountInCents: 30_000,
            isOwner: true,
          },
          {
            workspaceId,
            transactionId: compra.body.id,
            participantName: 'Bruno',
            shareType: 'EQUAL',
            amountInCents: 30_000,
            isOwner: false,
          },
        ],
      });

      const response = await listBudgets();

      expect(response.body.items[0].consumedInCents).toBe(30_000);

      // O saldo continua refletindo o valor CHEIO: os R$ 600 sairam mesmo.
      const contas = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      expect(contas.body.accounts.find((a: { id: string }) => a.id === checkingId).balanceInCents).toBe(
        1_000_000 - 60_000,
      );
    });

    it('trunca o percentual para baixo, sem antecipar a faixa', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      // 79,999% NAO pode virar 80%: a barra ficaria ambar antes da hora.
      await spend(79_999, parentCategoryId);

      const response = await listBudgets();

      expect(response.body.items[0].percent).toBe(79);
      expect(response.body.items[0].band).toBe('OK');
    });

    it('mostra o gasto FORA de qualquer orcamento', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await spend(10_000, parentCategoryId);
      await spend(25_000, otherCategoryId);
      await spend(5_000, null);

      const response = await listBudgets();

      // Sem este numero, um orcamento em dia daria a impressao de mes sob
      // controle enquanto o gasto escorre pelas outras categorias.
      expect(response.body.unbudgetedInCents).toBe(30_000);
      expect(response.body.totalConsumedInCents).toBe(10_000);
    });

    it('rollover soma a sobra do mes anterior', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: '2026-02',
        limitInCents: 100_000,
        rollover: true,
      }).expect(201);

      await spend(40_000, parentCategoryId, '2026-02-10');

      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
        rollover: true,
      }).expect(201);

      const response = await listBudgets();

      // Sobraram R$ 600 em fevereiro: marco vale R$ 1.600.
      expect(response.body.items[0].carryOverInCents).toBe(60_000);
      expect(response.body.items[0].effectiveLimitInCents).toBe(160_000);
    });

    it('estouro do mes anterior NAO vira divida', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: '2026-02',
        limitInCents: 100_000,
        rollover: true,
      }).expect(201);

      await spend(150_000, parentCategoryId, '2026-02-10');

      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
        rollover: true,
      }).expect(201);

      const response = await listBudgets();

      // Herdar o negativo puniria duas vezes pelo mesmo gasto.
      expect(response.body.items[0].carryOverInCents).toBe(0);
      expect(response.body.items[0].effectiveLimitInCents).toBe(100_000);
    });

    it('recusa orcamento em categoria de receita', async () => {
      const receita = await request(app.getHttpServer())
        .post('/api/categories')
        .set(auth())
        .send({ name: 'Salario', type: 'INCOME' })
        .expect(201);

      await createBudget({
        categoryId: receita.body.id,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(400);
    });

    it('recusa dois orcamentos da mesma categoria no mesmo mes', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 50_000,
      }).expect(409);
    });

    it('copia os orcamentos de um mes para outro sem sobrescrever', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await createBudget({
        categoryId: otherCategoryId,
        referenceMonth: MONTH,
        limitInCents: 40_000,
      }).expect(201);

      // O destino ja tem um limite ajustado a mao.
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: '2026-04',
        limitInCents: 250_000,
      }).expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/budgets/copy')
        .set(auth())
        .send({ from: MONTH, to: '2026-04' })
        .expect(201);

      expect(response.body.copied).toBe(1);

      const abril = await listBudgets('2026-04');
      const alimentacao = abril.body.items.find(
        (item: { category: { id: string } }) => item.category.id === parentCategoryId,
      );

      // Sobrescrever em silencio apagaria uma decisao consciente.
      expect(alimentacao.limitInCents).toBe(250_000);
      expect(abril.body.items).toHaveLength(2);
    });

    it('nao vaza orcamento de outro workspace', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      const bruno = await signUp('bruno@finapp.local');

      const response = await request(app.getHttpServer())
        .get(`/api/budgets?month=${MONTH}`)
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(200);

      expect(response.body.items).toHaveLength(0);
    });
  });

  describe('alertas de orcamento', () => {
    it('avisa em 80% e em 100%, UMA vez cada', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await spend(85_000, parentCategoryId);

      const primeira = await checkAlerts.execute(month(MONTH));
      const segunda = await checkAlerts.execute(month(MONTH));

      expect(primeira.notificationsCreated).toBe(1);
      // Sem isto, cada compra acima de 80% renderia um aviso novo.
      expect(segunda.notificationsCreated).toBe(0);

      await spend(20_000, parentCategoryId);

      const terceira = await checkAlerts.execute(month(MONTH));

      // Cruzou os 100%: aviso NOVO, de outro limiar.
      expect(terceira.notificationsCreated).toBe(1);

      const quarta = await checkAlerts.execute(month(MONTH));
      expect(quarta.notificationsCreated).toBe(0);

      const caixa = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth())
        .expect(200);

      const tipos = caixa.body.items.map((item: { type: string }) => item.type);

      expect(tipos).toContain(NotificationType.BUDGET_THRESHOLD_REACHED);
      expect(tipos).toContain(NotificationType.BUDGET_EXCEEDED);
      expect(caixa.body.items).toHaveLength(2);
    });

    it('nao avisa abaixo do limiar', async () => {
      await createBudget({
        categoryId: parentCategoryId,
        referenceMonth: MONTH,
        limitInCents: 100_000,
      }).expect(201);

      await spend(79_999, parentCategoryId);

      const report = await checkAlerts.execute(month(MONTH));

      expect(report.notificationsCreated).toBe(0);
    });
  });

  describe('metas', () => {
    const createGoal = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/goals').set(auth()).send(body);

    const contribute = (goalId: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/goals/${goalId}/contributions`)
        .set(auth())
        .send(body);

    it('projeta a conclusao pelo ritmo dos aportes', async () => {
      const goal = await createGoal({
        name: 'Viagem',
        targetAmountInCents: 600_000,
      }).expect(201);

      /*
       * A janela da projecao e' relativa a HOJE (tres meses para tras), entao
       * as datas precisam acompanhar o relogio -- datas fixas no passado cairiam
       * fora da janela e a media daria zero.
       */
      for (const date of lastThreeMonths()) {
        await contribute(goal.body.id, { amountInCents: 100_000, date }).expect(201);
      }

      const response = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      expect(response.body.savedInCents).toBe(300_000);
      expect(response.body.remainingInCents).toBe(300_000);
      expect(response.body.basisPoints).toBe(5_000);
      expect(response.body.monthlyAverageInCents).toBe(100_000);
      expect(response.body.monthsRemaining).toBe(3);
      expect(response.body.estimatedCompletion).not.toBeNull();
    });

    it('sem aporte NAO inventa data de conclusao', async () => {
      const goal = await createGoal({
        name: 'Carro',
        targetAmountInCents: 5_000_000,
      }).expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      // Mostrar uma data inventada e' pior do que admitir que nao da para saber.
      expect(response.body.estimatedCompletion).toBeNull();
      expect(response.body.monthsRemaining).toBeNull();
    });

    it('com prazo, calcula o aporte mensal necessario', async () => {
      const goal = await createGoal({
        name: 'Notebook',
        targetAmountInCents: 600_000,
        deadline: '2026-09-30',
      }).expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      expect(response.body.requiredMonthlyInCents).toBeGreaterThan(0);
    });

    it('aporte com conta vinculada gera TRANSFERENCIA de verdade', async () => {
      const goal = await createGoal({
        name: 'Reserva de emergencia',
        targetAmountInCents: 1_000_000,
        linkedAccountId: savingsId,
      }).expect(201);

      await contribute(goal.body.id, {
        amountInCents: 50_000,
        fromAccountId: checkingId,
        date: `${MONTH}-15`,
      }).expect(201);

      const contas = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      const corrente = contas.body.accounts.find((a: { id: string }) => a.id === checkingId);
      const reserva = contas.body.accounts.find((a: { id: string }) => a.id === savingsId);

      expect(corrente.balanceInCents).toBe(1_000_000 - 50_000);
      expect(reserva.balanceInCents).toBe(50_000);

      // Guardar dinheiro NAO e' gastar: fora de receitas e despesas (regra 4).
      const extrato = await request(app.getHttpServer())
        .get('/api/transactions?limit=50')
        .set(auth())
        .expect(200);

      expect(extrato.body.summary.expenseInCents).toBe(0);
    });

    it('aporte SEM conta vinculada e apenas registro de progresso', async () => {
      const goal = await createGoal({
        name: 'CDB no banco',
        targetAmountInCents: 1_000_000,
      }).expect(201);

      await contribute(goal.body.id, { amountInCents: 50_000 }).expect(201);

      const contas = await request(app.getHttpServer())
        .get('/api/accounts')
        .set(auth())
        .expect(200);

      // Nenhum saldo muda: o dinheiro mora fora do app.
      expect(
        contas.body.accounts.find((a: { id: string }) => a.id === checkingId).balanceInCents,
      ).toBe(1_000_000);

      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(0);
    });

    it('recusa origem em meta sem conta vinculada', async () => {
      const goal = await createGoal({
        name: 'CDB',
        targetAmountInCents: 1_000_000,
      }).expect(201);

      await contribute(goal.body.id, {
        amountInCents: 50_000,
        fromAccountId: checkingId,
      }).expect(400);
    });

    it('exige a origem quando a meta tem conta vinculada', async () => {
      const goal = await createGoal({
        name: 'Reserva',
        targetAmountInCents: 1_000_000,
        linkedAccountId: savingsId,
      }).expect(201);

      await contribute(goal.body.id, { amountInCents: 50_000 }).expect(400);
    });

    it('avisa quando a meta e alcancada, uma unica vez', async () => {
      const goal = await createGoal({
        name: 'Fone novo',
        targetAmountInCents: 50_000,
      }).expect(201);

      const primeira = await contribute(goal.body.id, { amountInCents: 30_000 }).expect(201);
      const segunda = await contribute(goal.body.id, { amountInCents: 25_000 }).expect(201);
      const terceira = await contribute(goal.body.id, { amountInCents: 10_000 }).expect(201);

      expect(primeira.body.achieved).toBe(false);
      expect(segunda.body.achieved).toBe(true);
      // Ja estava atingida: nao avisa de novo.
      expect(terceira.body.achieved).toBe(false);

      const caixa = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(auth())
        .expect(200);

      const alcancadas = caixa.body.items.filter(
        (item: { type: string }) => item.type === NotificationType.GOAL_REACHED,
      );

      expect(alcancadas).toHaveLength(1);
    });

    it('remover aporte desfaz a transferencia e a conquista', async () => {
      const goal = await createGoal({
        name: 'Reserva',
        targetAmountInCents: 50_000,
        linkedAccountId: savingsId,
      }).expect(201);

      await contribute(goal.body.id, {
        amountInCents: 60_000,
        fromAccountId: checkingId,
      }).expect(201);

      const detalhe = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      expect(detalhe.body.achievedAt).not.toBeNull();

      await request(app.getHttpServer())
        .delete(`/api/goals/${goal.body.id}/contributions/${detalhe.body.contributions[0].id}`)
        .set(auth())
        .expect(204);

      // O par inteiro sai: meia transferencia deixaria o saldo errado.
      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(0);

      const depois = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      // Manter a medalha com o dinheiro de volta seria mentir.
      expect(depois.body.achievedAt).toBeNull();
      expect(depois.body.savedInCents).toBe(0);
    });

    it('aumentar o alvo reabre a meta concluida', async () => {
      const goal = await createGoal({
        name: 'Fone',
        targetAmountInCents: 50_000,
      }).expect(201);

      await contribute(goal.body.id, { amountInCents: 50_000 }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/goals/${goal.body.id}`)
        .set(auth())
        .send({ targetAmountInCents: 100_000 })
        .expect(204);

      const response = await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth())
        .expect(200);

      expect(response.body.achievedAt).toBeNull();
      expect(response.body.basisPoints).toBe(5_000);
    });

    it('recusa cartao de credito como conta de reserva', async () => {
      const cartao = await request(app.getHttpServer())
        .post('/api/accounts')
        .set(auth())
        .send({
          name: 'Cartao',
          type: 'CREDIT_CARD',
          initialBalanceInCents: 0,
          creditCard: { limitInCents: 100_000, closingDay: 10, dueDay: 20 },
        })
        .expect(201);

      await createGoal({
        name: 'Reserva',
        targetAmountInCents: 100_000,
        linkedAccountId: cartao.body.id,
      }).expect(400);
    });

    it('nao vaza meta de outro workspace', async () => {
      const goal = await createGoal({
        name: 'Viagem',
        targetAmountInCents: 100_000,
      }).expect(201);

      const bruno = await signUp('bruno@finapp.local');

      await request(app.getHttpServer())
        .get(`/api/goals/${goal.body.id}`)
        .set(auth(bruno.token, bruno.workspaceId))
        .expect(404);
    });
  });
});
