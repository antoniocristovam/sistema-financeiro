import { describe, expect, it } from 'vitest';

import { UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { Email } from '../../../../../shared/domain/value-objects/email';
import {
  InvitationEmailMismatchError,
  InvitationExpiredError,
  InvitationNotPendingError,
} from '../errors/workspace-errors';
import { Invitation } from './invitation';

const email = (value: string): Email => {
  const result = Email.create(value);
  if (result.isLeft()) throw new Error(`E-mail invalido: ${value}`);
  return result.value;
};

const NOW = new Date('2026-03-15T12:00:00Z');

const invitation = (overrides = {}): Invitation =>
  Invitation.create({
    workspaceId: new UniqueEntityId(),
    email: email('bruno@finapp.local'),
    role: 'MEMBER',
    tokenHash: 'hash-do-token',
    invitedByUserId: new UniqueEntityId(),
    createdAt: NOW,
    ...overrides,
  });

describe('Invitation', () => {
  describe('criacao', () => {
    it('nasce pendente com validade de 7 dias', () => {
      const convite = invitation();

      expect(convite.isPending()).toBe(true);
      expect(convite.acceptedAt).toBeNull();
      expect(convite.expiresAt.toISOString()).toBe('2026-03-22T12:00:00.000Z');
    });

    it('guarda so o hash do token', () => {
      // O token em claro existe uma vez, no e-mail. Persistir o hash faz um
      // vazamento do banco nao virar acesso.
      expect(invitation().tokenHash).toBe('hash-do-token');
    });
  });

  describe('aceite', () => {
    it('aceita quando pendente, no prazo e pelo destinatario', () => {
      const convite = invitation();
      const result = convite.accept(email('bruno@finapp.local'), NOW);

      expect(result.isRight()).toBe(true);
      expect(convite.status).toBe('ACCEPTED');
      expect(convite.acceptedAt).toEqual(NOW);
    });

    it('normaliza o e-mail na comparacao', () => {
      const convite = invitation();

      expect(convite.accept(email('  BRUNO@Finapp.Local '), NOW).isRight()).toBe(true);
    });

    it('recusa aceite por outro e-mail', () => {
      // Um token vazado nao pode virar acesso para qualquer conta.
      const convite = invitation();
      const result = convite.accept(email('invasor@exemplo.com'), NOW);

      expect(result.isLeft() && result.value).toBeInstanceOf(InvitationEmailMismatchError);
      expect(convite.isPending()).toBe(true);
    });

    it('recusa convite vencido e marca como EXPIRED', () => {
      // A checagem e' no ACEITE, nao por job: depender de job criaria uma
      // janela em que o convite vencido ainda funciona.
      const convite = invitation();
      const depois = new Date('2026-03-23T12:00:00Z');

      const result = convite.accept(email('bruno@finapp.local'), depois);

      expect(result.isLeft() && result.value).toBeInstanceOf(InvitationExpiredError);
      expect(convite.status).toBe('EXPIRED');
    });

    it('expira exatamente no limite', () => {
      const convite = invitation();
      const noLimite = new Date('2026-03-22T12:00:00Z');

      expect(convite.isExpired(noLimite)).toBe(true);
      expect(convite.isExpired(new Date('2026-03-22T11:59:59Z'))).toBe(false);
    });

    it('recusa aceitar duas vezes', () => {
      const convite = invitation();
      convite.accept(email('bruno@finapp.local'), NOW);

      const segundo = convite.accept(email('bruno@finapp.local'), NOW);

      expect(segundo.isLeft() && segundo.value).toBeInstanceOf(InvitationNotPendingError);
    });

    it('recusa aceitar convite revogado', () => {
      const convite = invitation();
      convite.revoke();

      const result = convite.accept(email('bruno@finapp.local'), NOW);

      expect(result.isLeft() && result.value).toBeInstanceOf(InvitationNotPendingError);
    });
  });

  describe('revogacao', () => {
    it('revoga convite pendente', () => {
      const convite = invitation();

      expect(convite.revoke().isRight()).toBe(true);
      expect(convite.status).toBe('REVOKED');
    });

    it('recusa revogar convite ja aceito', () => {
      const convite = invitation();
      convite.accept(email('bruno@finapp.local'), NOW);

      expect(convite.revoke().isLeft()).toBe(true);
    });
  });
});
