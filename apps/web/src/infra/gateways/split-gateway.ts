import {
  type CreateSettlementBody,
  type SettlementList,
  type SplitBalanceList,
  type SplitPayload,
  type TransactionSplits,
} from '@finapp/contracts';

import { type SplitGateway } from '../../application/gateways';
import { type HttpClient } from '../http/http-client';

export class HttpSplitGateway implements SplitGateway {
  constructor(private readonly http: HttpClient) {}

  get(workspaceId: string, transactionId: string): Promise<TransactionSplits> {
    return this.http.get<TransactionSplits>(`/transactions/${transactionId}/splits`, {
      workspaceId,
    });
  }

  split(
    workspaceId: string,
    transactionId: string,
    body: SplitPayload,
  ): Promise<TransactionSplits> {
    return this.http.post<TransactionSplits>(
      `/transactions/${transactionId}/splits`,
      body,
      { workspaceId },
    );
  }

  remove(workspaceId: string, transactionId: string): Promise<void> {
    return this.http.delete<void>(`/transactions/${transactionId}/splits`, { workspaceId });
  }

  balances(workspaceId: string): Promise<SplitBalanceList> {
    return this.http.get<SplitBalanceList>('/splits/balances', { workspaceId });
  }

  settlements(workspaceId: string): Promise<SettlementList> {
    return this.http.get<SettlementList>('/splits/settlements', { workspaceId });
  }

  settle(
    workspaceId: string,
    body: CreateSettlementBody,
  ): Promise<{ settlementId: string; settledSplits: number }> {
    return this.http.post<{ settlementId: string; settledSplits: number }>(
      '/splits/settlements',
      body,
      { workspaceId },
    );
  }
}
