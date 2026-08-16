import {
  ONBOARDING_TOTAL_STEPS,
  type OnboardingAccount,
  type OnboardingState,
  type SeedCategory,
} from '@finapp/contracts';

import { type AccountWithCard } from '../../../account/core/domain/repositories/account-repository';
import { type Category } from '../../../category/core/domain/entities/category';
import { type OnboardingStateOutput } from '../../core/application/use-cases/onboarding-state';

export class OnboardingPresenter {
  static state(output: OnboardingStateOutput): OnboardingState {
    return {
      completedStep: output.profile.onboardingStep,
      totalSteps: ONBOARDING_TOTAL_STEPS,
      completedAt: output.profile.onboardingCompletedAt?.toISOString() ?? null,
      workspaceId: output.workspace.id.toValue(),
      baseCurrency: output.workspace.baseCurrency,

      monthlyIncomeInCents: output.profile.monthlyIncome.toCents(),
      payday: output.profile.payday,
      savingsTargetPercent: output.profile.savingsTarget?.basisPoints ?? null,

      accounts: output.accounts.map(OnboardingPresenter.account),
      selectedCategoryKeys: output.selectedCategoryKeys,
    };
  }

  static account(entry: AccountWithCard): OnboardingAccount {
    return {
      id: entry.account.id.toValue(),
      name: entry.account.name,
      type: entry.account.type,
      initialBalanceInCents: entry.account.initialBalance.toCents(),
      institution: entry.account.institution,
      color: entry.account.color,
      icon: entry.account.icon,
      creditCard: entry.billingCycle
        ? {
            limitInCents: entry.creditCardLimitInCents ?? 0,
            closingDay: entry.billingCycle.closingDay,
            dueDay: entry.billingCycle.dueDay,
          }
        : null,
    };
  }

  /** Monta a arvore de duas alturas que a tela do passo 4 espera. */
  static seedCatalog(categories: Category[]): SeedCategory[] {
    const roots = categories.filter((category) => category.isRoot());

    return roots.map((root) => ({
      systemKey: root.systemKey ?? '',
      name: root.name,
      type: root.type,
      icon: root.icon,
      color: root.color,
      children: categories
        .filter((category) => category.parentId?.equals(root.id) === true)
        .map((child) => ({ systemKey: child.systemKey ?? '', name: child.name })),
    }));
  }
}
