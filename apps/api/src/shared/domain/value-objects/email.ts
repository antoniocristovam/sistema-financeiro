import { type Either, left, right } from '../../either';
import { InvalidValueError } from '../errors/common-errors';
import { ValueObject } from '../value-object';

interface EmailProps {
  value: string;
}

/**
 * E-mail normalizado.
 *
 * A normalizacao (trim + minusculo) acontece na CRIACAO, nao na comparacao. E'
 * o que garante que `Ana@Finapp.local` e `ana@finapp.local` colidem no indice
 * unico do banco em vez de virarem duas contas.
 */
export class Email extends ValueObject<EmailProps> {
  private constructor(props: EmailProps) {
    super(props);
  }

  static create(value: string): Either<InvalidValueError, Email> {
    const normalized = value.trim().toLowerCase();

    if (normalized.length === 0) {
      return left(new InvalidValueError('Informe um e-mail.', 'email'));
    }

    if (normalized.length > 255) {
      return left(new InvalidValueError('E-mail longo demais.', 'email'));
    }

    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(normalized)) {
      return left(new InvalidValueError('E-mail invalido.', 'email'));
    }

    return right(new Email({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }

  get domain(): string {
    return this.props.value.slice(this.props.value.indexOf('@') + 1);
  }

  override toString(): string {
    return this.props.value;
  }
}
