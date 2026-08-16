import { describe, expect, it } from 'vitest';

import {
  changePasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from './auth.js';
import { inviteMemberBodySchema, invitableRoleSchema } from './workspace.js';

describe('registerBodySchema', () => {
  it('aceita cadastro valido e normaliza o e-mail', () => {
    const result = registerBodySchema.parse({
      name: '  Ana Ribeiro ',
      email: 'ANA@Finapp.Local',
      password: 'Finapp@123',
    });

    expect(result).toEqual({
      name: 'Ana Ribeiro',
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });
  });

  it('recusa senha fraca', () => {
    const result = registerBodySchema.safeParse({
      name: 'Ana',
      email: 'ana@finapp.local',
      password: 'senha',
    });

    expect(result.success).toBe(false);
  });

  it('recusa nome vazio', () => {
    const result = registerBodySchema.safeParse({
      name: '   ',
      email: 'ana@finapp.local',
      password: 'Finapp@123',
    });

    expect(result.success).toBe(false);
  });
});

describe('loginBodySchema', () => {
  it('nao aplica regra de forca na senha do login', () => {
    // Se aplicasse, quem tem senha antiga nao conseguiria nem tentar entrar.
    const result = loginBodySchema.safeParse({ email: 'ana@finapp.local', password: 'antiga' });

    expect(result.success).toBe(true);
  });

  it('exige senha nao vazia', () => {
    const result = loginBodySchema.safeParse({ email: 'ana@finapp.local', password: '' });

    expect(result.success).toBe(false);
  });
});

describe('resetPasswordBodySchema', () => {
  it('exige confirmacao igual', () => {
    const ok = resetPasswordBodySchema.safeParse({
      token: 'abc',
      password: 'Finapp@123',
      passwordConfirmation: 'Finapp@123',
    });

    const divergente = resetPasswordBodySchema.safeParse({
      token: 'abc',
      password: 'Finapp@123',
      passwordConfirmation: 'Finapp@124',
    });

    expect(ok.success).toBe(true);
    expect(divergente.success).toBe(false);
    expect(divergente.error?.issues[0]?.path).toEqual(['passwordConfirmation']);
  });
});

describe('changePasswordBodySchema', () => {
  it('recusa nova senha igual a atual', () => {
    const result = changePasswordBodySchema.safeParse({
      currentPassword: 'Finapp@123',
      password: 'Finapp@123',
      passwordConfirmation: 'Finapp@123',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['password']);
  });
});

describe('convite de membro', () => {
  it('aceita ADMIN, MEMBER e VIEWER', () => {
    for (const role of ['ADMIN', 'MEMBER', 'VIEWER']) {
      expect(invitableRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('recusa convidar como OWNER: posse se transfere, nao se convida', () => {
    const result = inviteMemberBodySchema.safeParse({
      email: 'bruno@finapp.local',
      role: 'OWNER',
    });

    expect(result.success).toBe(false);
  });
});
