import { AccountType } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';

export interface AccountProps {
  workspaceId: UniqueEntityId;
  name: string;
  type: AccountType;
  initialBalance: Money;
  institution: string | null;
  color: string | null;
  icon: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conta ou carteira. Pertence ao WORKSPACE, nunca a um usuario.
 *
 * `initialBalance` e' o saldo de abertura informado no onboarding. O saldo
 * atual NAO mora aqui: ele e' derivado dos lancamentos, calculado pelo
 * repositorio. Guardar um saldo materializado significaria mantê-lo em sincronia
 * com toda insercao, edicao e exclusao -- e o primeiro bug de sincronia deixa o
 * saldo do app diferente do saldo do banco, que e' o pior erro possivel aqui.
 */
export class Account extends Entity<AccountProps> {
  static create(
    props: Optional<
      AccountProps,
      'institution' | 'color' | 'icon' | 'archivedAt' | 'createdAt' | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): Account {
    const now = new Date();

    return new Account(
      {
        ...props,
        institution: props.institution ?? null,
        color: props.color ?? null,
        icon: props.icon ?? null,
        archivedAt: props.archivedAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get name(): string {
    return this.props.name;
  }

  get type(): AccountType {
    return this.props.type;
  }

  get initialBalance(): Money {
    return this.props.initialBalance;
  }

  get institution(): string | null {
    return this.props.institution;
  }

  get color(): string | null {
    return this.props.color;
  }

  get icon(): string | null {
    return this.props.icon;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isCreditCard(): boolean {
    return this.props.type === AccountType.CREDIT_CARD;
  }

  isArchived(): boolean {
    return this.props.archivedAt !== null;
  }

  /**
   * Compra em cartao nao move o saldo da conta na data da compra (regra 5), e
   * conta arquivada nao recebe lancamento novo.
   */
  acceptsNewTransactions(): boolean {
    return !this.isArchived();
  }

  /** Saldo atual = abertura + movimento, calculado pelo repositorio. */
  balanceWith(movement: Money): Money {
    return this.props.initialBalance.plus(movement);
  }

  rename(name: string): void {
    this.props.name = name;
    this.touch();
  }

  updateAppearance(changes: { color?: string | null; icon?: string | null }): void {
    if (changes.color !== undefined) this.props.color = changes.color;
    if (changes.icon !== undefined) this.props.icon = changes.icon;
    this.touch();
  }

  changeInstitution(institution: string | null): void {
    this.props.institution = institution === null ? null : institution.trim() || null;
    this.touch();
  }

  /**
   * Corrige o saldo de abertura.
   *
   * E' a forma de acertar a conta com o extrato do banco sem inventar um
   * lancamento de ajuste: o saldo atual e' derivado da abertura mais os
   * lancamentos, entao mexer na abertura desloca a serie inteira -- que e'
   * exatamente o que se quer quando o valor inicial foi digitado errado.
   */
  changeInitialBalance(initialBalance: Money): void {
    this.props.initialBalance = initialBalance;
    this.touch();
  }

  /** Arquivar em vez de excluir: ha historico pendurado na conta. */
  archive(now: Date = new Date()): void {
    if (this.props.archivedAt === null) {
      this.props.archivedAt = now;
      this.touch();
    }
  }

  unarchive(): void {
    if (this.props.archivedAt !== null) {
      this.props.archivedAt = null;
      this.touch();
    }
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
