import { Locale, Theme } from '@finapp/contracts';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';

export interface UserProps {
  name: string;
  email: Email;
  /** Argon2id. A senha em claro nunca entra no dominio. */
  passwordHash: string;
  locale: Locale;
  /** Moeda preferida. Vira a `baseCurrency` do workspace pessoal. */
  currency: string;
  theme: Theme;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Usuario da plataforma.
 *
 * Repare no que NAO esta aqui: contas, transacoes, orcamentos. Nada disso
 * pertence ao usuario -- pertence ao WORKSPACE. O usuario e' so identidade e
 * preferencia de apresentacao.
 */
export class User extends Entity<UserProps> {
  static create(
    props: Optional<
      UserProps,
      'locale' | 'currency' | 'theme' | 'emailVerifiedAt' | 'createdAt' | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): User {
    const now = new Date();

    return new User(
      {
        ...props,
        locale: props.locale ?? Locale.PT_BR,
        currency: (props.currency ?? 'BRL').toUpperCase(),
        theme: props.theme ?? Theme.SYSTEM,
        emailVerifiedAt: props.emailVerifiedAt ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get name(): string {
    return this.props.name;
  }

  get email(): Email {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get locale(): Locale {
    return this.props.locale;
  }

  get currency(): string {
    return this.props.currency;
  }

  get theme(): Theme {
    return this.props.theme;
  }

  get emailVerifiedAt(): Date | null {
    return this.props.emailVerifiedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isEmailVerified(): boolean {
    return this.props.emailVerifiedAt !== null;
  }

  /** Idempotente: reverificar nao move a data original. */
  verifyEmail(now: Date = new Date()): void {
    if (this.props.emailVerifiedAt === null) {
      this.props.emailVerifiedAt = now;
      this.touch();
    }
  }

  changePassword(passwordHash: string): void {
    this.props.passwordHash = passwordHash;
    this.touch();
  }

  updateProfile(changes: {
    name?: string;
    locale?: Locale;
    theme?: Theme;
    currency?: string;
  }): void {
    if (changes.name !== undefined) this.props.name = changes.name;
    if (changes.locale !== undefined) this.props.locale = changes.locale;
    if (changes.theme !== undefined) this.props.theme = changes.theme;
    if (changes.currency !== undefined) this.props.currency = changes.currency.toUpperCase();

    this.touch();
  }

  /** Tag BCP-47 para o `Intl`. O formato e' do usuario; a moeda, do workspace. */
  localeTag(): string {
    return this.props.locale === Locale.EN_US ? 'en-US' : 'pt-BR';
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
