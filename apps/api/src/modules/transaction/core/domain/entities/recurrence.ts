import { Money } from '@finapp/money';

import { Entity, type Optional } from '../../../../../shared/domain/entity';
import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type RecurrenceSchedule } from '../value-objects/recurrence-schedule';

/** Divergencia acima disso vira aviso de reajuste. */
export const AMOUNT_DRIFT_THRESHOLD = 0.1;

export interface RecurrenceTemplate {
  accountId: UniqueEntityId;
  categoryId: UniqueEntityId | null;
  type: 'INCOME' | 'EXPENSE';
  amount: Money;
  description: string;
  notes: string | null;
}

export interface RecurrenceProps {
  workspaceId: UniqueEntityId;
  /** Quem cadastrou a serie. Os lancamentos gerados pelo job herdam este autor. */
  createdByUserId: UniqueEntityId;
  name: string;
  template: RecurrenceTemplate;
  schedule: RecurrenceSchedule;
  /** Ate onde o job ja materializou. Evita reprocessar a janela inteira. */
  materializedUntil: CalendarDate | null;
  reminderDaysBefore: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AmountDrift {
  average: Money;
  difference: Money;
  /** Fracao: 0.12 = 12% acima da media. */
  ratio: number;
  isSignificant: boolean;
}

/**
 * Conta fixa: um template de lancamento + uma regra de repeticao.
 *
 * As ocorrencias sao materializadas como transacoes PENDING dentro de uma
 * janela de 60 dias por um job diario. A chave unica
 * `(recurrenceId, occurrenceDate)` no banco e' o que torna a materializacao
 * idempotente -- rodar o job duas vezes nao duplica nada.
 */
export class Recurrence extends Entity<RecurrenceProps> {
  static readonly MATERIALIZATION_WINDOW_DAYS = 60;

  static create(
    props: Optional<
      RecurrenceProps,
      'materializedUntil' | 'reminderDaysBefore' | 'isActive' | 'createdAt' | 'updatedAt'
    >,
    id?: UniqueEntityId,
  ): Recurrence {
    const now = new Date();

    return new Recurrence(
      {
        ...props,
        materializedUntil: props.materializedUntil ?? null,
        reminderDaysBefore: props.reminderDaysBefore ?? null,
        isActive: props.isActive ?? true,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    );
  }

  get workspaceId(): UniqueEntityId {
    return this.props.workspaceId;
  }

  get createdByUserId(): UniqueEntityId {
    return this.props.createdByUserId;
  }

  get name(): string {
    return this.props.name;
  }

  get template(): RecurrenceTemplate {
    return this.props.template;
  }

  get schedule(): RecurrenceSchedule {
    return this.props.schedule;
  }

  get materializedUntil(): CalendarDate | null {
    return this.props.materializedUntil;
  }

  get reminderDaysBefore(): number | null {
    return this.props.reminderDaysBefore;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /**
   * Ocorrencias que ainda faltam materializar, dentro da janela de 60 dias.
   *
   * `skipped` sao as que o usuario dispensou: pular uma ocorrencia nao quebra a
   * serie, e o job nao pode recriar o que ja foi dispensado.
   *
   * Serie NOVA comeca a valer de hoje, nunca do `startDate` retroativo.
   * Cadastrar em marco um aluguel "desde janeiro" nao pode despejar duas contas
   * vencidas no extrato: elas ja foram pagas e provavelmente ja foram lancadas
   * a mao, e como nascem PENDING elas ainda estragariam o saldo projetado.
   *
   * A recuperacao de atraso continua funcionando porque depende de outra coisa:
   * com `materializedUntil` preenchido, a serie retoma exatamente de onde
   * parou -- se o job ficou uma semana fora do ar, as ocorrencias daquela
   * semana entram na proxima execucao.
   */
  pendingOccurrences(
    today: CalendarDate,
    skipped: readonly CalendarDate[] = [],
  ): CalendarDate[] {
    if (!this.props.isActive) {
      return [];
    }

    const horizon = today.addDays(Recurrence.MATERIALIZATION_WINDOW_DAYS);
    const startDate = this.props.schedule.startDate;
    const from =
      this.props.materializedUntil?.addDays(1) ??
      (startDate.isAfter(today) ? startDate : today);
    const skippedKeys = new Set(skipped.map((date) => date.toString()));

    return this.props.schedule
      .occurrencesBetween(from, horizon)
      .filter((occurrence) => !skippedKeys.has(occurrence.toString()));
  }

  /** Ocorrencias que precisam de lembrete hoje. */
  shouldRemindOn(today: CalendarDate, occurrence: CalendarDate): boolean {
    if (this.props.reminderDaysBefore === null || !this.props.isActive) {
      return false;
    }

    return today.daysUntil(occurrence) === this.props.reminderDaysBefore;
  }

  /**
   * Deteccao de reajuste.
   *
   * Compara o valor com a media dos pagamentos anteriores. Divergencia acima de
   * 10% vira aviso -- e' o aluguel que subiu, a assinatura que reajustou, a
   * conta de luz que disparou.
   *
   * Sem historico nao ha media, e sem media nao ha o que comparar: devolve
   * `null` em vez de fingir que 100% de aumento aconteceu.
   */
  detectDrift(paidAmounts: readonly Money[], newAmount: Money): AmountDrift | null {
    if (paidAmounts.length === 0) {
      return null;
    }

    const currency = newAmount.currency;
    const total = Money.sum(paidAmounts, currency);
    const average = Money.fromCents(
      Math.round(total.toCents() / paidAmounts.length),
      currency,
    );

    if (average.isZero()) {
      return null;
    }

    const difference = newAmount.minus(average);
    const ratio = difference.toCents() / average.toCents();

    return {
      average,
      difference,
      ratio,
      isSignificant: Math.abs(ratio) > AMOUNT_DRIFT_THRESHOLD,
    };
  }

  markMaterializedUntil(date: CalendarDate): void {
    this.props.materializedUntil = date;
    this.touch();
  }

  rename(name: string): void {
    this.props.name = name;
    this.touch();
  }

  /** `null` desliga o lembrete. */
  changeReminder(daysBefore: number | null): void {
    this.props.reminderDaysBefore = daysBefore;
    this.touch();
  }

  updateTemplate(template: Partial<RecurrenceTemplate>): void {
    this.props.template = { ...this.props.template, ...template };
    this.touch();
  }

  changeSchedule(schedule: RecurrenceSchedule): void {
    this.props.schedule = schedule;
    // A janela precisa ser recalculada do zero com a regra nova.
    this.props.materializedUntil = null;
    this.touch();
  }

  deactivate(): void {
    this.props.isActive = false;
    this.touch();
  }

  activate(): void {
    this.props.isActive = true;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
