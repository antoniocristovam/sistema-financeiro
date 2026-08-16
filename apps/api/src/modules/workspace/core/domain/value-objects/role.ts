import {
  roleHasPermission,
  WorkspaceRole,
  type WorkspacePermission,
} from '@finapp/contracts';

import { ValueObject } from '../../../../../shared/domain/value-object';

interface RoleProps {
  value: WorkspaceRole;
}

/**
 * Papel de um membro dentro de um workspace.
 *
 * A matriz de permissoes mora em `@finapp/contracts` e vale para os dois lados:
 * o web usa para esconder o que o papel nao pode fazer, o dominio usa para
 * DECIDIR. Sao usos diferentes da mesma tabela -- o front e' ergonomia, a
 * barreira e' aqui.
 *
 * A decisao acontece no caso de uso, nunca no controller: qualquer novo ponto
 * de entrada (job, CLI, webhook) nasceria sem protecao se a regra ficasse na
 * camada HTTP.
 */
export class Role extends ValueObject<RoleProps> {
  /** Ordem de poder. So serve para comparar, nunca para decidir permissao. */
  private static readonly RANK: Record<WorkspaceRole, number> = {
    VIEWER: 0,
    MEMBER: 1,
    ADMIN: 2,
    OWNER: 3,
  };

  private constructor(props: RoleProps) {
    super(props);
  }

  static create(value: WorkspaceRole): Role {
    return new Role({ value });
  }

  static owner(): Role {
    return new Role({ value: WorkspaceRole.OWNER });
  }

  get value(): WorkspaceRole {
    return this.props.value;
  }

  /**
   * Unica porta de decisao de permissao.
   *
   * Nao existe `if (role === 'ADMIN')` espalhado pelo codigo: um papel novo
   * exigiria caçar todos eles. Aqui muda a matriz e pronto.
   */
  can(permission: WorkspacePermission): boolean {
    return roleHasPermission(this.props.value, permission);
  }

  isOwner(): boolean {
    return this.props.value === WorkspaceRole.OWNER;
  }

  isViewer(): boolean {
    return this.props.value === WorkspaceRole.VIEWER;
  }

  /** Compara poder. Usado para impedir que um ADMIN promova alguem a OWNER. */
  isAtLeast(other: Role): boolean {
    return Role.RANK[this.props.value] >= Role.RANK[other.value];
  }

  outranks(other: Role): boolean {
    return Role.RANK[this.props.value] > Role.RANK[other.value];
  }

  override toString(): string {
    return this.props.value;
  }
}
