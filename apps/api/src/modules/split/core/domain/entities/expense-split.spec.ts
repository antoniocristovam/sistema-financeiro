import { Money } from '@finapp/money';
import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import { ExpenseSplit } from './expense-split';

const brl = (cents: number): Money => Money.fromCents(cents, 'BRL');

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) throw new Error(`E-mail invalido: ${value}`);
  return result.value;
};

const workspaceId = new UniqueEntityId();
const transactionId = new UniqueEntityId();

const split = (overrides = {}): ExpenseSplit =>
  ExpenseSplit.create({
    workspaceId,
    transactionId,
    participantName: 'Bruno Alves',
    participantEmail: email('bruno@finapp.local'),
    shareType: 'EQUAL',
    amount: brl(3333),
    ...overrides,
  });

describe('ExpenseSplit', () => {
  describe('parte do dono', () => {
    it('ja nasce quitada: o dinheiro saiu da propria conta', () => {
      const minhaParte = split({ isOwner: true, participantName: 'Ana' });

      expect(minhaParte.isSettled()).toBe(true);
      expect(minhaParte.settledAt).not.toBeNull();
      expect(minhaParte.outstanding().toCents()).toBe(0);
    });

    it('parte dos outros nasce pendente', () => {
      const parteDoBruno = split();

      expect(parteDoBruno.isSettled()).toBe(false);
      expect(parteDoBruno.outstanding().toCents()).toBe(3333);
    });

    it('nao desfaz o acerto da parte do dono', () => {
      const minhaParte = split({ isOwner: true });
      minhaParte.unsettle();

      expect(minhaParte.isSettled()).toBe(true);
    });
  });

  describe('acerto', () => {
    it('quita apontando o acerto que gerou', () => {
      const parteDoBruno = split();
      const settlementId = new UniqueEntityId();

      parteDoBruno.settle(settlementId);

      expect(parteDoBruno.isSettled()).toBe(true);
      expect(parteDoBruno.settlementId?.toValue()).toBe(settlementId.toValue());
      expect(parteDoBruno.outstanding().toCents()).toBe(0);
    });

    it('desfaz o acerto quando ele e cancelado', () => {
      const parteDoBruno = split();
      parteDoBruno.settle(new UniqueEntityId());
      parteDoBruno.unsettle();

      expect(parteDoBruno.isSettled()).toBe(false);
      expect(parteDoBruno.settlementId).toBeNull();
      expect(parteDoBruno.outstanding().toCents()).toBe(3333);
    });
  });

  describe('participante sem conta na plataforma', () => {
    it('aceita apenas nome e e-mail', () => {
      const carla = split({
        participantUserId: null,
        participantName: 'Carla Souza',
        participantEmail: email('carla@exemplo.com'),
      });

      expect(carla.participantUserId).toBeNull();
      expect(carla.participantKey()).toBe('carla@exemplo.com');
    });

    it('aceita so o nome quando nem e-mail existe', () => {
      const amigo = split({
        participantUserId: null,
        participantEmail: null,
        participantName: 'Amigo do Trabalho',
      });

      expect(amigo.participantKey()).toBe('amigo do trabalho');
    });

    it('vincula ao usuario quando a pessoa aceita o convite', () => {
      const carla = split({ participantUserId: null });
      const userId = new UniqueEntityId();

      carla.linkParticipant(userId);

      expect(carla.participantUserId?.toValue()).toBe(userId.toValue());
      // A partir daqui a identidade passa a ser o usuario.
      expect(carla.participantKey()).toBe(userId.toValue());
    });
  });

  describe('chave de identidade', () => {
    it('prefere o usuario ao e-mail e o e-mail ao nome', () => {
      const userId = new UniqueEntityId();

      expect(split({ participantUserId: userId }).participantKey()).toBe(userId.toValue());
      expect(split({ participantUserId: null }).participantKey()).toBe('bruno@finapp.local');
    });
  });
});
