import { participantKeyOf, type ShareType, SplitStatus } from '@finapp/contracts';
import { Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type Email } from '../../../../../shared/domain/value-objects/email';

export interface ExpenseSplitProps {
  workspaceId: UniqueEntityId;
  transactionId: UniqueEntityId;
  /** Nulo quando a pessoa ainda nao tem conta na plataforma. */
  participantUserId: UniqueEntityId | null;
  participantName: string;
  participantEmail: Email | null;
  shareType: ShareType;
  shareValue: number | null;
  amount: Money;
  /** Marca a linha de quem pagou -- e' esta que entra em relatorio e orcamento. */
  isOwner: boolean;
  status: SplitStatus;
  settledAt: Date | null;
  settlementId: UniqueEntityId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parte de uma pessoa em uma despesa dividida.
 *
 * Regra 6, a que mais causa dupla contagem: a transacao tem DOIS valores
 * diferentes.
 *
 *   - `Transaction.amount` e' o valor CHEIO -- foi o que saiu da conta e e' o
 *     que afeta o SALDO.
 *   - a soma dos splits com `isOwner` e' a MINHA PARTE -- e' o que afeta
 *     relatorio, orcamento e gasto por categoria.
 *
 * Somar o valor cheio no relatorio E mostrar que alguem me deve faz o mesmo
 * dinheiro aparecer duas vezes.
 */
export class ExpenseSplit extends Entity<ExpenseSplitProps> {
  static create(
    props: Optional<
      ExpenseSplitProps,
      | 'participantUserId'
      | 'participantEmail'
      | 'shareValue'
      | 'isOwner'
      | 'status'
      | 'settledAt'
      | 'settlementId'
      | 'createdAt'
      | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): ExpenseSplit {
    const now = new Date();
    const isOwner = props.isOwner ?? false;

    return new ExpenseSplit(
      {
        ...props,
        participantUserId: props.participantUserId ?? null,
        participantEmail: props.participantEmail ?? null,
        shareValue: props.shareValue ?? null,
        isOwner,
        // A parte de quem pagou ja esta quitada por definicao: o dinheiro dela
        // saiu da propria conta.
        status: props.status ?? (isOwner ? SplitStatus.SETTLED : SplitStatus.PENDING),
        settledAt: props.settledAt ?? (isOwner ? now : null),
        settlementId: props.settlementId ?? null,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get transactionId(): UniqueEntityId {
    return this.props.transactionId;
  }

  get participantUserId(): UniqueEntityId | null {
    return this.props.participantUserId;
  }

  get participantName(): string {
    return this.props.participantName;
  }

  get participantEmail(): Email | null {
    return this.props.participantEmail;
  }

  get shareType(): ShareType {
    return this.props.shareType;
  }

  get shareValue(): number | null {
    return this.props.shareValue;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get isOwner(): boolean {
    return this.props.isOwner;
  }

  get status(): SplitStatus {
    return this.props.status;
  }

  get settledAt(): Date | null {
    return this.props.settledAt;
  }

  get settlementId(): UniqueEntityId | null {
    return this.props.settlementId;
  }

  isSettled(): boolean {
    return this.props.status === SplitStatus.SETTLED;
  }

  /** Quanto esta pessoa ainda deve. Zero quando ja acertou. */
  outstanding(): Money {
    return this.isSettled() ? Money.zero(this.props.amount.currency) : this.props.amount;
  }

  /** Identidade estavel para deduplicar participante. */
  /**
   * Chave estavel do participante, com PREFIXO da origem.
   *
   * O prefixo nao e' enfeite: sem ele, um usuario cujo id fosse igual ao nome
   * normalizado de outra pessoa colidiria, e -- pior -- a chave gerada aqui
   * precisa bater exatamente com a que o contrato monta para o cliente. Duas
   * convencoes diferentes produziriam saldos que nunca se encontram: a tela
   * mandaria `name:bruno` e o servidor procuraria por `bruno`.
   */
  participantKey(): string {
    return participantKeyOf({
      participantUserId: this.props.participantUserId?.toValue() ?? null,
      email: this.props.participantEmail?.value ?? null,
      name: this.props.participantName,
    });
  }

  settle(settlementId: UniqueEntityId | null, now: Date = new Date()): void {
    this.props.status = SplitStatus.SETTLED;
    this.props.settledAt = now;
    this.props.settlementId = settlementId;
    this.touch();
  }

  /** Desfaz o acerto (acerto cancelado ou lancado por engano). */
  unsettle(): void {
    if (this.props.isOwner) {
      return;
    }

    this.props.status = SplitStatus.PENDING;
    this.props.settledAt = null;
    this.props.settlementId = null;
    this.touch();
  }

  /** Vincula o participante a um usuario que acabou de aceitar o convite. */
  linkParticipant(userId: UniqueEntityId): void {
    this.props.participantUserId = userId;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
