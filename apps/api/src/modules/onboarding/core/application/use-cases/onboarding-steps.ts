import { AccountType, OnboardingStep, type WorkspacePermission } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { type Clock } from '../../../../../shared/application/ports/clock';
import { type UnitOfWork } from '../../../../../shared/application/ports/unit-of-work';
import {
  InvalidValueError,
  ResourceNotFoundError,
} from '../../../../../shared/domain/errors/common-errors';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Percentage } from '../../../../../shared/domain/value-objects/percentage';
import { type Either, left, right } from '../../../../../shared/either';
import { Account } from '../../../../account/core/domain/entities/account';
import { type AccountRepository } from '../../../../account/core/domain/repositories/account-repository';
import { BillingCycle } from '../../../../account/core/domain/value-objects/billing-cycle';
import { type Category } from '../../../../category/core/domain/entities/category';
import { type CategoryRepository } from '../../../../category/core/domain/repositories/category-repository';
import { FinancialProfile } from '../../../../identity/core/domain/entities/financial-profile';
import { type UserRepository } from '../../../../identity/core/domain/repositories/user-repository';
import {
  type AccessError,
  type WorkspaceAccessService,
} from '../../../../workspace/core/application/services/workspace-access';

/**
 * Passos do wizard de onboarding.
 *
 * Cada passo grava assim que o usuario avanca -- fechar o navegador no passo 3
 * nao perde os dois primeiros. E' o que torna o wizard retomavel, e por isso
 * eles sao operacoes independentes em vez de um unico POST no final.
 *
 * O perfil registra o ultimo passo CONCLUIDO, e `advanceTo` nunca retrocede:
 * voltar uma tela para revisar nao pode apagar o progresso.
 */

type StepError = AccessError | InvalidValueError | ResourceNotFoundError;

/** Permissao exigida em todo passo que cria dado no workspace. */
const MANAGE: WorkspacePermission = 'account:manage';

/**
 * Carrega (ou cria) o perfil financeiro do usuario.
 *
 * O perfil nasce no cadastro, mas cria-lo aqui se faltar evita que um dado
 * inconsistente trave o onboarding inteiro.
 */
async function loadProfile(
  users: UserRepository,
  userId: UniqueEntityId,
  currency: string,
): Promise<FinancialProfile> {
  const existing = await users.findProfileByUserId(userId);

  return existing ?? FinancialProfile.create({ userId, currency });
}

// -- Passo 1: renda -----------------------------------------------------------

export interface IncomeStepInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
  monthlyIncomeInCents: number;
  payday: number | null;
}

export class SaveIncomeStepUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly users: UserRepository,
  ) {}

  async execute(input: IncomeStepInput): Promise<Either<StepError, void>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, MANAGE);

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const currency = authorized.value.workspace.baseCurrency;
    const profile = await loadProfile(this.users, input.userId, currency);

    profile.setIncome(Money.fromCents(input.monthlyIncomeInCents, currency), input.payday);
    profile.advanceTo(OnboardingStep.INCOME);

    await this.users.saveProfile(profile);

    return right(undefined);
  }
}

// -- Passo 2: primeira conta --------------------------------------------------

export interface FirstAccountStepInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'CASH' | 'INVESTMENT';
  initialBalanceInCents: number;
  institution?: string;
  color?: string;
  icon?: string;
}

export class CreateFirstAccountStepUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly users: UserRepository,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: FirstAccountStepInput): Promise<Either<StepError, Account>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, MANAGE);

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const currency = authorized.value.workspace.baseCurrency;
    const now = this.clock.now();

    const account = Account.create({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      type: input.type,
      initialBalance: Money.fromCents(input.initialBalanceInCents, currency),
      institution: input.institution?.trim() ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const profile = await loadProfile(this.users, input.userId, currency);
    profile.advanceTo(OnboardingStep.FIRST_ACCOUNT);

    await this.unitOfWork.run(async () => {
      await this.accounts.create(account);
      await this.users.saveProfile(profile);
    });

    return right(account);
  }
}

// -- Passo 3: cartoes de credito (opcional) -----------------------------------

export interface CreditCardInput {
  name: string;
  limitInCents: number;
  closingDay: number;
  dueDay: number;
  institution?: string;
  color?: string;
}

export interface CreditCardsStepInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
  cards: CreditCardInput[];
}

/**
 * Passo opcional: pular manda uma lista vazia e o wizard avanca.
 *
 * A conta do cartao e' criada com saldo inicial ZERO. A divida do cartao nao e'
 * saldo de conta -- ela vive na fatura, e o saldo so se mexe quando a fatura e'
 * paga (regra 5).
 */
