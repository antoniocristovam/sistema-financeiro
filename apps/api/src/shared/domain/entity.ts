import { UniqueEntityId } from './unique-entity-id';

/**
 * Base de toda entidade do dominio.
 *
 * Identidade e' o id, nao os atributos: duas transacoes com o mesmo valor,
 * data e descricao sao lancamentos DIFERENTES. Por isso `equals` compara id.
 */
export abstract class Entity<Props> {
  protected props: Props;
  readonly #id: UniqueEntityId;

  protected constructor(props: Props, id?: UniqueEntityId) {
    this.props = props;
    this.#id = id ?? new UniqueEntityId();
  }

  get id(): UniqueEntityId {
    return this.#id;
  }

  equals(other?: Entity<unknown>): boolean {
    if (other === undefined || other === null) {
      return false;
    }

    if (other === this) {
      return true;
    }

    return this.#id.equals(other.id);
  }
}

/** Torna opcionais as chaves `K` de `T`. Usado nos `create` das entidades. */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
