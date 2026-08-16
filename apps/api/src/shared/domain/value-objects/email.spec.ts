import { describe, expect, it } from 'vitest';

import { Email } from './email';

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) {
    throw new Error(`E-mail invalido no teste: ${value}`);
  }
  return result.value;
};

describe('Email', () => {
  it('normaliza na CRIACAO, nao na comparacao', () => {
    // E' isso que faz `Ana@Finapp.Local` colidir com `ana@finapp.local` no
    // indice unico do banco, em vez de virar duas contas.
    expect(email('  Ana@Finapp.Local ').value).toBe('ana@finapp.local');
    expect(email('ANA@FINAPP.LOCAL').equals(email('ana@finapp.local'))).toBe(true);
  });

  it('extrai o dominio', () => {
    expect(email('ana@finapp.local').domain).toBe('finapp.local');
    expect(email('ana@sub.exemplo.com.br').domain).toBe('sub.exemplo.com.br');
  });

  it('recusa formato invalido', () => {
    for (const invalid of ['', '   ', 'sem-arroba', 'ana@', '@dominio.com', 'ana@dominio', 'a b@c.com']) {
      expect(Email.create(invalid).isLeft(), invalid).toBe(true);
    }
  });

  it('recusa e-mail longo demais', () => {
    expect(Email.create(`${'a'.repeat(250)}@finapp.local`).isLeft()).toBe(true);
  });

  it('aceita formas validas comuns', () => {
    for (const valid of [
      'ana@finapp.local',
      'ana.ribeiro@finapp.com.br',
      'ana+cobranca@finapp.local',
      'ana_123@finapp.local',
    ]) {
      expect(Email.create(valid).isRight(), valid).toBe(true);
    }
  });
});
