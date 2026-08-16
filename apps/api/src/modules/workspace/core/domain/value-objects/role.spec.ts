import { type WorkspacePermission, type WorkspaceRole } from '@finapp/contracts';
import { describe, expect, it } from 'vitest';

import { Role } from './role';

/**
 * A matriz do documento, replicada aqui de proposito.
 *
 * O teste NAO importa `WORKSPACE_PERMISSIONS` -- se importasse, estaria
 * comparando a tabela com ela mesma e passaria mesmo se a tabela estivesse
 * errada. Esta copia e' a especificacao escrita a mao.
 */
const EXPECTED: Record<WorkspacePermission, WorkspaceRole[]> = {
  'data:read': ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  'transaction:write': ['OWNER', 'ADMIN', 'MEMBER'],
  'account:manage': ['OWNER', 'ADMIN'],
  'category:manage': ['OWNER', 'ADMIN'],
  'member:manage': ['OWNER', 'ADMIN'],
  'workspace:delete': ['OWNER'],
  'workspace:transfer-ownership': ['OWNER'],
};

const ALL_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

describe('Role', () => {
  describe('matriz de permissoes', () => {
    for (const [permission, allowed] of Object.entries(EXPECTED) as [
      WorkspacePermission,
      WorkspaceRole[],
    ][]) {
      for (const role of ALL_ROLES) {
        const shouldAllow = allowed.includes(role);

        it(`${role} ${shouldAllow ? 'pode' : 'NAO pode'} ${permission}`, () => {
          expect(Role.create(role).can(permission)).toBe(shouldAllow);
        });
      }
    }
  });

  describe('regras que a tabela resume', () => {
    it('VIEWER so le', () => {
      const viewer = Role.create('VIEWER');

      expect(viewer.can('data:read')).toBe(true);
      expect(viewer.can('transaction:write')).toBe(false);
      expect(viewer.can('account:manage')).toBe(false);
      expect(viewer.can('member:manage')).toBe(false);
    });

    it('MEMBER lanca, mas nao gerencia estrutura', () => {
      const member = Role.create('MEMBER');

      expect(member.can('transaction:write')).toBe(true);
      expect(member.can('account:manage')).toBe(false);
      expect(member.can('category:manage')).toBe(false);
      expect(member.can('member:manage')).toBe(false);
    });

    it('ADMIN gerencia tudo, menos excluir e transferir posse', () => {
      const admin = Role.create('ADMIN');

      expect(admin.can('account:manage')).toBe(true);
      expect(admin.can('member:manage')).toBe(true);
      expect(admin.can('workspace:delete')).toBe(false);
      expect(admin.can('workspace:transfer-ownership')).toBe(false);
    });

    it('OWNER pode tudo', () => {
      const owner = Role.owner();

      for (const permission of Object.keys(EXPECTED) as WorkspacePermission[]) {
        expect(owner.can(permission), permission).toBe(true);
      }
    });
  });

  describe('hierarquia', () => {
    it('ordena o poder dos papeis', () => {
      expect(Role.create('OWNER').outranks(Role.create('ADMIN'))).toBe(true);
      expect(Role.create('ADMIN').outranks(Role.create('MEMBER'))).toBe(true);
      expect(Role.create('MEMBER').outranks(Role.create('VIEWER'))).toBe(true);
      expect(Role.create('VIEWER').outranks(Role.create('MEMBER'))).toBe(false);
    });

    it('isAtLeast inclui o proprio papel', () => {
      expect(Role.create('ADMIN').isAtLeast(Role.create('ADMIN'))).toBe(true);
      expect(Role.create('ADMIN').isAtLeast(Role.create('OWNER'))).toBe(false);
    });

    it('hierarquia NAO substitui a matriz', () => {
      // ADMIN esta acima de MEMBER, e mesmo assim nao pode excluir o workspace.
      // Se alguem trocar `can` por comparacao de rank, este teste cai.
      expect(Role.create('ADMIN').outranks(Role.create('MEMBER'))).toBe(true);
      expect(Role.create('ADMIN').can('workspace:delete')).toBe(false);
    });

    it('identifica os papeis extremos', () => {
      expect(Role.create('OWNER').isOwner()).toBe(true);
      expect(Role.create('ADMIN').isOwner()).toBe(false);
      expect(Role.create('VIEWER').isViewer()).toBe(true);
    });
  });
});
