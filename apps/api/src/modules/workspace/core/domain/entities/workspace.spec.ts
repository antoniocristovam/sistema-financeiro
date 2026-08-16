import { describe, expect, it } from 'vitest';

import { PersonalWorkspaceError } from '../errors/workspace-errors';
import { Workspace } from './workspace';

describe('Workspace', () => {
  it('cria workspace pessoal', () => {
    const pessoal = Workspace.createPersonal('Minhas financas', 'BRL');

    expect(pessoal.isPersonal()).toBe(true);
    expect(pessoal.isShared()).toBe(false);
    expect(pessoal.baseCurrency).toBe('BRL');
  });

  it('normaliza a moeda base', () => {
    expect(Workspace.createPersonal('Minhas financas', 'usd').baseCurrency).toBe('USD');
    expect(Workspace.create({ name: 'Casa', type: 'SHARED' }).baseCurrency).toBe('BRL');
  });

  it('workspace pessoal NAO aceita membro nem exclusao', () => {
    // Ele e' a carteira individual da pessoa; convidar alguem para ele nao faz
    // sentido -- para isso existe o SHARED.
    const pessoal = Workspace.createPersonal('Minhas financas', 'BRL');
    const result = pessoal.assertSupportsMembership('convidar membros');

    expect(result.isLeft() && result.value).toBeInstanceOf(PersonalWorkspaceError);
    expect(result.isLeft() && result.value.message).toContain('convidar membros');
  });

  it('workspace compartilhado aceita membros', () => {
    const casa = Workspace.create({ name: 'Casa', type: 'SHARED' });

    expect(casa.isShared()).toBe(true);
    expect(casa.assertSupportsMembership('convidar membros').isRight()).toBe(true);
  });

  it('renomeia e troca a moeda base', () => {
    const casa = Workspace.create({ name: 'Casa', type: 'SHARED' });

    casa.rename('Casa nova');
    casa.changeBaseCurrency('usd');

    expect(casa.name).toBe('Casa nova');
    expect(casa.baseCurrency).toBe('USD');
  });
});
