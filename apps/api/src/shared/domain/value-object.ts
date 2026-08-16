/**
 * Base de todo Value Object.
 *
 * Ao contrario da entidade, VO nao tem identidade: dois `CalendarDate` do
 * mesmo dia SAO o mesmo valor. Por isso `equals` compara conteudo, e por isso
 * VO e' imutavel -- toda operacao devolve uma instancia nova.
 */
export abstract class ValueObject<Props> {
  protected readonly props: Props;

  protected constructor(props: Props) {
    this.props = Object.freeze(props);
  }

  equals(other?: ValueObject<Props>): boolean {
    if (other === undefined || other === null) {
      return false;
    }

    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
