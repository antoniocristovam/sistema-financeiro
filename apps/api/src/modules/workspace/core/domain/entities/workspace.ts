import { WorkspaceType } from '@finapp/contracts';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { PersonalWorkspaceError } from '../errors/workspace-errors';
import { type Either, left, right } from '../../../../../shared/either';

export interface WorkspaceProps {
  name: string;
  type: WorkspaceType;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Unidade de POSSE dos dados.
 *
 * Conta, transacao, categoria, orcamento e meta pertencem a um workspace --
 * nunca a um usuario. Essa e' a decisao estrutural do sistema: comecar com
 * `userId` nas tabelas e migrar depois significaria reescrever todo
 * repositorio, todo caso de uso e todo teste.
 *
 * Todo usuario ganha um workspace PERSONAL no cadastro. O PERSONAL nao aceita
 * membro nem exclusao -- ele e' a carteira individual da pessoa.
 */
export class Workspace extends Entity<WorkspaceProps> {
  static create(
    props: Optional<WorkspaceProps, 'createdAt' | 'updatedAt' | 'baseCurrency'>,
    id?: UniqueEntityId,
  ): Workspace {
    const now = new Date();

    return new Workspace(
      {
        ...props,
        baseCurrency: (props.baseCurrency ?? 'BRL').toUpperCase(),
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  /** Criado junto com a conta do usuario, no cadastro. */
  static createPersonal(name: string, baseCurrency: string, id?: UniqueEntityId): Workspace {
    return Workspace.create({ name, type: WorkspaceType.PERSONAL, baseCurrency }, id);
  }

  get name(): string {
    return this.props.name;
  }

  get type(): WorkspaceType {
    return this.props.type;
  }

  get baseCurrency(): string {
    return this.props.baseCurrency;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isPersonal(): boolean {
    return this.props.type === WorkspaceType.PERSONAL;
  }

  isShared(): boolean {
    return this.props.type === WorkspaceType.SHARED;
  }

  rename(name: string): void {
    this.props.name = name;
    this.touch();
  }

  /**
   * Trocar a moeda base nao converte valor nenhum -- os centavos gravados
   * continuam os mesmos. Por isso so e' permitido enquanto nao ha lancamento,
   * checagem que o caso de uso faz antes de chamar.
   */
  changeBaseCurrency(currency: string): void {
    this.props.baseCurrency = currency.toUpperCase();
    this.touch();
  }

  /** Convidar, remover membro e excluir workspace nao valem no PERSONAL. */
  assertSupportsMembership(action: string): Either<PersonalWorkspaceError, void> {
    if (this.isPersonal()) {
      return left(new PersonalWorkspaceError(action));
    }

    return right(undefined);
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
