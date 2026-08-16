import { type WorkspaceRole } from '@finapp/contracts';

import { type Either, left, right } from '../../../../../shared/either';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { LastOwnerError, NotMemberError } from '../errors/workspace-errors';
import { type WorkspaceMember } from '../entities/workspace-member';

/**
 * Conjunto de membros de um workspace.
 *
 * Existe para dar UM lugar a invariante do ultimo dono. Remover membro, sair,
 * rebaixar papel e transferir posse sao quatro operacoes diferentes que podem
 * deixar o workspace sem OWNER -- e sem dono ninguem consegue mais excluir o
 * workspace nem transferir a posse.
 *
 * Nao e' agregado carregado sempre: so os casos de uso que mexem em composicao
 * de membros pagam o custo de trazer a lista.
 */
export class MembershipList {
  readonly #members: WorkspaceMember[];

  private constructor(members: WorkspaceMember[]) {
    this.#members = members;
  }

  static create(members: WorkspaceMember[]): MembershipList {
    return new MembershipList([...members]);
  }

  get all(): readonly WorkspaceMember[] {
    return this.#members;
  }

  get size(): number {
    return this.#members.length;
  }

  find(userId: UniqueEntityId): WorkspaceMember | undefined {
    return this.#members.find((member) => member.is(userId));
  }

  includes(userId: UniqueEntityId): boolean {
    return this.find(userId) !== undefined;
  }

  owners(): WorkspaceMember[] {
    return this.#members.filter((member) => member.isOwner());
  }

  /** Verdadeiro quando tirar o OWNER deste usuario deixaria o workspace sem dono. */
  isLastOwner(userId: UniqueEntityId): boolean {
    const owners = this.owners();

    return owners.length === 1 && owners[0]?.is(userId) === true;
  }

  /** Sair ou ser removido. Falha se for o ultimo dono. */
  remove(userId: UniqueEntityId): Either<LastOwnerError | NotMemberError, WorkspaceMember> {
    const member = this.find(userId);

    if (!member) {
      return left(new NotMemberError());
    }

    if (this.isLastOwner(userId)) {
      return left(new LastOwnerError());
    }

    this.#members.splice(this.#members.indexOf(member), 1);

    return right(member);
  }

  /** Trocar papel. Rebaixar o ultimo dono e' o mesmo problema que remove-lo. */
  changeRole(
    userId: UniqueEntityId,
    role: WorkspaceRole,
  ): Either<LastOwnerError | NotMemberError, WorkspaceMember> {
    const member = this.find(userId);

    if (!member) {
      return left(new NotMemberError());
    }

    if (role !== 'OWNER' && this.isLastOwner(userId)) {
      return left(new LastOwnerError());
    }

    member.changeRole(role);

    return right(member);
  }

  /**
   * Transferencia de posse.
   *
   * O novo dono vira OWNER e o antigo cai para ADMIN, em uma operacao so --
   * nunca em dois passos, que abririam uma janela com zero ou dois donos.
   */
  transferOwnership(
    fromUserId: UniqueEntityId,
    toUserId: UniqueEntityId,
  ): Either<NotMemberError, { previousOwner: WorkspaceMember; newOwner: WorkspaceMember }> {
    const previousOwner = this.find(fromUserId);
    const newOwner = this.find(toUserId);

    if (!previousOwner || !newOwner) {
      return left(new NotMemberError());
    }

    newOwner.promoteToOwner();
    previousOwner.changeRole('ADMIN');

    return right({ previousOwner, newOwner });
  }
}
