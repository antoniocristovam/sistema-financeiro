import {
  type AccountList,
  type CategoryTree,
  type CreateAccountBody,
  type CreateCategoryBody,
  type CreateTransactionBody,
  type CreateTransferBody,
  type ListTransactionsQuery,
  type ReorderCategoriesBody,
  type Transaction,
  type TransactionList,
  type UpdateAccountBody,
  type UpdateCategoryBody,
  type UpdateTransactionBody,
} from '@finapp/contracts';

import {
  type AccountGateway,
  type CategoryGateway,
  type TransactionGateway,
} from '../../application/gateways';
import { type HttpClient } from '../http/http-client';

/** Monta a query string ignorando o que estiver vazio. */
function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();

  return query ? `?${query}` : '';
}

export class HttpAccountGateway implements AccountGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, includeArchived = false): Promise<AccountList> {
    return this.http.get<AccountList>(`/accounts${toQuery({ includeArchived })}`, {
      workspaceId,
    });
  }

  create(workspaceId: string, body: CreateAccountBody): Promise<{ id: string }> {
    return this.http.post<{ id: string }>('/accounts', body, { workspaceId });
  }

  update(workspaceId: string, id: string, body: UpdateAccountBody): Promise<{ id: string }> {
    return this.http.patch<{ id: string }>(`/accounts/${id}`, body, { workspaceId });
  }

  archive(workspaceId: string, id: string, archived: boolean): Promise<void> {
    return this.http.post<void>(
      `/accounts/${id}/${archived ? 'archive' : 'unarchive'}`,
      undefined,
      { workspaceId },
    );
  }

  remove(workspaceId: string, id: string): Promise<void> {
    return this.http.delete<void>(`/accounts/${id}`, { workspaceId });
  }
}

export class HttpCategoryGateway implements CategoryGateway {
  constructor(private readonly http: HttpClient) {}

  tree(workspaceId: string, includeArchived = false): Promise<CategoryTree> {
    return this.http.get<CategoryTree>(`/categories${toQuery({ includeArchived })}`, {
      workspaceId,
    });
  }

  create(workspaceId: string, body: CreateCategoryBody): Promise<{ id: string }> {
    return this.http.post<{ id: string }>('/categories', body, { workspaceId });
  }

  update(workspaceId: string, id: string, body: UpdateCategoryBody): Promise<{ id: string }> {
    return this.http.patch<{ id: string }>(`/categories/${id}`, body, { workspaceId });
  }

  reorder(workspaceId: string, body: ReorderCategoriesBody): Promise<void> {
    return this.http.put<void>('/categories/order', body, { workspaceId });
  }

  archive(workspaceId: string, id: string, archived: boolean): Promise<void> {
    return this.http.post<void>(
      `/categories/${id}/${archived ? 'archive' : 'unarchive'}`,
      undefined,
      { workspaceId },
    );
  }

  remove(workspaceId: string, id: string, reassignToId?: string): Promise<{ reassigned: number }> {
    return this.http.delete<{ reassigned: number }>(
      `/categories/${id}${toQuery({ reassignToId })}`,
      { workspaceId },
    );
  }
}

export class HttpTransactionGateway implements TransactionGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string, query: Partial<ListTransactionsQuery>): Promise<TransactionList> {
    return this.http.get<TransactionList>(`/transactions${toQuery(query)}`, { workspaceId });
  }

  create(workspaceId: string, body: CreateTransactionBody): Promise<Transaction> {
    return this.http.post<Transaction>('/transactions', body, { workspaceId });
  }

  transfer(
    workspaceId: string,
    body: CreateTransferBody,
  ): Promise<{ sourceId: string; destinationId: string }> {
    return this.http.post<{ sourceId: string; destinationId: string }>(
      '/transactions/transfers',
      body,
      { workspaceId },
    );
  }

  update(workspaceId: string, id: string, body: UpdateTransactionBody): Promise<Transaction> {
    return this.http.patch<Transaction>(`/transactions/${id}`, body, { workspaceId });
  }

  remove(workspaceId: string, id: string): Promise<void> {
    return this.http.delete<void>(`/transactions/${id}`, { workspaceId });
  }
}
