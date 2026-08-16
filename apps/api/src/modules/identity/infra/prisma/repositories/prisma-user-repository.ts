import { Injectable } from '@nestjs/common';

import { PrismaTransactionManager } from '../../../../../shared/database/prisma-transaction-manager';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';
import { type FinancialProfile } from '../../../core/domain/entities/financial-profile';
import { type User } from '../../../core/domain/entities/user';
import { type UserRepository } from '../../../core/domain/repositories/user-repository';
import { FinancialProfileMapper, UserMapper } from '../mappers/user-mapper';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tx: PrismaTransactionManager) {}

  async findById(id: UniqueEntityId): Promise<User | null> {
    const raw = await this.tx.client.user.findUnique({ where: { id: id.toValue() } });

    return raw ? UserMapper.toDomain(raw) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const raw = await this.tx.client.user.findUnique({ where: { email: email.value } });

    return raw ? UserMapper.toDomain(raw) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const count = await this.tx.client.user.count({ where: { email: email.value } });

    return count > 0;
  }

  async findManyByIds(ids: UniqueEntityId[]): Promise<Map<string, User>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.tx.client.user.findMany({
      where: { id: { in: ids.map((id) => id.toValue()) } },
    });

    return new Map(rows.map((row) => [row.id, UserMapper.toDomain(row)]));
  }

  /** Upsert porque a mesma entidade serve para criar e atualizar. */
  async save(user: User): Promise<void> {
    const data = UserMapper.toPrisma(user);

    await this.tx.client.user.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        locale: data.locale,
        currency: data.currency,
        theme: data.theme,
        emailVerifiedAt: data.emailVerifiedAt,
      },
    });
  }

  async findProfileByUserId(userId: UniqueEntityId): Promise<FinancialProfile | null> {
    const raw = await this.tx.client.financialProfile.findUnique({
      where: { userId: userId.toValue() },
      include: { user: { select: { currency: true } } },
    });

    return raw ? FinancialProfileMapper.toDomain(raw, raw.user.currency) : null;
  }

  async saveProfile(profile: FinancialProfile): Promise<void> {
    const data = FinancialProfileMapper.toPrisma(profile);

    await this.tx.client.financialProfile.upsert({
      where: { userId: data.userId },
      create: data,
      update: {
        monthlyIncomeInCents: data.monthlyIncomeInCents,
        payday: data.payday,
        savingsTargetPercent: data.savingsTargetPercent,
        onboardingStep: data.onboardingStep,
        onboardingCompletedAt: data.onboardingCompletedAt,
      },
    });
  }
}
