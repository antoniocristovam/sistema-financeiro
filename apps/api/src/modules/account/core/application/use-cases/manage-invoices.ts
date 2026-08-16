import {
  AccountType,
  NotificationType,
  notificationDedupeKey,
  splitInstallments,
  TransactionStatus,
  TransferLeg,
} from '@finapp/contracts';
import { formatMoney, Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type Notifier } from '../../../../../shared/application/ports/notifier';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  ConflictError,
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { type Either, left, right } from '../../../../../shared/either';
import { Transaction } from '../../../../transaction/core/domain/entities/transaction';
import { type TransactionRepository } from '../../../../transaction/core/domain/repositories/transaction-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';
import { type WorkspaceRepository } from '../../../../workspace/core/domain/repositories/workspace-repository';
import { Invoice } from '../../domain/entities/invoice';
import {
  type InvoiceItemView,
  type InvoiceRepository,
  type InvoiceView,
} from '../../domain/repositories/invoice-repository';
import { type AccountRepository, type AccountWithCard } from '../../domain/repositories/account-repository';

type InvoiceError = AccessError | InvalidValueError | ResourceNotFoundError | ConflictError;

/** Cartao com as faturas que importam para a tela. */
export interface CreditCardSummaryResult {
  card: AccountWithCard;
  openInvoice: InvoiceView | null;
  unpaidInvoices: InvoiceView[];
  usedLimitInCents: number;
}

/**
 * Garante a existencia da fatura de um ciclo.
 *
 * A fatura nasce da PRIMEIRA compra do ciclo, nao de um job mensal: criar doze
 * faturas vazias por ano para cada cartao encheria a tela de meses em que
 * ninguem gastou nada.
 */
async function ensureInvoice(
  invoices: InvoiceRepository,
  workspaceId: UniqueEntityId,
  card: AccountWithCard,
  referenceMonth: MonthReference,
): Promise<Invoice> {
  const existing = await invoices.findByMonth(workspaceId, card.account.id, referenceMonth);

  if (existing) {
    return existing;
  }

  const window = card.billingCycle!.windowFor(referenceMonth);

  return invoices.ensureForMonth(
    Invoice.create({
      creditCardId: card.account.id,
      referenceMonth: window.referenceMonth,
      closingDate: window.closingDate,
      dueDate: window.dueDate,
      total: Money.fromCents(0, card.account.initialBalance.currency),
    }),
  );
}

// -- Listagem de cartoes ------------------------------------------------------

export interface ListCreditCardsInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
}

export class ListCreditCardsUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ListCreditCardsInput,
  ): Promise<Either<InvoiceError, CreditCardSummaryResult[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const today = CalendarDate.fromUtcDate(this.clock.now());
    const accounts = await this.accounts.listByWorkspace(input.workspaceId, {
      includeArchived: false,
    });

    const cards = accounts.filter(
      (entry) => entry.account.type === AccountType.CREDIT_CARD && entry.billingCycle !== null,
    );

    const summaries: CreditCardSummaryResult[] = [];

    for (const card of cards) {
      const window = card.billingCycle!.openInvoiceAt(today);

      const [current, unpaid] = await Promise.all([
        this.invoices.findByMonth(input.workspaceId, card.account.id, window.referenceMonth),
        this.invoices.listUnpaid(input.workspaceId, card.account.id),
      ]);

      /*
       * A fatura "atual" e' a do ciclo de hoje -- mas se o ciclo ainda nao teve
       * compra nenhuma, cai para a aberta mais recente.
       *
       * Sem essa queda, o cartao apareceria com limite comprometido e nenhuma
       * fatura na tela: o usuario veria a divida no numero e nao teria onde
       * clicar para entender de onde ela vem.
       */
      const open =
        current ?? [...unpaid].reverse().find((invoice) => invoice.isOpen()) ?? null;

      const openView: InvoiceView | null = open
        ? { invoice: open, cardName: card.account.name, itemCount: 0 }
        : null;

      /*
       * Limite comprometido = TUDO que ainda nao foi pago.
       *
       * Nao e' "a fatura do ciclo atual mais as fechadas": uma compra com data
       * futura, ou um ciclo antigo que o fechamento ainda nao processou, tambem
       * comprometem limite -- e apareceriam como espaco livre que nao existe.
       *
       * A fatura PAGA sai da conta: o limite volta. Somar tudo que ja passou no
       * cartao mostraria um limite estourado depois de alguns meses de uso
       * normal.
       */
      const usedLimitInCents = unpaid.reduce(
        (sum, invoice) => sum + invoice.total.toCents(),
        0,
      );

      summaries.push({
        card,
        openInvoice: openView,
        // Para a tela, so as FECHADAS: sao as que ja podem ser pagas.
        unpaidInvoices: unpaid
          .filter((invoice) => !invoice.isOpen())
          .map((invoice) => ({ invoice, cardName: card.account.name, itemCount: 0 })),
        usedLimitInCents,
      });
    }

    return right(summaries);
  }
}

