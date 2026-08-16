import { type WorkspaceRole } from '@finapp/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { WorkspaceMember } from '../entities/workspace-member';
import { LastOwnerError, NotMemberError } from '../errors/workspace-errors';
import { MembershipList } from './membership-list';
import { Role } from './role';

const workspaceId = new UniqueEntityId();
const ana = new UniqueEntityId();
const bruno = new UniqueEntityId();
const carla = new UniqueEntityId();

const member = (userId: UniqueEntityId, role: WorkspaceRole): WorkspaceMember =>
  WorkspaceMember.create({ workspaceId, userId, role: Role.create(role) });

describe('MembershipList', () => {
  let members: MembershipList;

  beforeEach(() => {
    members = MembershipList.create([
      member(ana, 'OWNER'),
      member(bruno, 'MEMBER'),
      member(carla, 'ADMIN'),
    ]);
  });

  describe('consulta', () => {
    it('encontra membro por usuario', () => {
      expect(members.find(ana)?.role.value).toBe('OWNER');
      expect(members.includes(bruno)).toBe(true);
      expect(members.includes(new UniqueEntityId())).toBe(false);
    });

    it('lista os donos', () => {
      expect(members.owners()).toHaveLength(1);
      expect(members.size).toBe(3);
    });
  });

  describe('ultimo dono', () => {
    it('identifica o unico OWNER', () => {
      expect(members.isLastOwner(ana)).toBe(true);
      expect(members.isLastOwner(bruno)).toBe(false);
    });

    it('deixa de ser o ultimo quando ha outro dono', () => {
      const comDoisDonos = MembershipList.create([member(ana, 'OWNER'), member(bruno, 'OWNER')]);

      expect(comDoisDonos.isLastOwner(ana)).toBe(false);
    });

    it('impede REMOVER o ultimo dono', () => {
      // Sem dono, ninguem consegue mais excluir o workspace nem transferir posse.
      const result = members.remove(ana);

      expect(result.isLeft()).toBe(true);
      expect(result.isLeft() && result.value).toBeInstanceOf(LastOwnerError);
      expect(members.size).toBe(3);
    });

    it('impede REBAIXAR o ultimo dono', () => {
      const result = members.changeRole(ana, 'ADMIN');

      expect(result.isLeft() && result.value).toBeInstanceOf(LastOwnerError);
      expect(members.find(ana)?.role.value).toBe('OWNER');
    });

    it('permite sair quando ha outro dono', () => {
      const comDoisDonos = MembershipList.create([member(ana, 'OWNER'), member(bruno, 'OWNER')]);

      expect(comDoisDonos.remove(ana).isRight()).toBe(true);
      expect(comDoisDonos.size).toBe(1);
    });
  });

  describe('remocao', () => {
    it('remove membro comum', () => {
      const result = members.remove(bruno);

      expect(result.isRight()).toBe(true);
      expect(members.size).toBe(2);
      expect(members.includes(bruno)).toBe(false);
    });

    it('recusa remover quem nao e membro', () => {
      const result = members.remove(new UniqueEntityId());

      expect(result.isLeft() && result.value).toBeInstanceOf(NotMemberError);
    });
  });

  describe('troca de papel', () => {
    it('troca o papel de um membro', () => {
      expect(members.changeRole(bruno, 'ADMIN').isRight()).toBe(true);
      expect(members.find(bruno)?.role.value).toBe('ADMIN');
    });

    it('recusa quem nao e membro', () => {
      expect(members.changeRole(new UniqueEntityId(), 'ADMIN').isLeft()).toBe(true);
    });
  });

  describe('transferencia de posse', () => {
    it('promove o novo dono e rebaixa o antigo em uma operacao so', () => {
      // Em dois passos existiria uma janela com zero ou dois donos.
      const result = members.transferOwnership(ana, bruno);

      expect(result.isRight()).toBe(true);
      expect(members.find(bruno)?.role.value).toBe('OWNER');
      expect(members.find(ana)?.role.value).toBe('ADMIN');
      expect(members.owners()).toHaveLength(1);
    });

    it('recusa transferir para quem nao e membro', () => {
      const result = members.transferOwnership(ana, new UniqueEntityId());

      expect(result.isLeft() && result.value).toBeInstanceOf(NotMemberError);
      expect(members.find(ana)?.role.value).toBe('OWNER');
    });

    it('deixa o antigo dono podendo sair depois da transferencia', () => {
      members.transferOwnership(ana, bruno);

      expect(members.remove(ana).isRight()).toBe(true);
    });
  });
});
