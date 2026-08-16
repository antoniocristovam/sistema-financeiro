import { TransactionStatus, TransactionType, type TransferLeg } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { InvalidValueError } from '../../../../../shared/domain/errors/common-errors';
import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Either, left, right } from '../../../../../shared/either';

export interface TransactionProps {
  workspaceId: UniqueEntityId;
  accountId: UniqueEntityId;
  categoryId: UniqueEntityId | null;
  createdByUserId: UniqueEntityId;
  type: TransactionType;
  /** Sempre POSITIVO. O sinal vem do tipo e da perna. */
  amount: Money;
  date: CalendarDate;
  description: string;
  status: TransactionStatus;
  notes: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  recurrenceId: UniqueEntityId | null;
  occurrenceDate: CalendarDate | null;
  installmentGroupId: UniqueEntityId | null;
  installmentNumber: number | null;
  transferPairId: UniqueEntityId | null;
  transferLeg: TransferLeg | null;
  /** Preenchido quando a compra caiu na fatura de um cartao (regra 5). */
  invoiceId: UniqueEntityId | null;
  externalId: string | null;
  importHash: string | null;
  importBatchId: UniqueEntityId | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreateProps = Optional<
  TransactionProps,
  | 'categoryId'
  | 'status'
  | 'notes'
  | 'counterpartyName'
  | 'counterpartyTaxId'
  | 'recurrenceId'
  | 'occurrenceDate'
  | 'installmentGroupId'
  | 'installmentNumber'
  | 'transferPairId'
  | 'transferLeg'
  | 'invoiceId'
  | 'externalId'
  | 'importHash'
  | 'importBatchId'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Lancamento financeiro.
 *
 * Tres regras do dominio se encontram nesta entidade:
 *
 * - **Regra 4**: TRANSFER nao e' receita nem despesa. Sao duas pernas com o
 *   mesmo `transferPairId`, e o par inteiro fica FORA de todo relatorio de
 *   fluxo. Sem isso, mover dinheiro da conta corrente para a poupanca apareceria
 *   como uma despesa de mil reais e uma receita de mil reais no mesmo mes.
 * - **Regra 5**: compra no cartao nao debita conta corrente. Ela nasce ligada a
 *   uma `Invoice`; quem move o saldo e' o pagamento da fatura.
 * - **Regra 6**: em despesa dividida, `amount` e' o valor CHEIO (afeta saldo).
 *   Relatorio e orcamento usam a MINHA PARTE, que vem dos `ExpenseSplit`.
 */
export class Transaction extends Entity<TransactionProps> {
  static create(props: CreateProps, id?: UniqueEntityId): Either<InvalidValueError, Transaction> {
    if (!props.amount.isPositive()) {
      return left(
        new InvalidValueError('O valor do lancamento precisa ser maior que zero.', 'amountInCents'),
      );
    }

    const isTransfer = props.type === TransactionType.TRANSFER;

    if (isTransfer && (props.transferLeg === undefined || props.transferLeg === null)) {
      return left(
        new InvalidValueError(
          'Transferencia precisa dizer se a perna e origem ou destino.',
          'transferLeg',
        ),
      );
    }

    if (!isTransfer && props.transferLeg) {
      return left(
        new InvalidValueError('Só transferencia tem perna de origem/destino.', 'transferLeg'),
      );
    }

    // Transferencia nao entra em relatorio por categoria; ter categoria daria a
    // entender que entra.
    if (isTransfer && props.categoryId) {
      return left(new InvalidValueError('Transferencia nao tem categoria.', 'categoryId'));
    }

    const now = new Date();

    return right(
      new Transaction(
        {
          ...props,
          categoryId: props.categoryId ?? null,
          status: props.status ?? TransactionStatus.SETTLED,
          notes: props.notes ?? null,
          counterpartyName: props.counterpartyName ?? null,
          counterpartyTaxId: props.counterpartyTaxId ?? null,
          recurrenceId: props.recurrenceId ?? null,
          occurrenceDate: props.occurrenceDate ?? null,
          installmentGroupId: props.installmentGroupId ?? null,
          installmentNumber: props.installmentNumber ?? null,
          transferPairId: props.transferPairId ?? null,
          transferLeg: props.transferLeg ?? null,
          invoiceId: props.invoiceId ?? null,
          externalId: props.externalId ?? null,
          importHash: props.importHash ?? null,
          importBatchId: props.importBatchId ?? null,
          createdAt: props.createdAt ?? now,
          updatedAt: props.updatedAt ?? now,
        },
        id,
      ),
    );
  }

