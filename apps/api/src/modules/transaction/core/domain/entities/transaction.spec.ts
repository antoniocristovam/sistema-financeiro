import { TransactionType } from '@finapp/contracts';
import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { Transaction } from './transaction';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const day = (value: string): CalendarDate => {
  const result = CalendarDate.create(value);
  if (result.isLeft()) throw new Error(`Data invalida: ${value}`);
  return result.value;
};

const workspaceId = new UniqueEntityId();
const accountId = new UniqueEntityId();
const otherAccountId = new UniqueEntityId();
const categoryId = new UniqueEntityId();
const userId = new UniqueEntityId();

const base = {
  workspaceId,
  accountId,
  createdByUserId: userId,
  amount: brl(10_000),
  date: day('2026-03-15'),
  description: 'Teste',
};

const expense = (overrides = {}): Transaction => {
  const result = Transaction.create({
    ...base,
    type: TransactionType.EXPENSE,
    categoryId,
    ...overrides,
  });

  if (result.isLeft()) throw new Error(`Falhou: ${result.value.message}`);
  return result.value;
};

describe('Transaction', () => {
  describe('validacao na criacao', () => {
    it('recusa valor zero ou negativo', () => {
      // O sinal vem do tipo, nunca do numero.
      expect(
        Transaction.create({ ...base, type: TransactionType.EXPENSE, amount: brl(0) }).isLeft(),
      ).toBe(true);
      expect(
        Transaction.create({ ...base, type: TransactionType.EXPENSE, amount: brl(-100) }).isLeft(),
      ).toBe(true);
    });

    it('exige perna em transferencia', () => {
      const result = Transaction.create({ ...base, type: TransactionType.TRANSFER });

      expect(result.isLeft()).toBe(true);
      expect(result.isLeft() && result.value.field).toBe('transferLeg');
    });

    it('recusa perna em lancamento que nao e transferencia', () => {
      const result = Transaction.create({
        ...base,
        type: TransactionType.EXPENSE,
        transferLeg: 'SOURCE',
      });

      expect(result.isLeft()).toBe(true);
    });

    it('recusa categoria em transferencia', () => {
      // Ter categoria daria a entender que a transferencia entra em relatorio.
      const result = Transaction.create({
        ...base,
        type: TransactionType.TRANSFER,
        transferLeg: 'SOURCE',
        categoryId,
      });

      expect(result.isLeft() && result.value.field).toBe('categoryId');
    });
  });

  describe('efeito no saldo', () => {
    it('receita soma, despesa subtrai', () => {
      expect(expense().signedAmount().toCents()).toBe(-10_000);

      const income = Transaction.create({ ...base, type: TransactionType.INCOME, categoryId });
      expect(income.isRight() && income.value.signedAmount().toCents()).toBe(10_000);
    });

    it('usa o valor CHEIO mesmo em despesa dividida', () => {
      // Regra 6: foi o valor cheio que saiu da conta. A minha parte so importa
      // para relatorio.
      const jantar = expense({ amount: brl(10_000) });

      expect(jantar.signedAmount().toCents()).toBe(-10_000);
    });
  });

  describe('transferencia (regra 4)', () => {
    it('cria as duas pernas de uma vez', () => {
      const result = Transaction.createTransfer({
        workspaceId,
        fromAccountId: accountId,
        toAccountId: otherAccountId,
        createdByUserId: userId,
        amount: brl(100_000),
        date: day('2026-03-06'),
        description: 'Aporte na reserva',
      });

      expect(result.isRight()).toBe(true);
      if (result.isLeft()) return;

      const { source, destination } = result.value;

      expect(source.transferLeg).toBe('SOURCE');
      expect(destination.transferLeg).toBe('DESTINATION');
      // O par compartilha o mesmo identificador.
      expect(source.transferPairId?.toValue()).toBe(destination.transferPairId?.toValue());
    });

    it('a origem debita e o destino credita', () => {
      const result = Transaction.createTransfer({
        workspaceId,
        fromAccountId: accountId,
        toAccountId: otherAccountId,
        createdByUserId: userId,
        amount: brl(100_000),
        date: day('2026-03-06'),
        description: 'Aporte',
      });

      if (result.isLeft()) throw new Error('deveria ter criado');

      expect(result.value.source.signedAmount().toCents()).toBe(-100_000);
      expect(result.value.destination.signedAmount().toCents()).toBe(100_000);
      // Somadas, as duas pernas se anulam: o patrimonio nao mudou.
      expect(
        result.value.source.signedAmount().plus(result.value.destination.signedAmount()).toCents(),
      ).toBe(0);
    });

    it('fica FORA do relatorio de fluxo', () => {
      const result = Transaction.createTransfer({
        workspaceId,
        fromAccountId: accountId,
        toAccountId: otherAccountId,
        createdByUserId: userId,
        amount: brl(100_000),
        date: day('2026-03-06'),
        description: 'Aporte',
      });

      if (result.isLeft()) throw new Error('deveria ter criado');

      expect(result.value.source.affectsCashFlow()).toBe(false);
      expect(result.value.source.reportableAmount().toCents()).toBe(0);
      expect(expense().affectsCashFlow()).toBe(true);
    });

    it('recusa transferencia para a mesma conta', () => {
      const result = Transaction.createTransfer({
        workspaceId,
        fromAccountId: accountId,
        toAccountId: accountId,
        createdByUserId: userId,
        amount: brl(100_000),
        date: day('2026-03-06'),
        description: 'Aporte',
      });

      expect(result.isLeft()).toBe(true);
    });
  });

  describe('valor de relatorio (regra 6)', () => {
    it('sem divisao, usa o valor cheio', () => {
      expect(expense().reportableAmount().toCents()).toBe(10_000);
    });

    it('com divisao, usa a MINHA PARTE', () => {
      // Somar o valor cheio no relatorio E mostrar que alguem me deve faz o
      // mesmo dinheiro contar duas vezes.
      const jantar = expense({ amount: brl(10_000) });

      expect(jantar.reportableAmount(brl(3334)).toCents()).toBe(3334);
      // Mas o saldo continua vendo o valor cheio.
      expect(jantar.signedAmount().toCents()).toBe(-10_000);
    });
  });

  describe('classificacao', () => {
    it('identifica parcela, recorrencia e compra no cartao', () => {
      const parcela = expense({
        installmentGroupId: new UniqueEntityId(),
        installmentNumber: 3,
      });

      expect(parcela.isInstallment()).toBe(true);
      expect(parcela.installmentLabel(12)).toBe('3/12');

      expect(expense({ recurrenceId: new UniqueEntityId() }).isFromRecurrence()).toBe(true);
      expect(expense({ invoiceId: new UniqueEntityId() }).isCreditCardPurchase()).toBe(true);
      expect(expense().isCreditCardPurchase()).toBe(false);
      expect(expense().installmentLabel(12)).toBeNull();
    });
  });

  describe('mutacoes', () => {
    it('alterna entre pendente e liquidado', () => {
      const conta = expense({ status: 'PENDING' });

      expect(conta.isPending()).toBe(true);
      conta.settle();
      expect(conta.isPending()).toBe(false);
      conta.markPending();
      expect(conta.isPending()).toBe(true);
    });

    it('recusa dar categoria a uma transferencia', () => {
      const result = Transaction.createTransfer({
        workspaceId,
        fromAccountId: accountId,
        toAccountId: otherAccountId,
        createdByUserId: userId,
        amount: brl(100_000),
        date: day('2026-03-06'),
        description: 'Aporte',
      });

      if (result.isLeft()) throw new Error('deveria ter criado');

      expect(result.value.source.recategorize(categoryId).isLeft()).toBe(true);
      expect(result.value.source.recategorize(null).isRight()).toBe(true);
    });

    it('edita valor, data e descricao', () => {
      const conta = expense();
      const result = conta.edit({
        amount: brl(23_500),
        date: day('2026-03-20'),
        description: 'Aluguel reajustado',
      });

      expect(result.isRight()).toBe(true);
      expect(conta.amount.toCents()).toBe(23_500);
      expect(conta.date.toString()).toBe('2026-03-20');
      expect(conta.description).toBe('Aluguel reajustado');
    });

    it('recusa edicao para valor invalido', () => {
      const conta = expense();

      expect(conta.edit({ amount: brl(0) }).isLeft()).toBe(true);
      expect(conta.amount.toCents()).toBe(10_000);
    });

    it('vincula a uma fatura', () => {
      const compra = expense();
      const invoiceId = new UniqueEntityId();

      compra.attachToInvoice(invoiceId);

      expect(compra.invoiceId?.toValue()).toBe(invoiceId.toValue());
      expect(compra.isCreditCardPurchase()).toBe(true);
    });
  });
});
