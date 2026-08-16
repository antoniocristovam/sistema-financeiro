import { type FinancialProfile as PrismaProfile, type User as PrismaUser } from '@prisma/client';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { Percentage } from '../../../../../shared/domain/value-objects/percentage';
import { Money } from '@finapp/money';
import { FinancialProfile } from '../../../core/domain/entities/financial-profile';
import { User } from '../../../core/domain/entities/user';

/**
 * Traducao entre o modelo do Prisma e a entidade de dominio.
 *
 * O mapper e' o unico lugar do sistema que conhece as duas formas. Sem ele, o
 * formato do banco vazaria para o dominio (ou o contrario), e trocar uma coluna
 * viraria refatoracao de caso de uso.
 *
 * `toDomain` usa os construtores tolerantes: os dados JA estao no banco, e uma
 * validacao falhando aqui derrubaria a leitura de um registro existente em vez
 * de impedir uma escrita ruim -- que e' o papel da validacao na entrada.
 */
export class UserMapper {
  static toDomain(raw: PrismaUser): User {
    const email = Email.create(raw.email);

    if (email.isLeft()) {
      throw new Error(`E-mail invalido no banco (user ${raw.id}): ${raw.email}`);
    }

    return User.create(
      {
        name: raw.name,
        email: email.value,
        passwordHash: raw.passwordHash,
        locale: raw.locale,
        currency: raw.currency,
        theme: raw.theme,
        emailVerifiedAt: raw.emailVerifiedAt,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(user: User) {
    return {
      id: user.id.toValue(),
      name: user.name,
      email: user.email.value,
      passwordHash: user.passwordHash,
      locale: user.locale,
      currency: user.currency,
      theme: user.theme,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export class FinancialProfileMapper {
  static toDomain(raw: PrismaProfile, currency: string): FinancialProfile {
    let savingsTarget: Percentage | null = null;

    if (raw.savingsTargetPercent !== null) {
      const parsed = Percentage.fromBasisPoints(raw.savingsTargetPercent);
      savingsTarget = parsed.isRight() ? parsed.value : null;
    }

    return FinancialProfile.create(
      {
        userId: new UniqueEntityId(raw.userId),
        monthlyIncome: Money.fromCents(raw.monthlyIncomeInCents, currency),
        payday: raw.payday,
        savingsTarget,
        onboardingStep: raw.onboardingStep,
        onboardingCompletedAt: raw.onboardingCompletedAt,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
      new UniqueEntityId(raw.id),
    );
  }

  static toPrisma(profile: FinancialProfile) {
    return {
      id: profile.id.toValue(),
      userId: profile.userId.toValue(),
      monthlyIncomeInCents: profile.monthlyIncome.toCents(),
      payday: profile.payday,
      savingsTargetPercent: profile.savingsTarget?.basisPoints ?? null,
      onboardingStep: profile.onboardingStep,
      onboardingCompletedAt: profile.onboardingCompletedAt,
    };
  }
}