// -- Faturas de um cartao -----------------------------------------------------

export interface ListInvoicesInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  cardAccountId: UniqueEntityId;
  months: number;
}

export class ListInvoicesUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListInvoicesInput): Promise<Either<InvoiceError, InvoiceView[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const card = await this.accounts.findById(input.workspaceId, input.cardAccountId);

    if (!card || card.account.type !== AccountType.CREDIT_CARD) {
      return left(new ResourceNotFoundError('Cartao'));
    }

    const today = CalendarDate.fromUtcDate(this.clock.now());
    const openWindow = card.billingCycle!.openInvoiceAt(today);

    return right(
      await this.invoices.listByCard(input.workspaceId, input.cardAccountId, {
        months: input.months,
        upTo: openWindow.referenceMonth,
      }),
    );
  }
}

export interface GetInvoiceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  invoiceId: UniqueEntityId;
}

export class GetInvoiceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly invoices: InvoiceRepository,
  ) {}

  async execute(
    input: GetInvoiceInput,
  ): Promise<Either<InvoiceError, { view: InvoiceView; items: InvoiceItemView[] }>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, 'data:read');

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const view = await this.invoices.findViewById(input.workspaceId, input.invoiceId);

    if (!view) {
      return left(new ResourceNotFoundError('Fatura'));
    }

    return right({
      view,
      items: await this.invoices.items(input.workspaceId, input.invoiceId),
    });
  }
}

// -- Pagamento ----------------------------------------------------------------

export interface PayInvoiceInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  invoiceId: UniqueEntityId;
  fromAccountId: UniqueEntityId;
  date?: string;
  notes?: string;
}

/**
 * Pagamento da fatura.
 *
 * Este e' o momento em que o dinheiro REALMENTE sai da conta (regra 5) -- e ele
 * e' modelado como TRANSFERENCIA, nao como despesa (regra 4). O motivo e'
 * contabil: as despesas ja foram reconhecidas quando cada compra entrou na
 * fatura. Lancar o pagamento como despesa contaria tudo duas vezes, e o mes do
 * vencimento apareceria como um desastre financeiro que nao aconteceu.
 *
 * As duas pernas: sai da conta corrente, entra no cartao (abatendo a divida).
 */
export class PayInvoiceUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly invoices: InvoiceRepository,
    private readonly transactions: TransactionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: PayInvoiceInput): Promise<Either<InvoiceError, { transactionId: string }>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const invoice = await this.invoices.findById(input.workspaceId, input.invoiceId);

    if (!invoice) {
      return left(new ResourceNotFoundError('Fatura'));
    }

    const source = await this.accounts.findById(input.workspaceId, input.fromAccountId);

    if (!source) {
      return left(new ResourceNotFoundError('Conta'));
    }

    // Pagar cartao com cartao nao move dinheiro nenhum: so empurraria a divida
    // de um lado para o outro e ainda estouraria o limite do segundo.
    if (source.account.type === AccountType.CREDIT_CARD) {
      return left(
        new InvalidValueError('A fatura precisa ser paga por uma conta, nao por outro cartao.', 'fromAccountId'),
      );
    }

    if (invoice.total.isZero()) {
      return left(new ConflictError('Esta fatura nao tem nada a pagar.'));
    }

    let paymentDate = CalendarDate.fromUtcDate(this.clock.now());

    if (input.date) {
      const parsed = CalendarDate.create(input.date);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      paymentDate = parsed.value;
    }

    const currency = authorized.value.workspace.baseCurrency;
    const transferPairId = new UniqueEntityId();
    const description = `Pagamento fatura ${invoice.referenceMonth.toString()}`;

    const common = {
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      type: 'TRANSFER' as const,
      amount: Money.fromCents(invoice.total.toCents(), currency),
      date: paymentDate,
      description,
      status: TransactionStatus.SETTLED,
      notes: input.notes?.trim() ?? null,
      transferPairId,
    };

    const outgoing = Transaction.create({
      ...common,
      accountId: input.fromAccountId,
      transferLeg: TransferLeg.SOURCE,
    });

    const incoming = Transaction.create({
      ...common,
      accountId: invoice.creditCardId,
      transferLeg: TransferLeg.DESTINATION,
    });

    if (outgoing.isLeft()) {
      return left(outgoing.value);
    }

    if (incoming.isLeft()) {
      return left(incoming.value);
    }

    // A perna de SAIDA e' a que representa o pagamento: e' ela que debita a
    // conta, e e' a ela que a fatura aponta.
    const paid = invoice.payWith(outgoing.value.id, this.clock.now());

    if (paid.isLeft()) {
      return left(new ConflictError(paid.value.message));
    }

    await this.unitOfWork.run(async () => {
      await this.transactions.createMany([outgoing.value, incoming.value]);
      await this.invoices.save(invoice);
    });

    return right({ transactionId: outgoing.value.id.toValue() });
  }
}

