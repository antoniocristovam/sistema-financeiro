// Precisa vir antes do PrismaClient: define DATABASE_URL a partir do .env da raiz.
import './seed-data/env';

import { hash } from '@node-rs/argon2';
import { PrismaClient, type Prisma } from '@prisma/client';

import { deterministicUuid } from './seed-data/uuid';

/**
 * Seed de DESENVOLVIMENTO / E2E.
 *
 * Nunca roda em producao. Cria um cenario que exercita de proposito as regras
 * mais faceis de errar:
 *
 *   - transferencia entre contas (nao e' receita nem despesa)
 *   - compra no cartao que NAO debita a conta na data da compra
 *   - compra parcelada
 *   - despesa dividida em 3 com centavo de resto (100,00 -> 33,34/33,33/33,33)
 *   - acerto parcial de divisao
 *   - workspace compartilhado com dois membros
 *   - orcamento perto do limite e meta com aportes
 *
 * Determinismo: todos os ids saem de UUID v5, entao rodar de novo atualiza as
 * mesmas linhas. As datas sao ancoradas no primeiro dia do mes corrente para o
 * dashboard ter dado no periodo atual; pinne com `SEED_ANCHOR_MONTH=2026-03`
 * quando precisar de repetibilidade absoluta (E2E).
 */
const prisma = new PrismaClient();

const id = (key: string): string => deterministicUuid(`dev:${key}`);

// -- Ancora temporal ---------------------------------------------------------

