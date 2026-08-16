import { describe, expect, it } from 'vitest';

import { splitAmountsClose, splitPayloadSchema, type SplitParticipantInput } from './split.js';

const ana: SplitParticipantInput = { name: 'Ana', email: 'ana@finapp.local', isOwner: true };
const bruno: SplitParticipantInput = { name: 'Bruno', email: 'bruno@finapp.local' };
const carla: SplitParticipantInput = { name: 'Carla', email: 'carla@exemplo.com' };

/** Devolve as mensagens de erro, para o teste falar de comportamento. */
const messagesOf = (result: ReturnType<typeof splitPayloadSchema.safeParse>): string[] =>
  result.success ? [] : result.error.issues.map((issue) => issue.message);

describe('splitPayloadSchema', () => {
  describe('EQUAL', () => {
    it('aceita divisao igualitaria sem valores informados', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [ana, bruno, carla],
      });

      expect(result.success).toBe(true);
    });

    it('ignora shareValue: quem reparte e o servidor', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [
          { ...ana, shareValue: 999 },
          { ...bruno, shareValue: 1 },
        ],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('PERCENT', () => {
    it('aceita percentuais que somam 100%', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { ...ana, shareValue: 5000 },
          { ...bruno, shareValue: 3000 },
          { ...carla, shareValue: 2000 },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('aceita 33,33 / 33,33 / 33,34 -- o que so fecha em pontos-base', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { ...ana, shareValue: 3333 },
          { ...bruno, shareValue: 3333 },
          { ...carla, shareValue: 3334 },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('recusa soma diferente de 100% e diz quanto deu', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { ...ana, shareValue: 3333 },
          { ...bruno, shareValue: 3333 },
          { ...carla, shareValue: 3333 },
        ],
      });

      expect(result.success).toBe(false);
      expect(messagesOf(result)[0]).toBe('Os percentuais precisam somar 100%. Somam 99,99%.');
    });

    it('exige percentual de todos os participantes', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [{ ...ana, shareValue: 5000 }, bruno],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['participants', 1, 'shareValue']);
    });

    it('recusa percentual acima de 100% em um unico participante', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'PERCENT',
        participants: [
          { ...ana, shareValue: 12_000 },
          { ...bruno, shareValue: -2000 },
        ],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('FIXED', () => {
    it('aceita valores que somam exatamente a despesa', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [
          { ...ana, shareValue: 3334 },
          { ...bruno, shareValue: 3333 },
          { ...carla, shareValue: 3333 },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('recusa quando falta centavo e diz quanto', () => {
      // O caso classico: tres vezes 33,33 nao da 100,00.
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [
          { ...ana, shareValue: 3333 },
          { ...bruno, shareValue: 3333 },
          { ...carla, shareValue: 3333 },
        ],
      });

      expect(result.success).toBe(false);
      expect(messagesOf(result)[0]).toBe('Faltam R$ 0,01 para fechar o valor da despesa.');
    });

    it('recusa quando sobra', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [
          { ...ana, shareValue: 6000 },
          { ...bruno, shareValue: 5000 },
        ],
      });

      expect(result.success).toBe(false);
      expect(messagesOf(result)[0]).toBe('Sobram R$ 10,00 em relacao ao valor da despesa.');
    });

    it('exige valor de todos os participantes', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [{ ...ana, shareValue: 5000 }, bruno],
      });

      expect(result.success).toBe(false);
      expect(messagesOf(result)[0]).toBe('Informe o valor desta pessoa.');
    });

    it('recusa parte zerada ou negativa', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'FIXED',
        participants: [
          { ...ana, shareValue: 10_000 },
          { ...bruno, shareValue: 0 },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['participants', 1, 'shareValue']);
    });
  });

  describe('regras comuns', () => {
    it('exige pelo menos duas pessoas', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [ana],
      });

      expect(result.success).toBe(false);
      expect(messagesOf(result)).toContain('Uma divisao precisa de pelo menos duas pessoas.');
    });

    it('exige exatamente um dono', () => {
      const semDono = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [bruno, carla],
      });

      const doisDonos = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [ana, { ...bruno, isOwner: true }],
      });

      expect(messagesOf(semDono)).toContain('Marque quem pagou a despesa.');
      expect(messagesOf(doisDonos)).toContain('So uma pessoa pode ser a dona do lancamento.');
    });

    it('recusa participante repetido', () => {
      const porEmail = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [ana, { ...bruno, email: 'ana@finapp.local' }],
      });

      const porNome = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [{ name: 'Carla', isOwner: true }, { name: 'carla' }],
      });

      expect(messagesOf(porEmail)).toContain('Participante repetido na divisao.');
      expect(messagesOf(porNome)).toContain('Participante repetido na divisao.');
    });

    it('aceita participante sem conta na plataforma', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 10_000,
        shareType: 'EQUAL',
        participants: [ana, { name: 'Amigo do trabalho' }],
      });

      expect(result.success).toBe(true);
    });

    it('recusa valor de despesa invalido', () => {
      const result = splitPayloadSchema.safeParse({
        amountInCents: 0,
        shareType: 'EQUAL',
        participants: [ana, bruno],
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('splitAmountsClose', () => {
  it('confirma o fechamento do resultado calculado', () => {
    // O schema valida a INTENCAO; isto valida o RESULTADO em centavos.
    expect(splitAmountsClose(10_000, [3334, 3333, 3333])).toBe(true);
    expect(splitAmountsClose(10_000, [3333, 3333, 3333])).toBe(false);
    expect(splitAmountsClose(10_000, [3334, 3334, 3333])).toBe(false);
  });
});
