import {
  type CreateInstallmentPurchaseBody,
  type CreditCardList,
  type InstallmentPurchaseResult,
  type Invoice,
  type InvoiceWithItems,
  type PayInvoiceBody,
} from '@finapp/contracts';

import { type CardGateway } from '../../application/gateways';
import { type HttpClient } from '../http/http-client';

export class HttpCardGateway implements CardGateway {
  constructor(private readonly http: HttpClient) {}

  list(workspaceId: string): Promise<CreditCardList> {
    return this.http.get<CreditCardList>('/cards', { workspaceId });
  }

  invoices(workspaceId: string, cardId: string, months = 6): Promise<Invoice[]> {
    return this.http.get<Invoice[]>(`/cards/${cardId}/invoices?months=${months}`, {
      workspaceId,
    });
  }

  invoice(workspaceId: string, invoiceId: string): Promise<InvoiceWithItems> {
    return this.http.get<InvoiceWithItems>(`/cards/invoices/${invoiceId}`, { workspaceId });
  }

  pay(
    workspaceId: string,
    invoiceId: string,
    body: PayInvoiceBody,
  ): Promise<{ transactionId: string }> {
    return this.http.post<{ transactionId: string }>(
      `/cards/invoices/${invoiceId}/payment`,
      body,
      { workspaceId },
    );
  }

  installments(
    workspaceId: string,
    body: CreateInstallmentPurchaseBody,
  ): Promise<InstallmentPurchaseResult> {
    return this.http.post<InstallmentPurchaseResult>('/cards/installments', body, {
      workspaceId,
    });
  }
}
