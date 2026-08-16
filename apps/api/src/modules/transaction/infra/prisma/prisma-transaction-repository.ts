import { TransactionStatus, TransactionType } from '@finapp/contracts';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaTransactionManager } from '../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { type Transaction } from '../../core/domain/entities/transaction';
import {
  type AccountBalance,
  type TransactionFilters,
  type TransactionPage,
  type TransactionRepository,
  type TransactionView,
} from '../../core/domain/repositories/transaction-repository';
import { TransactionMapper } from './transaction-mapper';

/** Tudo que a listagem precisa carregar junto, em uma consulta. */
const VIEW_INCLUDE = {
  account: { select: { id: true, name: true, color: true } },
  category: {
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      parent: { select: { name: true, icon: true, color: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  installmentGroup: { select: { totalInstallments: true } },
  workspace: { select: { baseCurrency: true } },
  // Contagem pela relacao: evita uma consulta por linha so para saber se ha
  // comprovante, e nao acopla o modulo de lancamentos ao de anexos.
  _count: { select: { attachments: true } },
} satisfies Prisma.TransactionInclude;

type RawView = Prisma.TransactionGetPayload<{ include: typeof VIEW_INCLUDE }>;

@Injectable()
export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Transaction | null> {
    const raw = await this.tx.client.transaction.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: { workspace: { select: { baseCurrency: true } } },
    });

    return raw ? TransactionMapper.toDomain(raw, raw.workspace.baseCurrency) : null;
  }

  async findViewById(
    workspaceId: UniqueEntityId,
    id: UniqueEntityId,
  ): Promise<TransactionView | null> {
    const raw = await this.tx.client.transaction.findFirst({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
      include: VIEW_INCLUDE,
    });

    if (!raw) {
      return null;
    }

    const [view] = await this.toViews([raw]);

    return view ?? null;
  }

  async findPair(
    workspaceId: UniqueEntityId,
    transferPairId: UniqueEntityId,
  ): Promise<Transaction[]> {
    const rows = await this.tx.client.transaction.findMany({
      where: { workspaceId: workspaceId.toValue(), transferPairId: transferPairId.toValue() },
      include: { workspace: { select: { baseCurrency: true } } },
    });

    return rows.map((raw) => TransactionMapper.toDomain(raw, raw.workspace.baseCurrency));
  }

  /**
   * Extrato paginado por cursor.
   *
   * O cursor e' `data|id` codificado, e nao um offset: o extrato recebe
   * lancamento novo o tempo todo, e com offset o usuario veria a mesma linha
   * duas vezes (ou pularia uma) ao rolar.
   */
  async list(
    workspaceId: UniqueEntityId,
    filters: TransactionFilters,
    pagination: { cursor?: string; limit: number },
  ): Promise<TransactionPage> {
    const where = this.buildWhere(workspaceId, filters);
    const cursor = decodeCursor(pagination.cursor);

    const rows = await this.tx.client.transaction.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { date: { lt: cursor.date } },
                  { date: cursor.date, id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : where,
      include: VIEW_INCLUDE,
      // `id` como desempate: sem ele, dois lancamentos no mesmo dia teriam
      // ordem instavel entre paginas e um deles poderia sumir.
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = page.at(-1);

    return {
      items: await this.toViews(page),
      nextCursor: hasMore && last ? encodeCursor(last.date, last.id) : null,
      summary: await this.summarize(where),
    };
  }

  /**
   * Totais do periodo filtrado.
   *
   * TRANSFER fica fora dos dois lados (regra 4): o dinheiro nao entrou nem saiu
   * do patrimonio, so mudou de bolso. Soma-lo faria "gastei R$ 1.000" aparecer
   * por ter movido mil reais para a poupanca.
   */
  private async summarize(
    where: Prisma.TransactionWhereInput,
  ): Promise<{ incomeInCents: number; expenseInCents: number; netInCents: number }> {
    const grouped = await this.tx.client.transaction.groupBy({
      by: ['type'],
      where: { ...where, type: { in: [TransactionType.INCOME, TransactionType.EXPENSE] } },
      _sum: { amountInCents: true },
    });

    const income =
      grouped.find((row) => row.type === TransactionType.INCOME)?._sum.amountInCents ?? 0;
    const expense =
      grouped.find((row) => row.type === TransactionType.EXPENSE)?._sum.amountInCents ?? 0;

    return { incomeInCents: income, expenseInCents: expense, netInCents: income - expense };
  }

  /**
   * Saldos de todas as contas, em UMA consulta agregada.
   *
   * O saldo nunca e' materializado: manter uma coluna em sincronia com toda
   * insercao, edicao e exclusao e' onde nasce a divergencia entre o saldo do
   * app e o do banco.
   *
   * O sinal vem do tipo e da perna -- e' o `signedAmount` da entidade traduzido
   * para SQL.
   */
  async balancesByAccount(workspaceId: UniqueEntityId): Promise<Map<string, AccountBalance>> {
    const grouped = await this.tx.client.transaction.groupBy({
      by: ['accountId', 'type', 'transferLeg', 'status'],
      where: { workspaceId: workspaceId.toValue() },
      _sum: { amountInCents: true },
      _count: { _all: true },
    });

    const balances = new Map<string, AccountBalance>();

    for (const row of grouped) {
      const current = balances.get(row.accountId) ?? {
        accountId: row.accountId,
        settledInCents: 0,
        projectedInCents: 0,
        transactionCount: 0,
      };

      const amount = row._sum.amountInCents ?? 0;
      const isCredit =
        row.type === TransactionType.INCOME ||
        (row.type === TransactionType.TRANSFER && row.transferLeg === 'DESTINATION');

      const signed = isCredit ? amount : -amount;

      current.projectedInCents += signed;

      if (row.status === TransactionStatus.SETTLED) {
        current.settledInCents += signed;
      }

      current.transactionCount += row._count._all;
      balances.set(row.accountId, current);
    }

    return balances;
  }

  async create(transaction: Transaction): Promise<void> {
    await this.tx.client.transaction.create({ data: TransactionMapper.toPrisma(transaction) });
  }

  /**
   * `createMany` com `skipDuplicates` em vez de `create` dentro de um try.
   *
   * O resultado e' o mesmo -- quem decide e' o indice unico
   * `(recurrenceId, occurrenceDate)` -- mas sem levantar excecao. Com `create`,
   * cada ocorrencia ja materializada imprimia um `prisma:error` no log do
   * servidor, e quem lesse aquilo procuraria um defeito no caminho que estava
   * funcionando exatamente como projetado.
   */
  async createIfAbsent(transaction: Transaction): Promise<boolean> {
    const result = await this.tx.client.transaction.createMany({
      data: [TransactionMapper.toPrisma(transaction)],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  async createMany(transactions: Transaction[]): Promise<void> {
    await this.tx.client.transaction.createMany({
      data: transactions.map(TransactionMapper.toPrisma),
    });
  }

  async createInstallmentGroup(
    group: {
      id: UniqueEntityId;
      workspaceId: UniqueEntityId;
      description: string;
      totalAmountInCents: number;
      totalInstallments: number;
      firstDueDate: CalendarDate;
    },
    installments: Transaction[],
  ): Promise<void> {
    await this.tx.client.installmentGroup.create({
      data: {
        id: group.id.toValue(),
        workspaceId: group.workspaceId.toValue(),
        description: group.description,
        totalAmountInCents: group.totalAmountInCents,
        totalInstallments: group.totalInstallments,
        firstDueDate: group.firstDueDate.toUtcDate(),
      },
    });

    await this.tx.client.transaction.createMany({
      data: installments.map(TransactionMapper.toPrisma),
    });
  }

  async save(transaction: Transaction): Promise<void> {
    const data = TransactionMapper.toPrisma(transaction);

    await this.tx.client.transaction.update({
      where: { id: data.id },
      data: {
        categoryId: data.categoryId,
        amountInCents: data.amountInCents,
        date: data.date,
        description: data.description,
        status: data.status,
        notes: data.notes,
        counterpartyName: data.counterpartyName,
        counterpartyTaxId: data.counterpartyTaxId,
        invoiceId: data.invoiceId,
      },
    });
  }

  async delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void> {
    await this.tx.client.transaction.deleteMany({
      where: { id: id.toValue(), workspaceId: workspaceId.toValue() },
    });
  }

  async deleteTransferPair(
    workspaceId: UniqueEntityId,
    transferPairId: UniqueEntityId,
  ): Promise<void> {
    await this.tx.client.transaction.deleteMany({
      where: { workspaceId: workspaceId.toValue(), transferPairId: transferPairId.toValue() },
    });
  }

  async countByAccount(workspaceId: UniqueEntityId, accountId: UniqueEntityId): Promise<number> {
    return this.tx.client.transaction.count({
      where: { workspaceId: workspaceId.toValue(), accountId: accountId.toValue() },
    });
  }

  async countByCategory(
    workspaceId: UniqueEntityId,
    categoryIds: UniqueEntityId[],
  ): Promise<number> {
    if (categoryIds.length === 0) {
      return 0;
    }

    return this.tx.client.transaction.count({
      where: {
        workspaceId: workspaceId.toValue(),
        categoryId: { in: categoryIds.map((id) => id.toValue()) },
      },
    });
  }

  async countGroupedByCategory(workspaceId: UniqueEntityId): Promise<Map<string, number>> {
    const grouped = await this.tx.client.transaction.groupBy({
      by: ['categoryId'],
      where: { workspaceId: workspaceId.toValue(), categoryId: { not: null } },
      _count: { _all: true },
    });

    return new Map(
      grouped
        .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
        .map((row) => [row.categoryId, row._count._all]),
    );
  }

  async reassignCategory(
    workspaceId: UniqueEntityId,
    fromCategoryIds: UniqueEntityId[],
    toCategoryId: UniqueEntityId | null,
  ): Promise<number> {
    if (fromCategoryIds.length === 0) {
      return 0;
    }

    const result = await this.tx.client.transaction.updateMany({
      where: {
        workspaceId: workspaceId.toValue(),
        categoryId: { in: fromCategoryIds.map((id) => id.toValue()) },
      },
      data: { categoryId: toCategoryId?.toValue() ?? null },
    });

    return result.count;
  }

  // -- Internos ---------------------------------------------------------------

  private buildWhere(
    workspaceId: UniqueEntityId,
    filters: TransactionFilters,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { workspaceId: workspaceId.toValue() };

    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: filters.from.toUtcDate() } : {}),
        ...(filters.to ? { lte: filters.to.toUtcDate() } : {}),
      };
    }

    if (filters.accountId) {
      where.accountId = filters.accountId.toValue();
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      where.categoryId = { in: filters.categoryIds.map((id) => id.toValue()) };
    }

    if (filters.type) {
      where.type = filters.type;
    } else if (filters.includeTransfers === false) {
      // Transferencia fora do extrato de fluxo (regra 4).
      where.type = { not: TransactionType.TRANSFER };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.description = { contains: filters.search, mode: 'insensitive' };
    }

    return where;
  }

  /**
   * Monta as views, resolvendo a conta do outro lado das transferencias.
   *
   * As contrapartes vem em UMA consulta para todas as pernas da pagina, e nao
   * uma por linha -- um extrato de 50 transferencias faria 50 idas ao banco.
   */
  private async toViews(rows: RawView[]): Promise<TransactionView[]> {
    const pairIds = [
      ...new Set(
        rows
          .filter((row) => row.transferPairId !== null)
          .map((row) => row.transferPairId as string),
      ),
    ];

    const counterparts = new Map<string, { id: string; name: string }[]>();

    if (pairIds.length > 0) {
      const legs = await this.tx.client.transaction.findMany({
        where: { transferPairId: { in: pairIds } },
        select: {
          transferPairId: true,
          accountId: true,
          account: { select: { id: true, name: true } },
        },
      });

      for (const leg of legs) {
        const list = counterparts.get(leg.transferPairId!) ?? [];
        list.push({ id: leg.account.id, name: leg.account.name });
        counterparts.set(leg.transferPairId!, list);
      }
    }

    return rows.map((raw) => {
      const pair = raw.transferPairId ? (counterparts.get(raw.transferPairId) ?? []) : [];
      const other = pair.find((leg) => leg.id !== raw.accountId) ?? null;

      return {
        transaction: TransactionMapper.toDomain(raw, raw.workspace.baseCurrency),
        account: raw.account,
        category: raw.category
          ? {
              id: raw.category.id,
              name: raw.category.name,
              // Subcategoria herda icone e cor da mae quando nao define os seus.
              icon: raw.category.icon ?? raw.category.parent?.icon ?? null,
              color: raw.category.color ?? raw.category.parent?.color ?? null,
              parentName: raw.category.parent?.name ?? null,
            }
          : null,
        createdBy: raw.createdBy,
        transferCounterpartAccount: other,
        installmentTotal: raw.installmentGroup?.totalInstallments ?? null,
        attachmentCount: raw._count.attachments,
      };
    });
  }
}

/** Cursor opaco: `data|id` em base64url. */
function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { date: Date; id: string } | null {
  if (!cursor) {
    return null;
  }

  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');

    if (!iso || !id) {
      return null;
    }

    const date = new Date(iso);

    return Number.isNaN(date.getTime()) ? null : { date, id };
  } catch {
    // Cursor corrompido volta para a primeira pagina em vez de derrubar a
    // listagem: e' um parametro de URL, e o usuario pode ter mexido nele.
    return null;
  }
}
