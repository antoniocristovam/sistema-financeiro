import { Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Percentage } from '../../../../../shared/domain/value-objects/percentage';

export interface FinancialProfileProps {
  userId: UniqueEntityId;
  monthlyIncome: Money;
  /** Dia do mes em que o salario cai. */
  payday: number | null;
  savingsTarget: Percentage | null;
  /** Ultimo passo concluido do wizard (0-5). E' o que o torna retomavel. */
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Perfil coletado no onboarding.
 *
 * Pertence ao USUARIO, nao ao workspace: e' o perfil de quem usa, nao o estado
 * de uma carteira. Renda e meta de economia acompanham a pessoa mesmo que ela
 * participe de varios workspaces.
 */
export class FinancialProfile extends Entity<FinancialProfileProps> {
  static readonly TOTAL_STEPS = 5;

  static create(
    props: Optional<
      FinancialProfileProps,
      | 'monthlyIncome'
      | 'payday'
      | 'savingsTarget'
      | 'onboardingStep'
      | 'onboardingCompletedAt'
      | 'createdAt'
      | 'updatedAt'
    > & { currency?: string },
    id?: UniqueEntityId,
  ): FinancialProfile {
    const now = new Date();

    return new FinancialProfile(
      {
        userId: props.userId,
        monthlyIncome: props.monthlyIncome ?? Money.zero(props.currency ?? 'BRL'),
        payday: props.payday ?? null,
        savingsTarget: props.savingsTarget ?? null,
        onboardingStep: props.onboardingStep ?? 0,
        onboardingCompletedAt: props.onboardingCompletedAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get userId(): UniqueEntityId {
    return this.props.userId;
  }

  get monthlyIncome(): Money {
    return this.props.monthlyIncome;
  }

  get payday(): number | null {
    return this.props.payday;
  }

  get savingsTarget(): Percentage | null {
    return this.props.savingsTarget;
  }

  get onboardingStep(): number {
    return this.props.onboardingStep;
  }

  get onboardingCompletedAt(): Date | null {
    return this.props.onboardingCompletedAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Enquanto for falso, toda navegacao redireciona para o wizard. */
  isOnboardingComplete(): boolean {
    return this.props.onboardingCompletedAt !== null;
  }

  setIncome(monthlyIncome: Money, payday: number | null): void {
    this.props.monthlyIncome = monthlyIncome;
    this.props.payday = payday;
    this.touch();
  }

  setSavingsTarget(target: Percentage | null): void {
    this.props.savingsTarget = target;
    this.touch();
  }

  /**
   * Avanca o wizard.
   *
   * Nunca RETROCEDE: voltar uma tela para revisar nao pode apagar o progresso
   * de quem ja chegou no passo 4.
   */
  advanceTo(step: number): void {
    if (step > this.props.onboardingStep) {
      this.props.onboardingStep = Math.min(step, FinancialProfile.TOTAL_STEPS);
      this.touch();
    }
  }

  completeOnboarding(now: Date = new Date()): void {
    if (this.props.onboardingCompletedAt === null) {
      this.props.onboardingCompletedAt = now;
      this.props.onboardingStep = FinancialProfile.TOTAL_STEPS;
      this.touch();
    }
  }

  /** Quanto a meta de economia representa da renda do mes. */
  monthlySavingsGoal(): Money {
    if (this.props.savingsTarget === null) {
      return Money.zero(this.props.monthlyIncome.currency);
    }

    return this.props.savingsTarget.applyTo(this.props.monthlyIncome);
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
