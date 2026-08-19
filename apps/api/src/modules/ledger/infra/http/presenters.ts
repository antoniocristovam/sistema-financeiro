import {
  AccountType,
  type Account as AccountContract,
  type Category as CategoryContract,
  type CategoryTreeNode,
  type Transaction as TransactionContract,
} from '@finapp/contracts';

import { type AccountWithBalance } from '../../../account/core/application/use-cases/manage-accounts';
import { type CategoryWithUsage } from '../../../category/core/application/use-cases/manage-categories';
import { type TransactionView } from '../../../transaction/core/domain/repositories/transaction-repository';

export class AccountPresenter {
  static toHttp(entry: AccountWithBalance): AccountContract {
    return {
      id: entry.account.id.toValue(),
      name: entry.account.name,
      type: entry.account.type,
      initialBalanceInCents: entry.account.initialBalance.toCents(),
      balanceInCents: entry.settledInCents,
      projectedBalanceInCents: entry.projectedInCents,
      institution: entry.account.institution,
      color: entry.account.color,
      icon: entry.account.icon,
      archivedAt: entry.account.archivedAt?.toISOString() ?? null,
      transactionCount: entry.transactionCount,
      creditCard: entry.billingCycle
        ? {
            limitInCents: entry.creditCardLimitInCents ?? 0,
            closingDay: entry.billingCycle.closingDay,
            dueDay: entry.billingCycle.dueDay,
          }
        : null,
      createdAt: entry.account.createdAt.toISOString(),
    };
  }

  /**
   * Patrimonio: soma dos saldos IGNORANDO cartoes.
   *
   * A divida do cartao nao e' patrimonio negativo em conta -- ela vive na
   * fatura (regra 5). Somar o saldo do cartao aqui contaria a mesma despesa
   * duas vezes: uma na conta corrente quando a fatura for paga, outra agora.
   */
  static total(entries: AccountWithBalance[]): number {
    return entries
      .filter((entry) => entry.account.type !== AccountType.CREDIT_CARD)
      .reduce((sum, entry) => sum + entry.settledInCents, 0);
  }
}

export class CategoryPresenter {
  static toHttp(entry: CategoryWithUsage): CategoryContract {
    const { category } = entry;

    return {
      id: category.id.toValue(),
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      parentId: category.parentId?.toValue() ?? null,
      sortOrder: category.sortOrder,
      taxNature: category.taxNature,
      isSystem: category.isSystem(),
      archivedAt: category.archivedAt?.toISOString() ?? null,
      transactionCount: entry.transactionCount,
    };
  }

  /**
   * Arvore de dois niveis.
   *
   * A filha ja sai com icone e cor RESOLVIDOS -- a heranca da mae e' aplicada
   * aqui, e nao em cada tela. Deixar para o front significaria repetir a regra
   * na lista, no seletor, no grafico e no extrato.
   */
  static tree(entries: CategoryWithUsage[]): { expenses: CategoryTreeNode[]; income: CategoryTreeNode[] } {
    const byParent = new Map<string, CategoryWithUsage[]>();

    for (const entry of entries) {
      const parentId = entry.category.parentId?.toValue();

      if (parentId) {
        byParent.set(parentId, [...(byParent.get(parentId) ?? []), entry]);
      }
    }

    const build = (root: CategoryWithUsage): CategoryTreeNode => {
      const node = CategoryPresenter.toHttp(root);
      const children = (byParent.get(root.category.id.toValue()) ?? [])
        .sort((a, b) => a.category.sortOrder - b.category.sortOrder)
        .map((child) => ({
          ...CategoryPresenter.toHttp(child),
          icon: child.category.effectiveIcon(root.category),
          color: child.category.effectiveColor(root.category),
        }));

      return { ...node, children };
    };

    const roots = entries
      .filter((entry) => entry.category.isRoot())
      .sort((a, b) => a.category.sortOrder - b.category.sortOrder);

    return {
      expenses: roots.filter((entry) => entry.category.type === 'EXPENSE').map(build),
      income: roots.filter((entry) => entry.category.type === 'INCOME').map(build),
    };
  }
}

export class TransactionPresenter {
  static toHttp(view: TransactionView): TransactionContract {
    const { transaction } = view;

    return {
      id: transaction.id.toValue(),
      type: transaction.type,
      amountInCents: transaction.amount.toCents(),
      // Efeito no saldo, ja resolvido: a UI nao precisa saber a regra do sinal.
      signedAmountInCents: transaction.signedAmount().toCents(),
      date: transaction.date.toString(),
      description: transaction.description,
      status: transaction.status,
      notes: transaction.notes,
      counterpartyName: transaction.counterpartyName,

      account: view.account,
      category: view.category,
      createdBy: view.createdBy,

      transferLeg: transaction.transferLeg,
      transferPairId: transaction.transferPairId?.toValue() ?? null,
      transferCounterpartAccount: view.transferCounterpartAccount,

      installmentNumber: transaction.installmentNumber,
      installmentTotal: view.installmentTotal,
      recurrenceId: transaction.recurrenceId?.toValue() ?? null,
      invoiceId: transaction.invoiceId?.toValue() ?? null,
      attachmentCount: view.attachmentCount,
      splitCount: view.splitCount,
      ownerShareInCents: view.ownerShareInCents,

      createdAt: transaction.createdAt.toISOString(),
    };
  }
}
