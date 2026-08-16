import {
  type Budget,
  type BudgetList,
  type CopyBudgetsBody,
  type CreateBudgetBody,
  type CreateContributionBody,
  type CreateGoalBody,
  type GoalList,
  type GoalWithContributions,
  type UpdateBudgetBody,
  type UpdateGoalBody,
} from '@finapp/contracts';

import { type BudgetGateway, type GoalGateway } from '../../application/gateways';
import { type HttpClient } from '../http/http-client';

export class HttpBudgetGateway implements BudgetGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, month?: string): Promise<BudgetList> {
    return this.http.get<BudgetList>(`/budgets${month ? `?month=${month}` : ''}`, {
      workspaceId,
    });
  }

  create(workspaceId: string, body: CreateBudgetBody): Promise<Budget> {
    return this.http.post<Budget>('/budgets', body, { workspaceId });
  }

  update(workspaceId: string, id: string, body: UpdateBudgetBody): Promise<void> {
    return this.http.patch<void>(`/budgets/${id}`, body, { workspaceId });
  }

  remove(workspaceId: string, id: string): Promise<void> {
    return this.http.delete<void>(`/budgets/${id}`, { workspaceId });
  }

  copy(workspaceId: string, body: CopyBudgetsBody): Promise<{ copied: number }> {
    return this.http.post<{ copied: number }>('/budgets/copy', body, { workspaceId });
  }
}

export class HttpGoalGateway implements GoalGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, includeArchived = false): Promise<GoalList> {
    return this.http.get<GoalList>(`/goals?includeArchived=${String(includeArchived)}`, {
      workspaceId,
    });
  }

  get(workspaceId: string, id: string): Promise<GoalWithContributions> {
    return this.http.get<GoalWithContributions>(`/goals/${id}`, { workspaceId });
  }

  create(workspaceId: string, body: CreateGoalBody): Promise<{ id: string }> {
    return this.http.post<{ id: string }>('/goals', body, { workspaceId });
  }

  update(workspaceId: string, id: string, body: UpdateGoalBody): Promise<void> {
    return this.http.patch<void>(`/goals/${id}`, body, { workspaceId });
  }

  remove(workspaceId: string, id: string): Promise<void> {
    return this.http.delete<void>(`/goals/${id}`, { workspaceId });
  }

  contribute(
    workspaceId: string,
    id: string,
    body: CreateContributionBody,
  ): Promise<{ achieved: boolean }> {
    return this.http.post<{ achieved: boolean }>(`/goals/${id}/contributions`, body, {
      workspaceId,
    });
  }

  removeContribution(workspaceId: string, id: string, contributionId: string): Promise<void> {
    return this.http.delete<void>(`/goals/${id}/contributions/${contributionId}`, {
      workspaceId,
    });
  }
}
