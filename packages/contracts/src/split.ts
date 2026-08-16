import { z } from 'zod';

import { ShareType } from './enums.js';
import { zAmountInCents, zBasisPoints, zDisplayName, zEmail, zUuid } from './primitives.js';

/**
 * Contrato da divisao de despesa.
 *
 * Aqui mora a regra 7, a que mais da trabalho quando quebra: **a soma dos
 * splits tem que fechar exatamente com o valor da transacao**. Se nao fechar,
 * o relatorio erra por centavos e ninguem acha o bug -- por isso a checagem e'
 * do contrato, valendo igual para a API e para o formulario no front.
 *
 * Divisao de despesa NAO e' conta compartilhada. Aqui o lancamento continua
 * sendo de quem pagou; so o CUSTO e' repartido.
 */

export const splitParticipantInputSchema = z.object({
  /** Preenchido quando a pessoa ja tem conta na plataforma. */
  participantUserId: zUuid.optional(),
  name: zDisplayName,
  email: zEmail.optional(),
  /**
   * EQUAL: ignorado (o servidor calcula). PERCENT: pontos-base (33,33% = 3333).
   * FIXED: centavos.
   */
  shareValue: z.number().int().optional(),
  /** Marca quem pagou. Exatamente um participante precisa ser o dono. */
  isOwner: z.boolean().default(false),
});

export type SplitParticipantInput = z.input<typeof splitParticipantInputSchema>;

const splitPayloadShape = z.object({
  /** Valor CHEIO da transacao -- o que saiu da conta e afeta o saldo. */
  amountInCents: zAmountInCents,
  shareType: z.nativeEnum(ShareType),
  participants: z
    .array(splitParticipantInputSchema)
    .min(2, 'Uma divisao precisa de pelo menos duas pessoas.')
    .max(50, 'Maximo de 50 participantes por divisao.'),
});

/**
 * Payload completo da divisao, com todas as regras cruzadas aplicadas.
 *
 * Usar `.superRefine` (e nao validacoes soltas por campo) e' o que permite
 * comparar a soma dos participantes com o valor da transacao -- informacao que
 * so existe no objeto inteiro.
 */
export const splitPayloadSchema = splitPayloadShape.superRefine((payload, ctx) => {
  const { amountInCents, shareType, participants } = payload;

  // -- Exatamente um dono ----------------------------------------------------
  const owners = participants.filter((participant) => participant.isOwner === true);

  if (owners.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['participants'],
      message: 'Marque quem pagou a despesa.',
    });
  } else if (owners.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['participants'],
      message: 'So uma pessoa pode ser a dona do lancamento.',
    });
  }

  // -- Participante repetido -------------------------------------------------
  const seen = new Set<string>();
  participants.forEach((participant, index) => {
    const identity =
      participant.participantUserId ?? participant.email ?? participant.name.trim().toLowerCase();

    if (seen.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants', index],
        message: 'Participante repetido na divisao.',
      });
    }

    seen.add(identity);
  });

  // -- Fechamento por modo ---------------------------------------------------
  if (shareType === ShareType.EQUAL) {
    // Nada a somar: o servidor reparte com `Money.allocate`, que distribui os
    // centavos de resto entre os primeiros participantes.
    return;
  }

  const missing = participants.findIndex(
    (participant) => participant.shareValue === undefined || participant.shareValue === null,
  );

  if (missing >= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['participants', missing, 'shareValue'],
      message:
        shareType === ShareType.PERCENT
          ? 'Informe o percentual desta pessoa.'
          : 'Informe o valor desta pessoa.',
    });
    return;
  }

  const values = participants.map((participant) => participant.shareValue ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  if (shareType === ShareType.PERCENT) {
    values.forEach((value, index) => {
      const parsed = zBasisPoints.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants', index, 'shareValue'],
          message: parsed.error.issues[0]?.message ?? 'Percentual invalido.',
        });
      }
    });

    if (total !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: `Os percentuais precisam somar 100%. Somam ${formatBasisPoints(total)}%.`,
      });
    }

    return;
  }

  // FIXED
  values.forEach((value, index) => {
    if (value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants', index, 'shareValue'],
        message: 'O valor precisa ser maior que zero.',
      });
    }
  });

  if (total !== amountInCents) {
    const difference = amountInCents - total;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['participants'],
      message:
        difference > 0
          ? `Faltam ${formatCents(difference)} para fechar o valor da despesa.`
          : `Sobram ${formatCents(-difference)} em relacao ao valor da despesa.`,
    });
  }
});

export type SplitPayload = z.infer<typeof splitPayloadSchema>;

/**
 * Verificacao final, aplicada DEPOIS que o servidor calcula os valores.
 *
 * O schema acima valida a INTENCAO (percentuais somam 100%); esta funcao valida
 * o RESULTADO (os centavos calculados somam o valor cheio). As duas coisas sao
 * diferentes, e e' entre elas que o centavo se perde.
 */
export function splitAmountsClose(amountInCents: number, shares: readonly number[]): boolean {
  return shares.reduce((sum, share) => sum + share, 0) === amountInCents;
}

function formatBasisPoints(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace('.', ',');
}

function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
