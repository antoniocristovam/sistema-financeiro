import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type CalendarDate } from '../../../../../shared/domain/value-objects/calendar-date';
import { type Recurrence } from '../entities/recurrence';

/** Dados de exibicao que acompanham a serie na listagem. */
export interface RecurrenceView {
  recurrence: Recurrence;
  accountName: string;
  categoryName: string | null;
}

/** Uma ocorrencia ja materializada, do ponto de vista da serie. */
export interface MaterializedOccurrence {
  occurrenceDate: CalendarDate;
  transactionId: string;
  isSettled: boolean;
}

/**
 * Porta do repositorio de contas fixas.
 *
 * Como todo repositorio do sistema, as consultas sao escopadas por
 * `workspaceId` -- exceto `findActiveForJob`, que existe justamente para o job
 * diario, que roda SEM usuario e sem workspace no contexto. Ela esta separada e
 * nomeada para isso: assim nenhum caso de uso de request consegue chama-la por
 * distracao achando que e' um `findAll` inocente.
 */
export interface RecurrenceRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Recurrence | null>;
  findViewById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<RecurrenceView | null>;
  listByWorkspace(
    workspaceId: UniqueEntityId,
    options: { includeInactive: boolean },
  ): Promise<RecurrenceView[]>;

  create(recurrence: Recurrence): Promise<void>;
  save(recurrence: Recurrence): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;

  /** Datas que o usuario dispensou. */
  skips(recurrenceId: UniqueEntityId): Promise<CalendarDate[]>;
  addSkip(
    recurrenceId: UniqueEntityId,
    occurrenceDate: CalendarDate,
    reason: string | null,
  ): Promise<void>;
  removeSkip(recurrenceId: UniqueEntityId, occurrenceDate: CalendarDate): Promise<void>;

  /** Ocorrencias ja materializadas de uma serie, para montar a linha do tempo. */
  materializedOccurrences(
    workspaceId: UniqueEntityId,
    recurrenceId: UniqueEntityId,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<MaterializedOccurrence[]>;

  /**
   * Valores JA PAGOS da serie, do mais recente para o mais antigo.
   *
   * Base da deteccao de reajuste: e' contra a media deles que o valor novo e'
   * comparado.
   */
  settledAmounts(
    workspaceId: UniqueEntityId,
    recurrenceId: UniqueEntityId,
    limit: number,
  ): Promise<number[]>;

  /**
   * Series ativas de TODOS os workspaces, para o job diario.
   *
   * Paginada por cursor de id porque a base cresce sem teto e carregar tudo em
   * memoria seria uma bomba-relogio silenciosa.
   */
  findActiveForJob(options: { limit: number; afterId?: string }): Promise<Recurrence[]>;
}

export const RECURRENCE_REPOSITORY = Symbol('RecurrenceRepository');
