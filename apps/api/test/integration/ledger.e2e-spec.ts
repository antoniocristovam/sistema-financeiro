import { WORKSPACE_HEADER } from '@finapp/contracts';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '@/shared/database/prisma.service';

import { createTestApp } from './app-factory';

describe('Livro-caixa (integracao)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  let token: string;
  let workspaceId: string;
  let otherToken: string;
  let otherWorkspaceId: string;

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

  const createAccount = (body: Record<string, unknown>, as = auth()) =>
    request(app.getHttpServer()).post('/api/accounts').set(as).send(body);

  const createCategory = (body: Record<string, unknown>, as = auth()) =>
    request(app.getHttpServer()).post('/api/categories').set(as).send(body);

  const createTransaction = (body: Record<string, unknown>, as = auth()) =>
    request(app.getHttpServer()).post('/api/transactions').set(as).send(body);

  beforeEach(async () => {
    const ana = await signUp('ana@finapp.local');
    token = ana.token;
    workspaceId = ana.workspaceId;

    const bruno = await signUp('bruno@finapp.local');
    otherToken = bruno.token;
    otherWorkspaceId = bruno.workspaceId;
  });

  // -- Contas -----------------------------------------------------------------

  describe('Contas', () => {
    it('cria conta e devolve saldo igual a abertura', async () => {
      await createAccount({
        name: 'Conta corrente',
        type: 'CHECKING',
        initialBalanceInCents: 450_000,
      }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);

      expect(list.body.accounts).toHaveLength(1);
      expect(list.body.accounts[0].balanceInCents).toBe(450_000);
      expect(list.body.totalBalanceInCents).toBe(450_000);
    });

    it('exige o ciclo de fatura ao criar cartao', async () => {
      const response = await createAccount({
        name: 'Cartao',
        type: 'CREDIT_CARD',
        initialBalanceInCents: 0,
      }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('cartao abre em ZERO e fica fora do patrimonio', async () => {
      // Regra 5: a divida do cartao vive na fatura, nao no saldo de conta.
      await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 100_000,
      }).expect(201);

      await createAccount({
        name: 'Cartao',
        type: 'CREDIT_CARD',
        initialBalanceInCents: 999_999,
        creditCard: { limitInCents: 800_000, closingDay: 20, dueDay: 28 },
      }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const card = list.body.accounts.find((a: { type: string }) => a.type === 'CREDIT_CARD');

      expect(card.initialBalanceInCents).toBe(0);
      expect(card.creditCard).toEqual({ limitInCents: 800_000, closingDay: 20, dueDay: 28 });
      expect(list.body.totalBalanceInCents).toBe(100_000);
    });

    it('recusa excluir conta COM lancamento e sugere arquivar', async () => {
      const account = await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 0,
      }).expect(201);

      await createTransaction({
        type: 'EXPENSE',
        accountId: account.body.id,
        amountInCents: 5000,
        date: '2026-03-15',
        description: 'Mercado',
      }).expect(201);

      const response = await request(app.getHttpServer())
        .delete(`/api/accounts/${account.body.id}`)
        .set(auth())
        .expect(409);

      expect(response.body.message).toContain('Arquive');

      // Arquivar funciona e a conta some da listagem padrao.
      await request(app.getHttpServer())
        .post(`/api/accounts/${account.body.id}/archive`)
        .set(auth())
        .expect(204);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      expect(list.body.accounts).toHaveLength(0);
    });

    it('conta arquivada nao aceita lancamento novo', async () => {
      const account = await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 0,
      }).expect(201);

      await request(app.getHttpServer())
        .post(`/api/accounts/${account.body.id}/archive`)
        .set(auth())
        .expect(204);

      const response = await createTransaction({
        type: 'EXPENSE',
        accountId: account.body.id,
        amountInCents: 5000,
        date: '2026-03-15',
        description: 'Mercado',
      }).expect(409);

      expect(response.body.message).toContain('arquivada');
    });

    it('NAO enxerga conta de outro workspace', async () => {
      const alheia = await createAccount(
        { name: 'Do Bruno', type: 'CHECKING', initialBalanceInCents: 999 },
        auth(otherToken, otherWorkspaceId),
      ).expect(201);

      // Com o token da Ana, no workspace dela, o id alheio nao existe.
      await request(app.getHttpServer())
        .patch(`/api/accounts/${alheia.body.id}`)
        .set(auth())
        .send({ name: 'Sequestrada' })
        .expect(404);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      expect(list.body.accounts).toHaveLength(0);
    });
  });

  // -- Categorias -------------------------------------------------------------

  describe('Categorias', () => {
    it('cria arvore de dois niveis e devolve agrupada', async () => {
      const mae = await createCategory({
        name: 'Alimentação',
        type: 'EXPENSE',
        icon: 'utensils',
        color: '#F97316',
      }).expect(201);

      await createCategory({
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: mae.body.id,
      }).expect(201);

      const tree = await request(app.getHttpServer())
        .get('/api/categories')
        .set(auth())
        .expect(200);

      expect(tree.body.expenses).toHaveLength(1);
      expect(tree.body.expenses[0].children).toHaveLength(1);
      // A filha herda icone e cor da mae quando nao define os seus.
      expect(tree.body.expenses[0].children[0].icon).toBe('utensils');
      expect(tree.body.expenses[0].children[0].color).toBe('#F97316');
    });

    it('recusa TERCEIRO nivel', async () => {
      const mae = await createCategory({ name: 'Alimentação', type: 'EXPENSE' }).expect(201);
      const filha = await createCategory({
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: mae.body.id,
      }).expect(201);

      const response = await createCategory({
        name: 'Hortifruti',
        type: 'EXPENSE',
        parentId: filha.body.id,
      }).expect(422);

      expect(response.body.code).toBe('CATEGORY_DEPTH_EXCEEDED');
    });

    it('recusa subcategoria de tipo diferente da mae', async () => {
      const receita = await createCategory({ name: 'Salário', type: 'INCOME' }).expect(201);

      await createCategory({
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: receita.body.id,
      }).expect(400);
    });

    it('reordena e reparenta em lote', async () => {
      const a = await createCategory({ name: 'A', type: 'EXPENSE' }).expect(201);
      const b = await createCategory({ name: 'B', type: 'EXPENSE' }).expect(201);

      await request(app.getHttpServer())
        .put('/api/categories/order')
        .set(auth())
        .send({
          items: [
            { id: b.body.id, parentId: null, sortOrder: 0 },
            { id: a.body.id, parentId: b.body.id, sortOrder: 0 },
          ],
        })
        .expect(204);

      const tree = await request(app.getHttpServer())
        .get('/api/categories')
        .set(auth())
        .expect(200);

      expect(tree.body.expenses).toHaveLength(1);
      expect(tree.body.expenses[0].name).toBe('B');
      expect(tree.body.expenses[0].children[0].name).toBe('A');
    });

    it('a reordenacao recusa criar terceiro nivel', async () => {
      const mae = await createCategory({ name: 'Mae', type: 'EXPENSE' }).expect(201);
      const filha = await createCategory({
        name: 'Filha',
        type: 'EXPENSE',
        parentId: mae.body.id,
      }).expect(201);
      const outra = await createCategory({ name: 'Outra', type: 'EXPENSE' }).expect(201);

      // Tentar pendurar "Outra" na "Filha", que ja e' subcategoria.
      await request(app.getHttpServer())
        .put('/api/categories/order')
        .set(auth())
        .send({ items: [{ id: outra.body.id, parentId: filha.body.id, sortOrder: 0 }] })
        .expect(400);
    });

    it('exclusao COM lancamentos exige destino e realoca', async () => {
      const account = await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 0,
      }).expect(201);

      const origem = await createCategory({ name: 'Origem', type: 'EXPENSE' }).expect(201);
      const destino = await createCategory({ name: 'Destino', type: 'EXPENSE' }).expect(201);

      await createTransaction({
        type: 'EXPENSE',
        accountId: account.body.id,
        categoryId: origem.body.id,
        amountInCents: 5000,
        date: '2026-03-15',
        description: 'Mercado',
      }).expect(201);

      // Sem destino: recusa e diz quantos precisam de realocacao.
      const conflict = await request(app.getHttpServer())
        .delete(`/api/categories/${origem.body.id}`)
        .set(auth())
        .expect(409);

      expect(conflict.body.message).toContain('1 lancamento');

      const deleted = await request(app.getHttpServer())
        .delete(`/api/categories/${origem.body.id}?reassignToId=${destino.body.id}`)
        .set(auth())
        .expect(200);

      expect(deleted.body.reassigned).toBe(1);

      const moved = await prisma.transaction.findFirstOrThrow({ where: { workspaceId } });
      expect(moved.categoryId).toBe(destino.body.id);
    });

    it('excluir a mae leva as filhas junto', async () => {
      const mae = await createCategory({ name: 'Mae', type: 'EXPENSE' }).expect(201);
      await createCategory({ name: 'Filha', type: 'EXPENSE', parentId: mae.body.id }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/categories/${mae.body.id}`)
        .set(auth())
        .expect(200);

      expect(await prisma.category.count({ where: { workspaceId } })).toBe(0);
    });

    it('recusa destino de tipo diferente', async () => {
      const account = await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 0,
      }).expect(201);
      const despesa = await createCategory({ name: 'Despesa', type: 'EXPENSE' }).expect(201);
      const receita = await createCategory({ name: 'Receita', type: 'INCOME' }).expect(201);

      await createTransaction({
        type: 'EXPENSE',
        accountId: account.body.id,
        categoryId: despesa.body.id,
        amountInCents: 100,
        date: '2026-03-15',
        description: 'x',
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/categories/${despesa.body.id}?reassignToId=${receita.body.id}`)
        .set(auth())
        .expect(400);
    });
  });

  // -- Lancamentos ------------------------------------------------------------

  describe('Lancamentos', () => {
    let accountId: string;
    let expenseCategoryId: string;

    beforeEach(async () => {
      const account = await createAccount({
        name: 'Conta corrente',
        type: 'CHECKING',
        initialBalanceInCents: 100_000,
      }).expect(201);
      accountId = account.body.id;

      const category = await createCategory({ name: 'Mercado', type: 'EXPENSE' }).expect(201);
      expenseCategoryId = category.body.id;
    });

    it('despesa reduz o saldo, receita aumenta', async () => {
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        categoryId: expenseCategoryId,
        amountInCents: 25_000,
        date: '2026-03-15',
        description: 'Mercado',
      }).expect(201);

      const receita = await createCategory({ name: 'Salário', type: 'INCOME' }).expect(201);

      await createTransaction({
        type: 'INCOME',
        accountId,
        categoryId: receita.body.id,
        amountInCents: 500_000,
        date: '2026-03-05',
        description: 'Salário',
      }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);

      expect(list.body.accounts[0].balanceInCents).toBe(100_000 - 25_000 + 500_000);
    });

    it('lancamento PENDENTE nao entra no saldo, mas entra na projecao', async () => {
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 30_000,
        date: '2026-04-10',
        description: 'Aluguel',
        status: 'PENDING',
      }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);

      expect(list.body.accounts[0].balanceInCents).toBe(100_000);
      expect(list.body.accounts[0].projectedBalanceInCents).toBe(70_000);
    });

    it('recusa categoria de tipo incompativel', async () => {
      const receita = await createCategory({ name: 'Salário', type: 'INCOME' }).expect(201);

      const response = await createTransaction({
        type: 'EXPENSE',
        accountId,
        categoryId: receita.body.id,
        amountInCents: 100,
        date: '2026-03-15',
        description: 'x',
      }).expect(400);

      expect(response.body.message).toContain('receita');
    });

    it('preserva a data exata, sem escorregar de dia', async () => {
      // "Despesa do dia 31" virando "dia 30" joga o lancamento para o mes
      // errado no relatorio mensal.
      for (const date of ['2026-01-31', '2026-12-31', '2024-02-29']) {
        const created = await createTransaction({
          type: 'EXPENSE',
          accountId,
          amountInCents: 100,
          date,
          description: `dia ${date}`,
        }).expect(201);

        expect(created.body.date).toBe(date);
      }
    });

    it('recusa valor zero ou negativo', async () => {
      for (const amountInCents of [0, -100]) {
        await createTransaction({
          type: 'EXPENSE',
          accountId,
          amountInCents,
          date: '2026-03-15',
          description: 'x',
        }).expect(400);
      }
    });

    it('NAO edita lancamento de outro workspace', async () => {
      const created = await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 5000,
        date: '2026-03-15',
        description: 'Mercado',
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body.id}`)
        .set(auth(otherToken, otherWorkspaceId))
        .send({ amountInCents: 1 })
        .expect(404);
    });
  });

  // -- Transferencia (regra 4) ------------------------------------------------

  describe('Transferencia', () => {
    let origemId: string;
    let destinoId: string;

    beforeEach(async () => {
      const origem = await createAccount({
        name: 'Corrente',
        type: 'CHECKING',
        initialBalanceInCents: 500_000,
      }).expect(201);
      origemId = origem.body.id;

      const destino = await createAccount({
        name: 'Poupança',
        type: 'SAVINGS',
        initialBalanceInCents: 0,
      }).expect(201);
      destinoId = destino.body.id;
    });

    const transfer = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/transactions/transfers').set(auth()).send(body);

    it('cria as DUAS pernas e move o saldo entre as contas', async () => {
      await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 100_000,
        date: '2026-03-06',
        description: 'Aporte na reserva',
      }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      const byName = Object.fromEntries(
        list.body.accounts.map((a: { name: string; balanceInCents: number }) => [
          a.name,
          a.balanceInCents,
        ]),
      );

      expect(byName['Corrente']).toBe(400_000);
      expect(byName['Poupança']).toBe(100_000);
      // O patrimonio nao mudou: so trocou de bolso.
      expect(list.body.totalBalanceInCents).toBe(500_000);
    });

    it('fica FORA do resumo de receitas e despesas', async () => {
      await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 100_000,
        date: '2026-03-06',
        description: 'Aporte',
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/transactions')
        .set(auth())
        .expect(200);

      expect(list.body.items).toHaveLength(2);
      // Sem isso, mover mil reais para a poupanca apareceria como mil de gasto.
      expect(list.body.summary).toEqual({
        incomeInCents: 0,
        expenseInCents: 0,
        netInCents: 0,
      });
    });

    it('pode ser escondida do extrato de fluxo', async () => {
      await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 100_000,
        date: '2026-03-06',
        description: 'Aporte',
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/transactions?includeTransfers=false')
        .set(auth())
        .expect(200);

      expect(list.body.items).toHaveLength(0);
    });

    it('excluir uma perna apaga o PAR', async () => {
      // Meia transferencia deixaria uma conta com dinheiro a menos e nenhuma
      // com dinheiro a mais.
      const created = await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 100_000,
        date: '2026-03-06',
        description: 'Aporte',
      }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/transactions/${created.body.sourceId}`)
        .set(auth())
        .expect(204);

      expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(0);

      const list = await request(app.getHttpServer()).get('/api/accounts').set(auth()).expect(200);
      expect(list.body.totalBalanceInCents).toBe(500_000);
    });

    it('editar uma perna atualiza a OUTRA', async () => {
      const created = await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 100_000,
        date: '2026-03-06',
        description: 'Aporte',
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body.sourceId}`)
        .set(auth())
        .send({ amountInCents: 250_000, date: '2026-03-10' })
        .expect(200);

      const legs = await prisma.transaction.findMany({ where: { workspaceId } });

      expect(legs).toHaveLength(2);
      expect(legs.every((leg) => leg.amountInCents === 250_000)).toBe(true);
      expect(new Set(legs.map((leg) => leg.date.toISOString()))).toEqual(
        new Set(['2026-03-10T00:00:00.000Z']),
      );
    });

    it('recusa transferencia para a mesma conta', async () => {
      await transfer({
        fromAccountId: origemId,
        toAccountId: origemId,
        amountInCents: 1000,
        date: '2026-03-06',
        description: 'x',
      }).expect(400);
    });

    it('nao aceita categoria: transferencia nao entra em relatorio por categoria', async () => {
      const created = await transfer({
        fromAccountId: origemId,
        toAccountId: destinoId,
        amountInCents: 1000,
        date: '2026-03-06',
        description: 'x',
      }).expect(201);

      const category = await createCategory({ name: 'Mercado', type: 'EXPENSE' }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body.sourceId}`)
        .set(auth())
        .send({ categoryId: category.body.id })
        .expect(400);
    });
  });

  // -- Extrato ----------------------------------------------------------------

  describe('Extrato', () => {
    let accountId: string;
    let maeId: string;
    let filhaId: string;

    beforeEach(async () => {
      const account = await createAccount({
        name: 'Conta',
        type: 'CHECKING',
        initialBalanceInCents: 0,
      }).expect(201);
      accountId = account.body.id;

      const mae = await createCategory({ name: 'Alimentação', type: 'EXPENSE' }).expect(201);
      maeId = mae.body.id;

      const filha = await createCategory({
        name: 'Mercado',
        type: 'EXPENSE',
        parentId: maeId,
      }).expect(201);
      filhaId = filha.body.id;
    });

    it('filtrar pela MAE inclui os lancamentos das filhas', async () => {
      // E' o drill-down do relatorio: clicar em "Alimentacao" tem que mostrar
      // o mercado e o restaurante juntos.
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        categoryId: filhaId,
        amountInCents: 5000,
        date: '2026-03-10',
        description: 'Supermercado',
      }).expect(201);

      await createTransaction({
        type: 'EXPENSE',
        accountId,
        categoryId: maeId,
        amountInCents: 3000,
        date: '2026-03-11',
        description: 'Padaria',
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get(`/api/transactions?categoryId=${maeId}`)
        .set(auth())
        .expect(200);

      expect(list.body.items).toHaveLength(2);
      expect(list.body.summary.expenseInCents).toBe(8000);
    });

    it('filtra por periodo, tipo e busca', async () => {
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 5000,
        date: '2026-03-10',
        description: 'Supermercado Bom Preço',
      }).expect(201);

      await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 3000,
        date: '2026-04-10',
        description: 'Padaria',
      }).expect(201);

      const porPeriodo = await request(app.getHttpServer())
        .get('/api/transactions?from=2026-03-01&to=2026-03-31')
        .set(auth())
        .expect(200);

      const porBusca = await request(app.getHttpServer())
        .get('/api/transactions?search=supermercado')
        .set(auth())
        .expect(200);

      expect(porPeriodo.body.items).toHaveLength(1);
      // Busca sem diferenciar maiuscula de minuscula.
      expect(porBusca.body.items).toHaveLength(1);
      expect(porBusca.body.items[0].description).toContain('Supermercado');
    });

    it('pagina por cursor sem repetir nem pular linha', async () => {
      // Cinco lancamentos no MESMO dia: o desempate por id e' o que impede a
      // ordem instavel entre paginas.
      for (let i = 0; i < 5; i += 1) {
        await createTransaction({
          type: 'EXPENSE',
          accountId,
          amountInCents: 1000 + i,
          date: '2026-03-10',
          description: `Lançamento ${i}`,
        }).expect(201);
      }

      const first = await request(app.getHttpServer())
        .get('/api/transactions?limit=2')
        .set(auth())
        .expect(200);

      const second = await request(app.getHttpServer())
        .get(`/api/transactions?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .set(auth())
        .expect(200);

      const third = await request(app.getHttpServer())
        .get(`/api/transactions?limit=2&cursor=${encodeURIComponent(second.body.nextCursor)}`)
        .set(auth())
        .expect(200);

      const ids = [...first.body.items, ...second.body.items, ...third.body.items].map(
        (item: { id: string }) => item.id,
      );

      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      expect(third.body.nextCursor).toBeNull();
    });

    it('cursor corrompido volta para a primeira pagina em vez de quebrar', async () => {
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 1000,
        date: '2026-03-10',
        description: 'x',
      }).expect(201);

      await request(app.getHttpServer())
        .get('/api/transactions?cursor=lixo-que-nao-decodifica')
        .set(auth())
        .expect(200);
    });

    it('o extrato de um workspace nao mostra lancamento de outro', async () => {
      await createTransaction({
        type: 'EXPENSE',
        accountId,
        amountInCents: 5000,
        date: '2026-03-10',
        description: 'Da Ana',
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/transactions')
        .set(auth(otherToken, otherWorkspaceId))
        .expect(200);

      expect(list.body.items).toHaveLength(0);
    });
  });

  // -- Permissoes -------------------------------------------------------------

  describe('Permissoes', () => {
    it('VIEWER le mas nao lanca', async () => {
      const shared = await request(app.getHttpServer())
        .post('/api/workspaces')
        .set({ Authorization: `Bearer ${token}` })
        .send({ name: 'Casa', baseCurrency: 'BRL' })
        .expect(201);

      const sharedId = shared.body.id;

      await request(app.getHttpServer())
        .post(`/api/workspaces/${sharedId}/invitations`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ email: 'bruno@finapp.local', role: 'VIEWER' })
        .expect(201);

      const invitation = await prisma.invitation.findFirstOrThrow({
        where: { workspaceId: sharedId },
      });

      // Aceita o convite direto pelo repositorio: o token em claro so existe no
      // e-mail, e o foco deste teste e' a permissao, nao o convite.
      await prisma.workspaceMember.create({
        data: {
          workspaceId: sharedId,
          userId: (await prisma.user.findFirstOrThrow({ where: { email: 'bruno@finapp.local' } }))
            .id,
          role: invitation.role,
        },
      });

      const asViewer = { Authorization: `Bearer ${otherToken}`, [WORKSPACE_HEADER]: sharedId };

      await request(app.getHttpServer()).get('/api/accounts').set(asViewer).expect(200);

      const denied = await request(app.getHttpServer())
        .post('/api/accounts')
        .set(asViewer)
        .send({ name: 'X', type: 'CHECKING', initialBalanceInCents: 0 })
        .expect(403);

      expect(denied.body.code).toBe('INSUFFICIENT_ROLE');
    });
  });
});