  /**
   * Cria as DUAS pernas de uma transferencia de uma vez.
   *
   * E' um metodo so de proposito: criar as pernas separadamente abriria uma
   * janela em que existe metade de uma transferencia -- dinheiro que saiu de
   * uma conta e nao chegou em lugar nenhum.
   */
  static createTransfer(params: {
    workspaceId: UniqueEntityId;
    fromAccountId: UniqueEntityId;
    toAccountId: UniqueEntityId;
    createdByUserId: UniqueEntityId;
    amount: Money;
    date: CalendarDate;
    description: string;
    notes?: string | null;
  }): Either<InvalidValueError, { source: Transaction; destination: Transaction }> {
    if (params.fromAccountId.equals(params.toAccountId)) {
      return left(
        new InvalidValueError('A conta de origem e a de destino precisam ser diferentes.', 'accountId'),
      );
    }

    const transferPairId = new UniqueEntityId();
    const base = {
      workspaceId: params.workspaceId,
      createdByUserId: params.createdByUserId,
      type: TransactionType.TRANSFER,
      amount: params.amount,
      date: params.date,
      description: params.description,
      notes: params.notes ?? null,
      transferPairId,
    };

    const source = Transaction.create({
      ...base,
      accountId: params.fromAccountId,
      transferLeg: 'SOURCE',
    });

    if (source.isLeft()) {
      return left(source.value);
    }

    const destination = Transaction.create({
      ...base,
      accountId: params.toAccountId,
      transferLeg: 'DESTINATION',
    });

    if (destination.isLeft()) {
      return left(destination.value);
    }

    return right({ source: source.value, destination: destination.value });
  }

  // -- Leitura ---------------------------------------------------------------

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get accountId(): UniqueEntityId {
    return this.props.accountId;
  }

  get categoryId(): UniqueEntityId | null {
    return this.props.categoryId;
  }

  get createdByUserId(): UniqueEntityId {
    return this.props.createdByUserId;
  }