function resolveAnchor(): { year: number; month: number } {
  const pinned = process.env.SEED_ANCHOR_MONTH;
  if (pinned) {
    const [y, m] = pinned.split('-');
    return { year: Number(y), month: Number(m) - 1 };
  }
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

const ANCHOR = resolveAnchor();

/** Data de calendario em UTC. `monthOffset` negativo anda para tras. */
function d(monthOffset: number, day: number): Date {
  return new Date(Date.UTC(ANCHOR.year, ANCHOR.month + monthOffset, day));
}

/** Primeiro dia do mes, que e' como todo `referenceMonth` e' gravado. */
function monthRef(monthOffset: number): Date {
  return d(monthOffset, 1);
}

// -- Identificadores fixos ---------------------------------------------------

const ANA = id('user:ana');
const BRUNO = id('user:bruno');
const WS_ANA = id('workspace:ana-pessoal');
const WS_CASA = id('workspace:casa');

const ACC_CORRENTE = id('account:corrente');
const ACC_CARTEIRA = id('account:carteira');
const ACC_POUPANCA = id('account:poupanca');
const ACC_CARTAO = id('account:cartao');
const ACC_CASA_CONJUNTA = id('account:casa-conjunta');

// Categorias do sistema: reaproveitamos as do seed principal (workspaceId nulo).
const cat = (key: string): string => deterministicUuid(`category:${key}`);

// =============================================================================

async function seedUsers(): Promise<void> {
  const passwordHash = await hash('Finapp@123');

  await prisma.user.upsert({
    where: { id: ANA },
    create: {
      id: ANA,
      name: 'Ana Ribeiro',
      email: 'ana@finapp.local',
      passwordHash,
      locale: 'PT_BR',
      currency: 'BRL',
      theme: 'SYSTEM',
      emailVerifiedAt: d(-3, 1),
      financialProfile: {
        create: {
          id: id('profile:ana'),
          monthlyIncomeInCents: 850_000,
          payday: 5,
          savingsTargetPercent: 2000, // 20% em pontos-base
          onboardingStep: 5,
          onboardingCompletedAt: d(-3, 1),
        },
      },
    },
    update: { passwordHash },
  });

  await prisma.user.upsert({
    where: { id: BRUNO },
    create: {
      id: BRUNO,
      name: 'Bruno Alves',
      email: 'bruno@finapp.local',
      passwordHash,
      locale: 'PT_BR',
      currency: 'BRL',
      theme: 'DARK',
      emailVerifiedAt: d(-2, 10),
      financialProfile: {
        create: {
          id: id('profile:bruno'),
          monthlyIncomeInCents: 620_000,
          payday: 10,
          savingsTargetPercent: 1000,
          onboardingStep: 5,
          onboardingCompletedAt: d(-2, 10),
        },
      },
    },
    update: { passwordHash },
  });
}

async function seedWorkspaces(): Promise<void> {
  // Workspace pessoal: todo usuario ganha um no cadastro.
  await prisma.workspace.upsert({
    where: { id: WS_ANA },
    create: {
      id: WS_ANA,
      name: 'Minhas finanças',
      type: 'PERSONAL',
      baseCurrency: 'BRL',
      members: {
        create: { id: id('member:ana-pessoal'), userId: ANA, role: 'OWNER', joinedAt: d(-3, 1) },
      },
    },
    update: {},
  });

  await prisma.workspace.upsert({
    where: { id: id('workspace:bruno-pessoal') },
    create: {
      id: id('workspace:bruno-pessoal'),
      name: 'Minhas finanças',
      type: 'PERSONAL',
      baseCurrency: 'BRL',
      members: {
        create: { id: id('member:bruno-pessoal'), userId: BRUNO, role: 'OWNER', joinedAt: d(-2, 10) },
      },
    },
    update: {},
  });

  // Workspace compartilhado: posse coletiva dos dados. Nao confundir com
  // divisao de despesa, que e' rateio de um lancamento especifico.
  await prisma.workspace.upsert({
    where: { id: WS_CASA },
    create: {
      id: WS_CASA,
      name: 'Casa',
      type: 'SHARED',
      baseCurrency: 'BRL',
      members: {
        create: [
          { id: id('member:casa-ana'), userId: ANA, role: 'OWNER', joinedAt: d(-2, 1) },
          { id: id('member:casa-bruno'), userId: BRUNO, role: 'MEMBER', joinedAt: d(-2, 12) },
        ],
      },
    },
    update: {},
  });
}

async function seedAccounts(): Promise<void> {
  const accounts: Prisma.AccountUncheckedCreateInput[] = [
    {
      id: ACC_CORRENTE,
      workspaceId: WS_ANA,
      name: 'Conta corrente',
      type: 'CHECKING',
      initialBalanceInCents: 450_000,
      institution: 'Banco Digital',
      color: '#8B5CF6',
      icon: 'landmark',
    },
    {
      id: ACC_CARTEIRA,
      workspaceId: WS_ANA,
      name: 'Carteira',
      type: 'CASH',
      initialBalanceInCents: 18_000,
      color: '#22C55E',
      icon: 'wallet',
    },
    {
      id: ACC_POUPANCA,
      workspaceId: WS_ANA,
      name: 'Reserva de emergência',
      type: 'SAVINGS',
      initialBalanceInCents: 1_200_000,
      institution: 'Banco Digital',
      color: '#0EA5E9',
      icon: 'piggy-bank',
    },
    {
      id: ACC_CARTAO,
      workspaceId: WS_ANA,
      name: 'Cartão Platinum',
      type: 'CREDIT_CARD',
      initialBalanceInCents: 0,
      institution: 'Banco Digital',
      color: '#EF4444',
      icon: 'credit-card',
    },
    {
      id: ACC_CASA_CONJUNTA,
      workspaceId: WS_CASA,
      name: 'Conta conjunta',
      type: 'CHECKING',
      initialBalanceInCents: 300_000,
      institution: 'Banco Conjunto',
      color: '#F59E0B',
      icon: 'users',
    },
  ];

  for (const account of accounts) {
    await prisma.account.upsert({ where: { id: account.id! }, create: account, update: {} });
  }

  await prisma.creditCard.upsert({
    where: { accountId: ACC_CARTAO },
    create: { accountId: ACC_CARTAO, limitInCents: 800_000, closingDay: 20, dueDay: 28 },
    update: { limitInCents: 800_000, closingDay: 20, dueDay: 28 },
  });
}

/** Cria/atualiza uma transacao pelo id determinístico. */
async function tx(data: Prisma.TransactionUncheckedCreateInput): Promise<void> {
  await prisma.transaction.upsert({
    where: { id: data.id! },
    create: data,
    update: {
      amountInCents: data.amountInCents,
      date: data.date,
      description: data.description,
      status: data.status,
      categoryId: data.categoryId ?? null,
    },
  });
}

async function seedRecurrence(): Promise<void> {
  // Conta fixa: aluguel todo dia 10.
  await prisma.recurrence.upsert({
    where: { id: id('recurrence:aluguel') },
    create: {
      id: id('recurrence:aluguel'),
      workspaceId: WS_ANA,
      name: 'Aluguel',
      templateData: {
        accountId: ACC_CORRENTE,
        categoryId: cat('moradia.aluguel'),
        type: 'EXPENSE',
        amountInCents: 210_000,
        description: 'Aluguel',
      },
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 10,
      startDate: d(-3, 10),
      nextRunAt: d(1, 10),
      materializedUntil: d(2, 1),
      reminderDaysBefore: 3,
      isActive: true,
    },
    update: {},
  });

  // Ocorrencias passadas ja pagas + as futuras materializadas como PENDING.
  // A chave unica (recurrenceId, occurrenceDate) e' o que torna o job idempotente.
  const occurrences: Array<{ offset: number; status: 'PENDING' | 'SETTLED'; amount: number }> = [
    { offset: -2, status: 'SETTLED', amount: 210_000 },
    { offset: -1, status: 'SETTLED', amount: 210_000 },
    { offset: 0, status: 'SETTLED', amount: 235_000 }, // reajuste de ~12%: dispara o alerta de divergencia
    { offset: 1, status: 'PENDING', amount: 235_000 },
    { offset: 2, status: 'PENDING', amount: 235_000 },
  ];

  for (const occ of occurrences) {
    await tx({
      id: id(`tx:aluguel:${occ.offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CORRENTE,
      categoryId: cat('moradia.aluguel'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: occ.amount,
      date: d(occ.offset, 10),
      description: 'Aluguel',
      status: occ.status,
      recurrenceId: id('recurrence:aluguel'),
      occurrenceDate: d(occ.offset, 10),
    });
  }
}

async function seedIncomeAndExpenses(): Promise<void> {
  for (const offset of [-2, -1, 0]) {
    await tx({
      id: id(`tx:salario:${offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CORRENTE,
      categoryId: cat('salario.mensal'),
      createdByUserId: ANA,
      type: 'INCOME',
      amountInCents: 850_000,
      date: d(offset, 5),
      description: 'Salário',
      status: 'SETTLED',
      counterpartyName: 'Acme Tecnologia LTDA',
      counterpartyTaxId: '12.345.678/0001-90',
    });

    await tx({
      id: id(`tx:mercado-a:${offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CORRENTE,
      categoryId: cat('alimentacao.mercado'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: 48_750,
      date: d(offset, 7),
      description: 'Supermercado Bom Preço',
      status: 'SETTLED',
    });

    await tx({
      id: id(`tx:mercado-b:${offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CORRENTE,
      categoryId: cat('alimentacao.mercado'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: 32_400,
      date: d(offset, 19),
      description: 'Supermercado Bom Preço',
      status: 'SETTLED',
    });

    await tx({
      id: id(`tx:energia:${offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CORRENTE,
      categoryId: cat('moradia.energia'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: 18_900 + offset * -1_500,
      date: d(offset, 15),
      description: 'Energia elétrica',
      status: 'SETTLED',
    });

    await tx({
      id: id(`tx:streaming:${offset}`),
      workspaceId: WS_ANA,
      accountId: ACC_CARTAO,
      categoryId: cat('assinaturas.streaming'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: 5_590,
      date: d(offset, 12),
      description: 'Streaming de vídeo',
      status: 'SETTLED',
    });
  }

  await tx({
    id: id('tx:uber:0'),
    workspaceId: WS_ANA,
    accountId: ACC_CARTEIRA,
    categoryId: cat('transporte.aplicativos'),
    createdByUserId: ANA,
    type: 'EXPENSE',
    amountInCents: 3_280,
    date: d(0, 8),
    description: 'Corrida para o aeroporto',
    status: 'SETTLED',
  });

  await tx({
    id: id('tx:freela:0'),
    workspaceId: WS_ANA,
    accountId: ACC_CORRENTE,
    categoryId: cat('freelance.projetos'),
    createdByUserId: ANA,
    type: 'INCOME',
    amountInCents: 180_000,
    date: d(0, 18),
    description: 'Projeto de consultoria',
    status: 'SETTLED',
    counterpartyName: 'Beta Studio ME',
    counterpartyTaxId: '98.765.432/0001-10',
  });
}

async function seedTransfer(): Promise<void> {
  // Regra 4: transferencia NAO e' receita nem despesa. Duas pernas, mesmo
  // `transferPairId`, e fica fora de todo relatorio de fluxo.
  const pairId = id('transfer:pair:reserva');

  await tx({
    id: id('tx:transfer:out'),
    workspaceId: WS_ANA,
    accountId: ACC_CORRENTE,
    categoryId: null,
    createdByUserId: ANA,
    type: 'TRANSFER',
    amountInCents: 100_000,
    date: d(0, 6),
    description: 'Aporte na reserva de emergência',
    status: 'SETTLED',
    transferPairId: pairId,
    transferLeg: 'SOURCE',
  });

  await tx({
    id: id('tx:transfer:in'),
    workspaceId: WS_ANA,
    accountId: ACC_POUPANCA,
    categoryId: null,
    createdByUserId: ANA,
    type: 'TRANSFER',
    amountInCents: 100_000,
    date: d(0, 6),
    description: 'Aporte na reserva de emergência',
    status: 'SETTLED',
    transferPairId: pairId,
    transferLeg: 'DESTINATION',
  });
}

async function seedCreditCard(): Promise<void> {
  // Regra 5: a compra no cartao entra na FATURA conforme o fechamento (dia 20).
  // O saldo da conta corrente so muda quando a fatura e' paga.
  const invoiceId = id('invoice:cartao:-1');

  await prisma.invoice.upsert({
    where: { id: invoiceId },
    create: {
      id: invoiceId,
      creditCardId: ACC_CARTAO,
      referenceMonth: monthRef(-1),
      closingDate: d(-1, 20),
      dueDate: d(-1, 28),
      totalInCents: 0,
      status: 'CLOSED',
    },
    update: {},
  });

  const openInvoiceId = id('invoice:cartao:0');
  await prisma.invoice.upsert({
    where: { id: openInvoiceId },
    create: {
      id: openInvoiceId,
      creditCardId: ACC_CARTAO,
      referenceMonth: monthRef(0),
      closingDate: d(0, 20),
      dueDate: d(0, 28),
      totalInCents: 0,
      status: 'OPEN',
    },
    update: {},
  });

  // Compra parcelada em 3x: R$ 1.200,00 -> 3 parcelas de R$ 400,00.
  const groupId = id('installment:notebook');
  await prisma.installmentGroup.upsert({
    where: { id: groupId },
    create: {
      id: groupId,
      workspaceId: WS_ANA,
      description: 'Notebook',
      totalAmountInCents: 120_000,
      totalInstallments: 3,
      firstDueDate: d(0, 28),
    },
    update: {},
  });

  for (let n = 1; n <= 3; n += 1) {
    await tx({
      id: id(`tx:notebook:${n}`),
      workspaceId: WS_ANA,
      accountId: ACC_CARTAO,
      categoryId: cat('vestuario.acessorios'),
      createdByUserId: ANA,
      type: 'EXPENSE',
      amountInCents: 40_000,
      date: d(n - 1, 14),
      description: `Notebook (${n}/3)`,
      status: n === 1 ? 'SETTLED' : 'PENDING',
      installmentGroupId: groupId,
      installmentNumber: n,
      invoiceId: n === 1 ? openInvoiceId : null,
    });
  }

  // Recalcula o total da fatura aberta a partir dos itens.
  const items = await prisma.transaction.aggregate({
    where: { invoiceId: openInvoiceId },
    _sum: { amountInCents: true },
  });
  await prisma.invoice.update({
    where: { id: openInvoiceId },
    data: { totalInCents: items._sum.amountInCents ?? 0 },
  });
}

async function seedExpenseSplit(): Promise<void> {
  // Regra 7: R$ 100,00 dividido por 3 nao da tres vezes 33,33 -- sobra 1 centavo.
  // O resto vai para o primeiro participante: 33,34 / 33,33 / 33,33.
  const transactionId = id('tx:jantar');

  await tx({
    id: transactionId,
    workspaceId: WS_ANA,
    accountId: ACC_CORRENTE,
    categoryId: cat('alimentacao.restaurante'),
    createdByUserId: ANA,
    type: 'EXPENSE',
    // Valor CHEIO: e' ele que saiu da conta e afeta o SALDO (regra 6).
    amountInCents: 10_000,
    date: d(0, 9),
    description: 'Jantar de aniversário',
    status: 'SETTLED',
  });

  const splits: Prisma.ExpenseSplitUncheckedCreateInput[] = [
    {
      id: id('split:jantar:ana'),
      workspaceId: WS_ANA,
      transactionId,
      participantUserId: ANA,
      participantName: 'Ana Ribeiro',
      participantEmail: 'ana@finapp.local',
      shareType: 'EQUAL',
      // 3.334 centavos: leva o centavo de resto. Soma = 10.000, exata.
      amountInCents: 3_334,
      isOwner: true,
      status: 'SETTLED',
      settledAt: d(0, 9),
    },
    {
      id: id('split:jantar:bruno'),
      workspaceId: WS_ANA,
      transactionId,
      participantUserId: BRUNO,
      participantName: 'Bruno Alves',
      participantEmail: 'bruno@finapp.local',
      shareType: 'EQUAL',
      amountInCents: 3_333,
      status: 'PENDING',
    },
    {
      id: id('split:jantar:carla'),
      workspaceId: WS_ANA,
      transactionId,
      // Participante sem conta na plataforma: so nome + e-mail.
      participantUserId: null,
      participantName: 'Carla Souza',
      participantEmail: 'carla@exemplo.com',
      shareType: 'EQUAL',
      amountInCents: 3_333,
      status: 'PENDING',
    },
  ];

  for (const split of splits) {
    await prisma.expenseSplit.upsert({
      where: { id: split.id! },
      create: split,
      update: { amountInCents: split.amountInCents, status: split.status },
    });
  }

  // Bruno acerta a parte dele.
  const settlementId = id('settlement:bruno-ana');
  await prisma.settlement.upsert({
    where: { id: settlementId },
    create: {
      id: settlementId,
      workspaceId: WS_ANA,
      fromUserId: BRUNO,
      fromName: 'Bruno Alves',
      fromEmail: 'bruno@finapp.local',
      toUserId: ANA,
      toName: 'Ana Ribeiro',
      toEmail: 'ana@finapp.local',
      amountInCents: 3_333,
      date: d(0, 14),
      note: 'Pix do jantar',
    },
    update: {},
  });

  await prisma.expenseSplit.update({
    where: { id: id('split:jantar:bruno') },
    data: { status: 'SETTLED', settledAt: d(0, 14), settlementId },
  });
}

async function seedSharedWorkspaceData(): Promise<void> {
  await tx({
    id: id('tx:casa:mercado'),
    workspaceId: WS_CASA,
    accountId: ACC_CASA_CONJUNTA,
    categoryId: cat('alimentacao.mercado'),
    createdByUserId: BRUNO,
    type: 'EXPENSE',
    amountInCents: 62_180,
    date: d(0, 11),
    description: 'Compra do mês',
    status: 'SETTLED',
  });

  await tx({
    id: id('tx:casa:condominio'),
    workspaceId: WS_CASA,
    accountId: ACC_CASA_CONJUNTA,
    categoryId: cat('moradia.condominio'),
    createdByUserId: ANA,
    type: 'EXPENSE',
    amountInCents: 74_000,
    date: d(0, 5),
    description: 'Condomínio',
    status: 'SETTLED',
  });

  await prisma.auditLog.upsert({
    where: { id: id('audit:casa:bruno-joined') },
    create: {
      id: id('audit:casa:bruno-joined'),
      workspaceId: WS_CASA,
      actorUserId: BRUNO,
      action: 'MEMBER_JOINED',
      entityType: 'WorkspaceMember',
      entityId: id('member:casa-bruno'),
      metadata: { role: 'MEMBER' },
      createdAt: d(-2, 12),
    },
    update: {},
  });
}

async function seedBudgetsAndGoals(): Promise<void> {
  // Alimentacao: limite de R$ 900,00. O gasto do mes corrente fica perto de 85%
  // -- exatamente a faixa ambar que o E2E de orcamento verifica.
  const budgetId = id('budget:alimentacao:0');
  await prisma.budget.upsert({
    where: { id: budgetId },
    create: {
      id: budgetId,
      workspaceId: WS_ANA,
      categoryId: cat('alimentacao'),
      referenceMonth: monthRef(0),
      limitInCents: 90_000,
      rollover: false,
    },
    update: { limitInCents: 90_000 },
  });

  await prisma.budget.upsert({
    where: { id: id('budget:transporte:0') },
    create: {
      id: id('budget:transporte:0'),
      workspaceId: WS_ANA,
      categoryId: cat('transporte'),
      referenceMonth: monthRef(0),
      limitInCents: 40_000,
      rollover: true,
    },
    update: {},
  });

  const goalId = id('goal:viagem');
  await prisma.goal.upsert({
    where: { id: goalId },
    create: {
      id: goalId,
      workspaceId: WS_ANA,
      name: 'Viagem de fim de ano',
      targetAmountInCents: 900_000,
      deadline: d(6, 20),
      icon: 'plane',
      color: '#0EA5E9',
      linkedAccountId: ACC_POUPANCA,
    },
    update: {},
  });

  // Tres aportes: base para a projecao de conclusao (media dos ultimos 3 meses).
  const contributions = [
    { offset: -2, amount: 120_000 },
    { offset: -1, amount: 150_000 },
    { offset: 0, amount: 100_000 },
  ];

  for (const contribution of contributions) {
    await prisma.goalContribution.upsert({
      where: { id: id(`goal-contribution:viagem:${contribution.offset}`) },
      create: {
        id: id(`goal-contribution:viagem:${contribution.offset}`),
        goalId,
        amountInCents: contribution.amount,
        date: d(contribution.offset, 6),
        createdByUserId: ANA,
        note: 'Aporte mensal',
      },
      update: { amountInCents: contribution.amount },
    });
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev nao roda em producao.');
  }

  await seedUsers();
  await seedWorkspaces();
  await seedAccounts();
  await seedRecurrence();
  await seedIncomeAndExpenses();
  await seedTransfer();
  await seedCreditCard();
  await seedExpenseSplit();
  await seedSharedWorkspaceData();
  await seedBudgetsAndGoals();

  const counts = {
    usuarios: await prisma.user.count(),
    workspaces: await prisma.workspace.count(),
    contas: await prisma.account.count(),
    transacoes: await prisma.transaction.count(),
    splits: await prisma.expenseSplit.count(),
  };

  console.warn('[seed-dev] pronto:', counts);
  console.warn('[seed-dev] login: ana@finapp.local / bruno@finapp.local - senha Finapp@123');
  console.warn(`[seed-dev] mes ancora: ${ANCHOR.year}-${String(ANCHOR.month + 1).padStart(2, '0')}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[seed-dev] falhou:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
