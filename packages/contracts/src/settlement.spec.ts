import { describe, expect, it } from 'vitest';

import { createSettlementBodySchema, participantKeyOf } from './index.js';

describe('participantKeyOf', () => {
  it('usa o id quando a pessoa tem conta', () => {
    expect(
      participantKeyOf({ participantUserId: 'abc', email: 'a@b.com', name: 'Ana' }),
    ).toBe('user:abc');
  });

  it('cai para o e-mail quando nao ha conta', () => {
    expect(participantKeyOf({ email: 'Bruno@Example.com', name: 'Bruno' })).toBe(
      'email:bruno@example.com',
    );
  });

  it('normaliza para nao criar dois saldos da mesma pessoa', () => {
    // "Joao" e "  joao " sao o mesmo vizinho.
    expect(participantKeyOf({ name: 'Joao' })).toBe(participantKeyOf({ name: '  joao ' }));
  });

  it('separa pessoas diferentes', () => {
    expect(participantKeyOf({ name: 'Ana' })).not.toBe(participantKeyOf({ name: 'Bruno' }));
  });
});

describe('createSettlementBodySchema', () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    createSettlementBodySchema.safeParse({
      participantKey: 'name:bruno',
      participantName: 'Bruno',
      amountInCents: 5_000,
      direction: 'RECEIVED',
      ...overrides,
    });

  it('aceita um acerto simples', () => {
    expect(body().success).toBe(true);
  });

  it('exige a conta quando pede para registrar o lancamento', () => {
    // Sem conta nao ha onde o dinheiro entrar.
    expect(body({ createTransaction: true }).success).toBe(false);
    expect(
      body({ createTransaction: true, accountId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }).success,
    ).toBe(true);
  });

  it('recusa valor negativo: a direcao e quem diz o sentido', () => {
    expect(body({ amountInCents: -5_000 }).success).toBe(false);
  });

  it('recusa direcao desconhecida', () => {
    expect(body({ direction: 'MAYBE' }).success).toBe(false);
  });
});