  get type(): TransactionType {
    return this.props.type;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get date(): CalendarDate {
    return this.props.date;
  }

  get description(): string {
    return this.props.description;
  }

  get status(): TransactionStatus {
    return this.props.status;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get counterpartyName(): string | null {
    return this.props.counterpartyName;
  }

  get counterpartyTaxId(): string | null {
    return this.props.counterpartyTaxId;
  }

  get recurrenceId(): UniqueEntityId | null {
    return this.props.recurrenceId;
  }

  get occurrenceDate(): CalendarDate | null {
    return this.props.occurrenceDate;
  }

  get installmentGroupId(): UniqueEntityId | null {
    return this.props.installmentGroupId;
  }

  get installmentNumber(): number | null {
    return this.props.installmentNumber;
  }

  get transferPairId(): UniqueEntityId | null {
    return this.props.transferPairId;
  }

  get transferLeg(): TransferLeg | null {
    return this.props.transferLeg;
  }

  get invoiceId(): UniqueEntityId | null {
    return this.props.invoiceId;
  }

  get externalId(): string | null {
    return this.props.externalId;
  }

  get importHash(): string | null {
    return this.props.importHash;
  }

  get importBatchId(): UniqueEntityId | null {
    return this.props.importBatchId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // -- Classificacao ---------------------------------------------------------

  isTransfer(): boolean {
    return this.props.type === TransactionType.TRANSFER;
  }

  isIncome(): boolean {
    return this.props.type === TransactionType.INCOME;
  }

  isExpense(): boolean {
    return this.props.type === TransactionType.EXPENSE;
  }

  isPending(): boolean {
    return this.props.status === TransactionStatus.PENDING;
  }

  isInstallment(): boolean {
    return this.props.installmentGroupId !== null;
  }

  isFromRecurrence(): boolean {
    return this.props.recurrenceId !== null;
  }

  isCreditCardPurchase(): boolean {
    return this.props.invoiceId !== null;
  }

  /** Rotulo "3/12" para a UI. */
  installmentLabel(totalInstallments: number): string | null {
    return this.props.installmentNumber === null
      ? null
      : `${this.props.installmentNumber}/${totalInstallments}`;
  }

  // -- Valores ---------------------------------------------------------------

  /**
   * Efeito no saldo da conta: negativo sai, positivo entra.
   *
   * Em despesa dividida usa o valor CHEIO, porque foi o valor cheio que saiu da
   * conta (regra 6). A minha parte so importa para relatorio.
   */
  signedAmount(): Money {
    if (this.props.type === TransactionType.INCOME) {
      return this.props.amount;
    }

    if (this.props.type === TransactionType.EXPENSE) {
      return this.props.amount.negate();
    }

    return this.props.transferLeg === 'SOURCE' ? this.props.amount.negate() : this.props.amount;
  }

  /**
   * Entra em relatorio de fluxo de caixa?
   *
   * Transferencia NAO entra (regra 4): o dinheiro nao entrou nem saiu do
   * patrimonio, so mudou de bolso.
   */
  affectsCashFlow(): boolean {
    return !this.isTransfer();
  }

  /**
   * Valor que entra em relatorio, orcamento e gasto por categoria.
   *
   * Sem divisao, e' o valor cheio. Com divisao, e' a MINHA PARTE -- passada
   * pelo caso de uso, que ja carregou os splits. Usar o valor cheio aqui e
   * ainda mostrar que alguem me deve faz o mesmo dinheiro contar duas vezes.
   */
  reportableAmount(ownerShare?: Money): Money {
    if (!this.affectsCashFlow()) {
      return Money.zero(this.props.amount.currency);
    }

    return ownerShare ?? this.props.amount;
  }

  // -- Mutacoes --------------------------------------------------------------

  settle(): void {
    if (this.props.status !== TransactionStatus.SETTLED) {
      this.props.status = TransactionStatus.SETTLED;
      this.touch();
    }
  }

  markPending(): void {
    if (this.props.status !== TransactionStatus.PENDING) {
      this.props.status = TransactionStatus.PENDING;
      this.touch();
    }
  }

  recategorize(categoryId: UniqueEntityId | null): Either<InvalidValueError, void> {
    if (this.isTransfer() && categoryId !== null) {
      return left(new InvalidValueError('Transferencia nao tem categoria.', 'categoryId'));
    }

    this.props.categoryId = categoryId;
    this.touch();

    return right(undefined);
  }

  attachToInvoice(invoiceId: UniqueEntityId): void {
    this.props.invoiceId = invoiceId;
    this.touch();
  }

  edit(changes: {
    description?: string;
    amount?: Money;
    date?: CalendarDate;
    notes?: string | null;
    counterpartyName?: string | null;
  }): Either<InvalidValueError, void> {
    if (changes.amount !== undefined && !changes.amount.isPositive()) {
      return left(
        new InvalidValueError('O valor do lancamento precisa ser maior que zero.', 'amountInCents'),
      );
    }

    if (changes.description !== undefined) this.props.description = changes.description;
    if (changes.amount !== undefined) this.props.amount = changes.amount;
    if (changes.date !== undefined) this.props.date = changes.date;
    if (changes.notes !== undefined) this.props.notes = changes.notes;
    if (changes.counterpartyName !== undefined) {
      this.props.counterpartyName = changes.counterpartyName;
    }

    this.touch();

    return right(undefined);
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