export class AddCreditCardsStepUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly accounts: AccountRepository,
    private readonly users: UserRepository,
    private readonly clock: Clock,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreditCardsStepInput): Promise<Either<StepError, Account[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, MANAGE);

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const currency = authorized.value.workspace.baseCurrency;
    const now = this.clock.now();
    const created: { account: Account; cycle: BillingCycle; limitInCents: number }[] = [];

    for (const card of input.cards) {
      const cycle = BillingCycle.create(card.closingDay, card.dueDay);

      if (cycle.isLeft()) {
        return left(cycle.value);
      }

      created.push({
        limitInCents: card.limitInCents,
        account: Account.create({
          workspaceId: input.workspaceId,
          name: card.name.trim(),
          type: AccountType.CREDIT_CARD,
          initialBalance: Money.zero(currency),
          institution: card.institution?.trim() ?? null,
          color: card.color ?? null,
          icon: 'credit-card',
          createdAt: now,
          updatedAt: now,
        }),
        cycle: cycle.value,
      });
    }

    const profile = await loadProfile(this.users, input.userId, currency);
    profile.advanceTo(OnboardingStep.CREDIT_CARDS);

    await this.unitOfWork.run(async () => {
      for (const { account, cycle, limitInCents } of created) {
        await this.accounts.create(account, cycle, limitInCents);
      }

      await this.users.saveProfile(profile);
    });

    return right(created.map((entry) => entry.account));
  }
}

// -- Passo 4: categorias ------------------------------------------------------

export interface CategoriesStepInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
  systemKeys: string[];
}

/**
 * Copia as categorias semente escolhidas para o workspace.
 *
 * COPIA, e nao referencia: a semente do sistema nao e' editavel, e o usuario
 * precisa poder renomear, trocar icone e arquivar as dele. O `systemKey` viaja
 * na copia, o que permite reexecutar o passo sem duplicar o que ja foi copiado.
 *
 * As subcategorias vao junto com a mae -- escolher "Alimentacao" sem trazer
 * "Mercado" e "Restaurante" deixaria a arvore pela metade.
 */
export class SelectCategoriesStepUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly categories: CategoryRepository,
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CategoriesStepInput): Promise<Either<StepError, Category[]>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, MANAGE);

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    const alreadyCopied = new Set(await this.categories.listCopiedSystemKeys(input.workspaceId));
    const wanted = input.systemKeys.filter((key) => !alreadyCopied.has(key));

    const seeds = await this.categories.findSystemByKeys(wanted);
    const roots = seeds.filter((seed) => seed.isRoot());

    if (wanted.length > 0 && roots.length === 0) {
      return left(new ResourceNotFoundError('Categoria'));
    }

    const copies: Category[] = [];

    for (const root of roots) {
      const copy = root.copyToWorkspace(input.workspaceId);
      copies.push(copy);

      // As filhas vem junto com a mae. `findSystemByKeys` ja as devolve, mesmo
      // sem terem sido pedidas: uma categoria-mae sem subcategoria deixa o
      // drill-down do relatorio vazio.
      for (const child of seeds.filter((seed) => seed.parentId?.equals(root.id) === true)) {
        copies.push(child.copyToWorkspace(input.workspaceId, copy.id));
      }
    }

    const profile = await loadProfile(
      this.users,
      input.userId,
      authorized.value.workspace.baseCurrency,
    );
    profile.advanceTo(OnboardingStep.CATEGORIES);

    await this.unitOfWork.run(async () => {
      if (copies.length > 0) {
        await this.categories.createMany(copies);
      }

      await this.users.saveProfile(profile);
    });

    return right(copies);
  }
}

// -- Passo 5: meta de economia ------------------------------------------------

export interface SavingsTargetStepInput {
  userId: UniqueEntityId;
  workspaceId: UniqueEntityId;
  savingsTargetPercent: number | null;
}

export class SetSavingsTargetStepUseCase {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly users: UserRepository,
  ) {}

  async execute(input: SavingsTargetStepInput): Promise<Either<StepError, void>> {
    const authorized = await this.access.authorize(input.workspaceId, input.userId, MANAGE);

    if (authorized.isLeft()) {
      return left(authorized.value);
    }

    let target: Percentage | null = null;

    if (input.savingsTargetPercent !== null) {
      const parsed = Percentage.fromBasisPoints(input.savingsTargetPercent);

      if (parsed.isLeft()) {
        return left(parsed.value);
      }

      target = parsed.value;
    }

    const profile = await loadProfile(
      this.users,
      input.userId,
      authorized.value.workspace.baseCurrency,
    );

    profile.setSavingsTarget(target);
    profile.advanceTo(OnboardingStep.SAVINGS_TARGET);

    await this.users.saveProfile(profile);

    return right(undefined);
  }
}
