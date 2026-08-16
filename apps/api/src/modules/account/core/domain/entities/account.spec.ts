import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Account } from './account';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');
const workspaceId = new UniqueEntityId();

const account = (overrides = {}): Account =>
  Account.create({
    workspaceId,
    name: 'Conta corrente',
    type: 'CHECKING',
    initialBalance: brl(450_000),
    ...overrides,
  });

describe('Account', () => {
  it('deriva o saldo do movimento, sem materializar', () => {
    // Guardar saldo materializado exigiria manter sincronia com toda insercao,
    // edicao e exclusao -- e o primeiro bug de sincronia deixa o saldo do app
    // diferente do saldo do banco.
    const corrente = account();

    expect(corrente.balanceWith(brl(-120_000)).toCents()).toBe(330_000);
    expect(corrente.balanceWith(brl(0)).toCents()).toBe(450_000);
  });

  it('identifica cartao de credito', () => {
    expect(account({ type: 'CREDIT_CARD' }).isCreditCard()).toBe(true);
    expect(account().isCreditCard()).toBe(false);
  });

  describe('arquivamento', () => {
    it('arquiva em vez de excluir', () => {
      const corrente = account();

      expect(corrente.isArchived()).toBe(false);
      expect(corrente.acceptsNewTransactions()).toBe(true);

      corrente.archive();

      expect(corrente.isArchived()).toBe(true);
      expect(corrente.acceptsNewTransactions()).toBe(false);
    });

    it('arquivar duas vezes nao move a data', () => {
      const corrente = account();
      corrente.archive(new Date('2026-01-01T00:00:00Z'));
      corrente.archive(new Date('2026-06-01T00:00:00Z'));

      expect(corrente.archivedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('desarquiva e volta a aceitar lancamento', () => {
      const corrente = account();
      corrente.archive();
      corrente.unarchive();

      expect(corrente.acceptsNewTransactions()).toBe(true);
    });
  });

  it('renomeia e ajusta aparencia', () => {
    const corrente = account();

    corrente.rename('Conta principal');
    corrente.updateAppearance({ color: '#22C55E', icon: 'wallet' });

    expect(corrente.name).toBe('Conta principal');
    expect(corrente.color).toBe('#22C55E');
    expect(corrente.icon).toBe('wallet');
  });
});
