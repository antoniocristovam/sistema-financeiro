import { Money } from '@finapp/money';
import { type Transaction as PrismaTransaction } from '@prisma/client';

import { UniqueEntityId } from '../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../shared/domain/value-objects/calendar-date';
import { Transaction } from '../../core/domain/entities/transaction';

export class TransactionMapper {
  static toDomain(raw: PrismaTransaction, currency: string): Transaction {
    const result = Transaction.create(
      {
        workspaceId: new UniqueEntityId(raw.workspaceId),
        accountId: new UniqueEntityId(raw.accountId),
        categoryId: raw.categoryId ? new UniqueEntityId(raw.categoryId) : null,
        createdByUserId: new UniqueEntityId(raw.createdByUserId),
        type: raw.type,
        amount: Money.fromCents(raw.amountInCents, currency),
        // `@db.Date` volta como Date a meia-noite UTC: ler em UTC e' obrigatorio
        // aqui, senao "dia 31" vira "dia 30" em qualquer fuso a oeste.
        date: CalendarDate.fromUtcDate(raw.date),
        description: raw.description,
        status: raw.status,
        notes: raw.notes,
        counterpartyName: raw.counterpartyName,
        counterpartyTaxId: raw.counterpartyTaxId,
        recurrenceId: raw.recurrenceId ? new UniqueEntityId(raw.recurrenceId) : null,
        occurrenceDate: raw.occurrenceDate ? CalendarDate.fromUtcDate(raw.occurrenceDate) : null,
        installmentGroupId: raw.installmentGroupId
          ? new UniqueEntityId(raw.installmentGroupId)
          : null,
        installmentNumber: raw.installmentNumber,
        transferPairId: raw.transferPairId ? new UniqueEntityId(raw.transferPairId) : null,
        transferLeg: raw.transferLeg,
        invoiceId: raw.invoiceId ? new UniqueEntityId(raw.invoiceId) : null,
        externalId: raw.externalId,
        importHash: raw.importHash,
        importBatchId: raw.importBatchId ? new UniqueEntityId(raw.importBatchId) : null,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );

    // Dados JA gravados. Se a entidade recusa, o registro esta inconsistente --
    // melhor estourar do que devolver um lancamento que quebra o saldo em
    // silencio.
    if (result.isLeft()) {
      throw new Error(`Lancamento invalido no banco (${raw.id}): ${result.value.message}`);
    }

    return result.value;
  }

  static toPrisma(transaction: Transaction) {
    return {
      id: transaction.id.toValue(),
      workspaceId: transaction.workspaceId.toValue(),
      accountId: transaction.accountId.toValue(),
      categoryId: transaction.categoryId?.toValue() ?? null,
      createdByUserId: transaction.createdByUserId.toValue(),
      type: transaction.type,
      amountInCents: transaction.amount.toCents(),
      date: transaction.date.toUtcDate(),
      description: transaction.description,
      status: transaction.status,
      notes: transaction.notes,
      counterpartyName: transaction.counterpartyName,
      counterpartyTaxId: transaction.counterpartyTaxId,
      recurrenceId: transaction.recurrenceId?.toValue() ?? null,
      occurrenceDate: transaction.occurrenceDate?.toUtcDate() ?? null,
      installmentGroupId: transaction.installmentGroupId?.toValue() ?? null,
      installmentNumber: transaction.installmentNumber,
      transferPairId: transaction.transferPairId?.toValue() ?? null,
      transferLeg: transaction.transferLeg,
      invoiceId: transaction.invoiceId?.toValue() ?? null,
      externalId: transaction.externalId,
      importHash: transaction.importHash,
      importBatchId: transaction.importBatchId?.toValue() ?? null,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }
}
