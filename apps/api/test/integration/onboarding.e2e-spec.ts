import { WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '@/shared/database/prisma.service';

import { createTestApp } from './app-factory';

describe('Onboarding (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  let accessToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    close = testApp.close;
    prisma = app.get(PrismaService);

    // As sementes do sistema sao globais e nao sao apagadas pelo TRUNCATE de
    // cada teste? Sao -- por isso o seed roda no beforeEach.
  });

  afterAll(async () => {
    await close();
  });

  /** Recria as categorias semente, que o TRUNCATE de cada teste apaga. */
  async function seedSystemCategories(): Promise<void> {
    const roots = [
      { key: 'alimentacao', name: 'Alimentação', icon: 'utensils', color: '#F97316' },
      { key: 'moradia', name: 'Moradia', icon: 'house', color: '#6366F1' },
      { key: 'transporte', name: 'Transporte', icon: 'car', color: '#0EA5E9' },
    ];

    for (const [index, root] of roots.entries()) {
      const created = await prisma.category.create({
        data: {
          workspaceId: null,
          systemKey: root.key,
          name: root.name,
          type: 'EXPENSE',
          icon: root.icon,
          color: root.color,
          sortOrder: index,
        },
      });

      await prisma.category.createMany({
        data: [
          {
            workspaceId: null,
            systemKey: `${root.key}.um`,
            name: `${root.name} um`,
            type: 'EXPENSE',
            parentId: created.id,
            sortOrder: 0,
          },
          {
            workspaceId: null,
            systemKey: `${root.key}.dois`,
            name: `${root.name} dois`,
            type: 'EXPENSE',
            parentId: created.id,
            sortOrder: 1,
          },
        ],
      });
    }

    await prisma.category.create({
      data: {
        workspaceId: null,
        systemKey: 'salario',
        name: 'Salário',
        type: 'INCOME',
        icon: 'wallet',
        color: '#22C55E',
        sortOrder: 0,
      },
    });
  }

  beforeEach(async () => {
    await seedSystemCategories();

    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Ana Ribeiro', email: 'ana@finapp.local', password: 'Finapp@123' })
      .expect(201);

    accessToken = registered.body.tokens.accessToken;
    workspaceId = registered.body.user.personalWorkspaceId;
  });

  const auth = () => ({
    Authorization: `Bearer ${accessToken}`,
    [WORKSPACE_HEADER]: workspaceId,
  });

  const state = async () =>
    (await request(app.getHttpServer()).get('/api/onboarding').set(auth()).expect(200)).body;

  describe('Estado inicial', () => {
    it('comeca no passo 0, sem nada preenchido', async () => {
      const body = await state();

      expect(body.completedStep).toBe(0);
      expect(body.completedAt).toBeNull();
      expect(body.totalSteps).toBe(5);
      expect(body.accounts).toHaveLength(0);
      expect(body.selectedCategoryKeys).toHaveLength(0);
    });

    it('exige o header de workspace', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/onboarding')
        .set({ Authorization: `Bearer ${accessToken}` })
        .expect(400);

      expect(response.body.message).toContain('x-workspace-id');
    });

    it('recusa workspace de outra pessoa', async () => {
      const outra = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ name: 'Bruno', email: 'bruno@finapp.local', password: 'Finapp@123' })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/onboarding')
        .set({
          Authorization: `Bearer ${accessToken}`,
          [WORKSPACE_HEADER]: outra.body.user.personalWorkspaceId,
        })
        .expect(403);
    });
  });

  describe('Passo 1: renda', () => {
    it('salva renda e dia do pagamento', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 850_000, payday: 5 })
        .expect(204);

      const body = await state();

      expect(body.monthlyIncomeInCents).toBe(850_000);
      expect(body.payday).toBe(5);
      expect(body.completedStep).toBe(1);
    });

    it('aceita renda variavel (sem dia de pagamento)', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 500_000, payday: null })
        .expect(204);

      expect((await state()).payday).toBeNull();
    });

    it('recusa valor decimal: dinheiro trafega em centavos', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 8500.5, payday: 5 })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('recusa dia fora de 1-31', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 500_000, payday: 32 })
        .expect(400);
    });
  });

  describe('Passo 2: primeira conta', () => {
    it('cria a conta e avanca o passo', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({
          name: 'Conta corrente',
          type: 'CHECKING',
          initialBalanceInCents: 450_000,
          institution: 'Banco Digital',
        })
        .expect(201);

      expect(response.body.id).toBeTruthy();

      const body = await state();
      expect(body.completedStep).toBe(2);
      expect(body.accounts).toHaveLength(1);
      expect(body.accounts[0].initialBalanceInCents).toBe(450_000);
    });

    it('aceita saldo inicial negativo (conta no vermelho)', async () => {
      await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: -25_000 })
        .expect(201);

      expect((await state()).accounts[0].initialBalanceInCents).toBe(-25_000);
    });

    it('NAO aceita cartao de credito neste passo', async () => {
      // Cartao tem passo proprio, com limite e datas do ciclo.
      await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({ name: 'Cartao', type: 'CREDIT_CARD', initialBalanceInCents: 0 })
        .expect(400);
    });
  });

  describe('Passo 3: cartoes (opcional)', () => {
    it('cria cartoes com o ciclo de fatura', async () => {
      await request(app.getHttpServer())
        .post('/api/onboarding/credit-cards')
        .set(auth())
        .send({
          cards: [
            { name: 'Platinum', limitInCents: 800_000, closingDay: 20, dueDay: 28 },
            { name: 'Gold', limitInCents: 300_000, closingDay: 28, dueDay: 5 },
          ],
        })
        .expect(201);

      const body = await state();
      const cards = body.accounts.filter(
        (account: { type: string }) => account.type === 'CREDIT_CARD',
      );

      expect(cards).toHaveLength(2);

      // Busca por NOME, nao por posicao: os dois cartoes sao criados no mesmo
      // instante, e depender da ordem da lista deixaria o teste instavel.
      const platinum = cards.find((card: { name: string }) => card.name === 'Platinum');
      const gold = cards.find((card: { name: string }) => card.name === 'Gold');

      // O limite informado precisa chegar ao banco -- ja foi descartado aqui.
      expect(platinum.creditCard).toEqual({
        limitInCents: 800_000,
        closingDay: 20,
        dueDay: 28,
      });
      expect(gold.creditCard).toEqual({ limitInCents: 300_000, closingDay: 28, dueDay: 5 });

      // Regra 5: a divida do cartao nao e saldo de conta.
      expect(platinum.initialBalanceInCents).toBe(0);
      expect(body.completedStep).toBe(3);
    });

    it('pular avanca o passo sem criar nada', async () => {
      await request(app.getHttpServer())
        .post('/api/onboarding/credit-cards')
        .set(auth())
        .send({ cards: [] })
        .expect(201);

      const body = await state();
      expect(body.completedStep).toBe(3);
      expect(body.accounts).toHaveLength(0);
    });

    it('recusa fechamento e vencimento no mesmo dia', async () => {
      await request(app.getHttpServer())
        .post('/api/onboarding/credit-cards')
        .set(auth())
        .send({ cards: [{ name: 'X', limitInCents: 100, closingDay: 10, dueDay: 10 }] })
        .expect(400);
    });
  });

  describe('Passo 4: categorias', () => {
    it('lista o catalogo de sementes em arvore', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/onboarding/seed-categories')
        .set(auth())
        .expect(200);

      const alimentacao = response.body.categories.find(
        (category: { systemKey: string }) => category.systemKey === 'alimentacao',
      );

      expect(alimentacao.children).toHaveLength(2);
      expect(alimentacao.icon).toBe('utensils');
    });

    it('COPIA as escolhidas para o workspace, com as filhas', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao', 'moradia'] })
        .expect(204);

      const copied = await prisma.category.findMany({ where: { workspaceId } });

      // 2 maes + 2 filhas cada.
      expect(copied).toHaveLength(6);
      expect(copied.filter((category) => category.parentId === null)).toHaveLength(2);

      // A semente original continua intacta e global.
      const seeds = await prisma.category.count({ where: { workspaceId: null } });
      expect(seeds).toBe(10);
    });

    it('a copia aponta para a origem sem SER a semente', async () => {
      // Sao duas afirmacoes diferentes: `systemKey` = "eu sou a semente X",
      // `sourceSystemKey` = "eu vim da semente X". Com um campo so, a copia
      // colidiria com a semente no indice unico global.
      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao'] })
        .expect(204);

      const copy = await prisma.category.findFirstOrThrow({
        where: { workspaceId, sourceSystemKey: 'alimentacao' },
      });

      expect(copy.workspaceId).toBe(workspaceId);
      expect(copy.systemKey).toBeNull();
      expect(copy.sourceSystemKey).toBe('alimentacao');

      // A semente global segue intacta.
      const seed = await prisma.category.findFirstOrThrow({
        where: { workspaceId: null, systemKey: 'alimentacao' },
      });
      expect(seed.sourceSystemKey).toBeNull();
    });

    it('o banco IMPEDE copiar a mesma semente duas vezes', async () => {
      // Checagem no codigo tem janela de corrida; o indice unico nao tem.
      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao'] })
        .expect(204);

      const duplicate = prisma.category.create({
        data: {
          workspaceId,
          name: 'Alimentação (duplicada)',
          type: 'EXPENSE',
          sourceSystemKey: 'alimentacao',
        },
      });

      await expect(duplicate).rejects.toThrow();
    });

    it('reexecutar NAO duplica o que ja foi copiado', async () => {
      // O usuario que volta para revisar e salva de novo nao pode dobrar a
      // arvore de categorias.
      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao'] })
        .expect(204);

      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao', 'moradia'] })
        .expect(204);

      const copied = await prisma.category.findMany({ where: { workspaceId } });

      expect(copied).toHaveLength(6);
      expect((await state()).selectedCategoryKeys.sort()).toEqual(['alimentacao', 'moradia']);
    });

    it('exige pelo menos uma categoria', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: [] })
        .expect(400);
    });
  });

  describe('Passo 5: meta de economia', () => {
    it('salva a meta em pontos-base', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/savings-target')
        .set(auth())
        .send({ savingsTargetPercent: 2000 })
        .expect(204);

      const body = await state();
      expect(body.savingsTargetPercent).toBe(2000);
      expect(body.completedStep).toBe(5);
    });

    it('aceita pular a meta', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/savings-target')
        .set(auth())
        .send({ savingsTargetPercent: null })
        .expect(204);

      expect((await state()).savingsTargetPercent).toBeNull();
    });

    it('recusa percentual acima de 100%', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/savings-target')
        .set(auth())
        .send({ savingsTargetPercent: 10_001 })
        .expect(400);
    });
  });

  describe('Conclusao', () => {
    async function completeSteps(): Promise<void> {
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 850_000, payday: 5 })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({ name: 'Conta corrente', type: 'CHECKING', initialBalanceInCents: 450_000 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/onboarding/credit-cards')
        .set(auth())
        .send({ cards: [] })
        .expect(201);

      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao', 'moradia', 'salario'] })
        .expect(204);

      await request(app.getHttpServer())
        .put('/api/onboarding/savings-target')
        .set(auth())
        .send({ savingsTargetPercent: 2000 })
        .expect(204);
    }

    it('conclui o wizard e reflete em /auth/me', async () => {
      await completeSteps();

      const response = await request(app.getHttpServer())
        .post('/api/onboarding/complete')
        .set(auth())
        .expect(201);

      expect(response.body.completedAt).toBeTruthy();

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${accessToken}` })
        .expect(200);

      // E o que o front usa para parar de redirecionar para o wizard.
      expect(me.body.onboardingCompletedAt).not.toBeNull();
    });

    it('recusa concluir SEM conta, mesmo se o contador de passos disser que sim', async () => {
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 850_000, payday: 5 })
        .expect(204);

      await request(app.getHttpServer())
        .put('/api/onboarding/savings-target')
        .set(auth())
        .send({ savingsTargetPercent: 2000 })
        .expect(204);

      const response = await request(app.getHttpServer())
        .post('/api/onboarding/complete')
        .set(auth())
        .expect(403);

      expect(response.body.code).toBe('ONBOARDING_REQUIRED');
      expect(response.body.message).toContain('passo 2');
    });

    it('recusa concluir sem categoria', async () => {
      await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: 100 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/onboarding/complete')
        .set(auth())
        .expect(403);

      expect(response.body.message).toContain('passo 4');
    });

    it('concluir duas vezes e idempotente', async () => {
      await completeSteps();

      const first = await request(app.getHttpServer())
        .post('/api/onboarding/complete')
        .set(auth())
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/onboarding/complete')
        .set(auth())
        .expect(201);

      expect(second.body.completedAt).toBe(first.body.completedAt);
    });
  });

  describe('Retomada', () => {
    it('preserva o progresso e NAO retrocede o passo', async () => {
      // Voltar uma tela para revisar nao pode apagar o progresso de quem ja
      // chegou no passo 4.
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 850_000, payday: 5 })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/onboarding/accounts')
        .set(auth())
        .send({ name: 'Conta', type: 'CHECKING', initialBalanceInCents: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .put('/api/onboarding/categories')
        .set(auth())
        .send({ systemKeys: ['alimentacao'] })
        .expect(204);

      expect((await state()).completedStep).toBe(4);

      // Volta ao passo 1 e salva de novo.
      await request(app.getHttpServer())
        .put('/api/onboarding/income')
        .set(auth())
        .send({ monthlyIncomeInCents: 900_000, payday: 10 })
        .expect(204);

      const body = await state();

      expect(body.completedStep).toBe(4);
      expect(body.monthlyIncomeInCents).toBe(900_000);
      expect(body.accounts).toHaveLength(1);
    });
  });
});
