import { type UniqueEntityId } from '../../../../../shared/domain/unique-entity-id';
import { type MonthReference } from '../../../../../shared/domain/value-objects/month-reference';
import { type Budget } from '../entities/budget';

export interface BudgetView {
  budget: Budget;
  category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    parentName: string | null;
  };
  /** Ja com a regra 6 aplicada: e' a MINHA parte, nao o valor cheio. */
  consumedInCents: number;
}

/**
 * Porta do repositorio de orcamentos.
 *
 * O consumo NAO e' um campo guardado: ele e' consultado a cada leitura. Um
 * total materializado precisaria ser corrigido a cada edicao, exclusao,
 * recategorizacao e divisao de despesa -- e o primeiro caminho esquecido
 * deixaria o orcamento mentindo sem nada que o corrigisse.
 */
export interface BudgetRepository {
  findById(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<Budget | null>;
  findByCategoryAndMonth(
    workspaceId: UniqueEntityId,
    categoryId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<Budget | null>;

  /** Orcamentos do mes, ja com categoria e consumo resolvidos. */
  listByMonth(workspaceId: UniqueEntityId, referenceMonth: MonthReference): Promise<BudgetView[]>;

  create(budget: Budget): Promise<void>;
  createMany(budgets: Budget[]): Promise<void>;
  save(budget: Budget): Promise<void>;
  delete(workspaceId: UniqueEntityId, id: UniqueEntityId): Promise<void>;

  /**
   * Consumo de UMA categoria (incluindo filhas) num mes.
   *
   * Usado para o mes anterior no calculo do rollover, onde nao ha necessidade
   * de carregar a lista inteira.
   */
  consumedFor(
    workspaceId: UniqueEntityId,
    categoryId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<number>;

  /**
   * Despesa do mes que NAO cai em nenhuma categoria orcada.
   *
   * Sem este numero, tres orcamentos em dia dariam a impressao de que o mes
   * esta sob controle enquanto o gasto escorre por todas as outras categorias.
   */
  unbudgetedInMonth(
    workspaceId: UniqueEntityId,
    referenceMonth: MonthReference,
  ): Promise<number>;

  /** Limiares ja avisados deste orcamento. */
  notifiedThresholds(budgetId: UniqueEntityId): Promise<number[]>;

  /**
   * Registra o aviso de um limiar.
   *
   * Devolve `false` quando ja existia -- e' o indice `(budgetId, threshold)`
   * que garante "uma vez por limiar, por mes", e nao uma checagem em memoria
   * que duas execucoes simultaneas atravessariam juntas.
   */
  markThresholdNotified(budgetId: UniqueEntityId, threshold: number): Promise<boolean>;

  /** Orcamentos do mes de TODOS os workspaces, para o job de alerta. */
  findForAlertJob(referenceMonth: MonthReference, limit: number): Promise<Budget[]>;
}

export const BUDGET_REPOSITORY = Symbol('BudgetRepository');
