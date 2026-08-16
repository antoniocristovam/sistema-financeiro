import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { Percentage } from '../../../../../shared/domain/value-objects/percentage';
import { FinancialProfile } from './financial-profile';
import { User } from './user';

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) throw new Error(`E-mail invalido: ${value}`);
  return result.value;
};

const percentage = (basisPoints: number): Percentage => {
  const result = Percentage.fromBasisPoints(basisPoints);
  if (result.isLeft()) throw new Error('percentual invalido');
  return result.value;
};

const user = (overrides = {}): User =>
  User.create({
    name: 'Ana Ribeiro',
    email: email('ana@finapp.local'),
    passwordHash: 'argon2id$hash',
    ...overrides,
  });

describe('User', () => {
  it('nasce com preferencias padrao e e-mail nao verificado', () => {
    const ana = user();

    expect(ana.locale).toBe('PT_BR');
    expect(ana.currency).toBe('BRL');
    expect(ana.theme).toBe('SYSTEM');
    expect(ana.isEmailVerified()).toBe(false);
  });

  it('normaliza a moeda para maiusculo', () => {
    expect(user({ currency: 'usd' }).currency).toBe('USD');
  });

  it('verifica o e-mail uma vez so', () => {
    // Reverificar nao pode mover a data original.
    const ana = user();
    const primeira = new Date('2026-01-01T00:00:00Z');

    ana.verifyEmail(primeira);
    ana.verifyEmail(new Date('2026-06-01T00:00:00Z'));

    expect(ana.emailVerifiedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(ana.isEmailVerified()).toBe(true);
  });

  it('troca a senha guardando so o hash', () => {
    const ana = user();
    ana.changePassword('argon2id$novo-hash');

    expect(ana.passwordHash).toBe('argon2id$novo-hash');
  });

  it('atualiza perfil sem mexer no que nao foi informado', () => {
    const ana = user();
    ana.updateProfile({ name: 'Ana R. Neto', theme: 'DARK' });

    expect(ana.name).toBe('Ana R. Neto');
    expect(ana.theme).toBe('DARK');
    expect(ana.locale).toBe('PT_BR');
  });

  it('mapeia o locale para a tag do Intl', () => {
    expect(user().localeTag()).toBe('pt-BR');
    expect(user({ locale: 'EN_US' }).localeTag()).toBe('en-US');
  });
});

describe('FinancialProfile', () => {
  const profile = (overrides = {}): FinancialProfile =>
    FinancialProfile.create({ userId: new UniqueEntityId(), ...overrides });

  it('nasce com o onboarding em aberto', () => {
    const perfil = profile();

    expect(perfil.isOnboardingComplete()).toBe(false);
    expect(perfil.onboardingStep).toBe(0);
    expect(perfil.monthlyIncome.toCents()).toBe(0);
  });

  it('avanca o wizard, mas NUNCA retrocede', () => {
    // Voltar uma tela para revisar nao pode apagar o progresso de quem ja
    // chegou no passo 4.
    const perfil = profile();

    perfil.advanceTo(4);
    perfil.advanceTo(2);

    expect(perfil.onboardingStep).toBe(4);
  });

  it('nao passa do ultimo passo', () => {
    const perfil = profile();
    perfil.advanceTo(99);

    expect(perfil.onboardingStep).toBe(FinancialProfile.TOTAL_STEPS);
  });

  it('conclui o onboarding uma vez so', () => {
    const perfil = profile();
    const primeira = new Date('2026-01-01T00:00:00Z');

    perfil.completeOnboarding(primeira);
    perfil.completeOnboarding(new Date('2026-06-01T00:00:00Z'));

    expect(perfil.onboardingCompletedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(perfil.onboardingStep).toBe(5);
    expect(perfil.isOnboardingComplete()).toBe(true);
  });

  it('calcula a meta de economia sobre a renda', () => {
    const perfil = profile({
      monthlyIncome: Money.fromCents(850_000, 'BRL'),
      savingsTarget: percentage(2000),
    });

    expect(perfil.monthlySavingsGoal().toCents()).toBe(170_000);
  });

  it('sem meta definida, a economia esperada e zero', () => {
    const perfil = profile({ monthlyIncome: Money.fromCents(850_000, 'BRL') });

    expect(perfil.monthlySavingsGoal().toCents()).toBe(0);
  });

  it('registra renda e dia do pagamento', () => {
    const perfil = profile();
    perfil.setIncome(Money.fromCents(620_000, 'BRL'), 10);

    expect(perfil.monthlyIncome.toCents()).toBe(620_000);
    expect(perfil.payday).toBe(10);
  });
});