// -- Compra parcelada ---------------------------------------------------------

export interface CreateInstallmentPurchaseInput {
  workspaceId: UniqueEntityId;
  userId: UniqueEntityId;
  cardAccountId: UniqueEntityId;
  categoryId: UniqueEntityId | null;
  totalAmountInCents: number;
  installments: number;
  date: string;
  description: string;
  notes?: string;
}

export interface InstallmentResult {
  installmentGroupId: string;
  installments: {
    transactionId: string;
    number: number;
    amountInCents: number;
    date: CalendarDate;
    invoiceMonth: MonthReference;
  }[];
}

/**
 * Compra parcelada no cartao.
 *
 * Cada parcela e' um lancamento proprio, na fatura do seu ciclo. Guardar uma
 * unica compra de R$ 1.200 e "espalhar" na leitura seria mais simples de
 * gravar e pior em tudo o mais: a fatura de cada mes precisa fechar com o valor
 * que o banco cobra, e o relatorio por categoria precisa contar R$ 100 em cada
 * um dos doze meses, nao R$ 1.200 em um.
 *
 * A soma das parcelas fecha EXATAMENTE com o total -- os centavos do resto vao
 * para as primeiras, como faz a maquininha.
 */
export class CreateInstallmentPurchaseUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly invoices: InvoiceRepository,
    private readonly transactions: TransactionRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    input: CreateInstallmentPurchaseInput,
  ): Promise<Either<InvoiceError, InstallmentResult>> {
    const authorized = await this.access.authorize(
      input.workspaceId,
      input.userId,
      'transaction:write',
    );

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const card = await this.accounts.findById(input.workspaceId, input.cardAccountId);

    if (!card || card.account.type !== AccountType.CREDIT_CARD || !card.billingCycle) {
      return left(new ResourceNotFoundError('Cartao'));
    }

    if (!card.account.acceptsNewTransactions()) {
      return left(new ConflictError('Este cartao esta arquivado e nao aceita compras novas.'));
    }

    const purchaseDate = CalendarDate.create(input.date);

    if (purchaseDate.isLeft()) {
      return left(purchaseDate.value);
    }

    const currency = authorized.value.workspace.baseCurrency;
    const amounts = splitInstallments(input.totalAmountInCents, input.installments);

    // Parcela de zero nao e' parcela: acontece quando o total nao alcanca o
    // numero de vezes (R$ 0,02 em 3x). Recusar aqui e' melhor do que gravar um
    // lancamento vazio que ninguem consegue explicar depois.
    if (amounts.some((amount) => amount <= 0)) {
      return left(
        new InvalidValueError(
          'O valor e pequeno demais para este numero de parcelas.',
          'installments',
        ),
      );
    }

    const firstWindow = card.billingCycle.invoiceFor(purchaseDate.value);
    const installmentGroupId = new UniqueEntityId();
    const created: InstallmentResult['installments'] = [];
    const entries: { transaction: Transaction; invoiceId: UniqueEntityId }[] = [];

    for (const [index, amountInCents] of amounts.entries()) {
      const month = firstWindow.referenceMonth.add(index);
      const invoice = await ensureInvoice(this.invoices, input.workspaceId, card, month);

      /*
       * A data da parcela e' a do FECHAMENTO do ciclo dela, nao a da compra.
       *
       * Com a data da compra, as doze parcelas cairiam todas no mesmo dia e o
       * relatorio mensal veria R$ 1.200 em marco -- exatamente o que o
       * parcelamento existe para evitar. A primeira parcela e' a excecao: ela
       * mantem a data da compra, que e' quando a compra de fato aconteceu.
       */
      const date =
        index === 0
          ? purchaseDate.value
          : card.billingCycle.windowFor(month).closingDate;

      const transaction = Transaction.create({
        workspaceId: input.workspaceId,
        accountId: input.cardAccountId,
        categoryId: input.categoryId,
        createdByUserId: input.userId,
        type: 'EXPENSE',
        amount: Money.fromCents(amountInCents, currency),
        date,
        description: input.description.trim(),
        status: TransactionStatus.SETTLED,
        notes: input.notes?.trim() ?? null,
        installmentGroupId,
        installmentNumber: index + 1,
        invoiceId: invoice.id,
      });

      if (transaction.isLeft()) {
        return left(transaction.value);
      }

      entries.push({ transaction: transaction.value, invoiceId: invoice.id });
      created.push({
        transactionId: transaction.value.id.toValue(),
        number: index + 1,
        amountInCents,
        date,
        invoiceMonth: month,
      });
    }

    await this.unitOfWork.run(async () => {
      await this.transactions.createInstallmentGroup(
        {
          id: installmentGroupId,
          workspaceId: input.workspaceId,
          description: input.description.trim(),
          totalAmountInCents: input.totalAmountInCents,
          totalInstallments: input.installments,
          firstDueDate: firstWindow.dueDate,
        },
        entries.map((entry) => entry.transaction),
      );
    });

    // Os totais das faturas afetadas, recalculados a partir dos itens.
    for (const invoiceId of new Set(entries.map((entry) => entry.invoiceId.toValue()))) {
      const id = new UniqueEntityId(invoiceId);
      const invoice = await this.invoices.findById(input.workspaceId, id);

      if (invoice) {
        invoice.setTotal(
          Money.fromCents(await this.invoices.sumItems(input.workspaceId, id), currency),
        );
        await this.invoices.save(invoice);
      }
    }

    return right({ installmentGroupId: installmentGroupId.toValue(), installments: created });
  }
}

// -- Fechamento e lembrete (jobs) ---------------------------------------------

export interface ClosingReport {
  invoicesClosed: number;
}

/**
 * Fecha as faturas cujo dia de fechamento ja passou.
 *
 * Fechar e' o que congela o valor: depois disso a fatura pode ser paga, e
 * compras novas passam a cair no ciclo seguinte. Sem este job, uma fatura
 * ficaria aberta para sempre e o usuario pagaria um valor que continua mudando.
 */
export class CloseInvoicesUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(reference?: CalendarDate): Promise<ClosingReport> {
    const today = reference ?? CalendarDate.fromUtcDate(this.clock.now());
    const pending = await this.invoices.findDueForClosingJob(today, 500);

    let invoicesClosed = 0;

    for (const invoice of pending) {
      const workspaceId = await this.invoices.workspaceOf(invoice.id);

      if (!workspaceId) {
        continue;
      }

      // O total e' recalculado no fechamento: e' a ultima chance de corrigir
      // qualquer divergencia antes de o valor virar cobranca.
      invoice.setTotal(
        Money.fromCents(
          await this.invoices.sumItems(workspaceId, invoice.id),
          invoice.total.currency,
        ),
      );
      invoice.close();

      await this.invoices.save(invoice);
      invoicesClosed += 1;
    }

    return { invoicesClosed };
  }
}

export interface InvoiceReminderReport {
  notificationsCreated: number;
}

/** Com quantos dias de antecedencia o vencimento e' avisado. */
export const INVOICE_DUE_REMINDER_DAYS = 3;

/**
 * Avisa que a fatura vence.
 *
 * Mesma deduplicacao por evento das contas fixas: a chave carrega a fatura e a
 * data, entao reexecutar o job nao manda o aviso de novo.
 */
export class SendInvoiceRemindersUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(reference?: CalendarDate): Promise<InvoiceReminderReport> {
    const today = reference ?? CalendarDate.fromUtcDate(this.clock.now());
    const dueDate = today.addDays(INVOICE_DUE_REMINDER_DAYS);
    const invoices = await this.invoices.findDueForReminderJob(dueDate);

    let notificationsCreated = 0;

    for (const invoice of invoices) {
      const workspaceId = await this.invoices.workspaceOf(invoice.id);

      if (!workspaceId) {
        continue;
      }

      const view = await this.invoices.findViewById(workspaceId, invoice.id);
      const members = await this.workspaces.listMembers(workspaceId);
      const value = formatMoney(invoice.total, { locale: 'pt-BR' });

      notificationsCreated += await this.notifier.pushMany(
        members.map((member) => ({
          userId: member.userId,
          workspaceId,
          type: NotificationType.INVOICE_DUE,
          title: `Fatura ${view?.cardName ?? ''} vence em ${INVOICE_DUE_REMINDER_DAYS} dias`,
          body: `${value} vencendo em ${invoice.dueDate.toString()}.`,
          data: {
            invoiceId: invoice.id.toValue(),
            dueDate: invoice.dueDate.toString(),
            totalInCents: invoice.total.toCents(),
          },
          dedupeKey: notificationDedupeKey(
            NotificationType.INVOICE_DUE,
            invoice.id.toValue(),
            invoice.dueDate.toString(),
          ),
        })),
      );
    }

    return { notificationsCreated };
  }
}
