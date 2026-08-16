import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  type AccountGateway,
  type AttachmentGateway,
  type AuthGateway,
  type CardGateway,
  type CategoryGateway,
  type NotificationGateway,
  type OnboardingGateway,
  type RecurrenceGateway,
  type TransactionGateway,
  type WorkspaceGateway,
} from '../../application/gateways';
import {
  HttpAuthGateway,
  HttpOnboardingGateway,
  HttpWorkspaceGateway,
} from '../../infra/gateways/http-gateways';
import {
  HttpAccountGateway,
  HttpCategoryGateway,
  HttpTransactionGateway,
} from '../../infra/gateways/ledger-gateways';
import { HttpAttachmentGateway } from '../../infra/gateways/attachment-gateway';
import { HttpCardGateway } from '../../infra/gateways/card-gateway';
import {
  HttpNotificationGateway,
  HttpRecurrenceGateway,
} from '../../infra/gateways/recurrence-gateways';
import { HttpClient } from '../../infra/http/http-client';

export interface Dependencies {
  http: HttpClient;
  auth: AuthGateway;
  workspaces: WorkspaceGateway;
  onboarding: OnboardingGateway;
  accounts: AccountGateway;
  categories: CategoryGateway;
  transactions: TransactionGateway;
  attachments: AttachmentGateway;
  recurrences: RecurrenceGateway;
  notifications: NotificationGateway;
  cards: CardGateway;
}

const DependenciesContext = createContext<Dependencies | null>(null);

/**
 * Composition root do front.
 *
 * As implementacoes HTTP sao amarradas as portas em UM lugar. Um teste que
 * queira dublar um gateway envolve a arvore com este provider e passa outra
 * implementacao -- sem mock de modulo, sem interceptar `fetch`.
 */
export function DependenciesProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: Dependencies;
}) {
  const dependencies = useMemo<Dependencies>(() => {
    if (value) {
      return value;
    }

    const http = new HttpClient(`${import.meta.env.VITE_API_URL ?? ''}/api`);

    return {
      http,
      auth: new HttpAuthGateway(http),
      workspaces: new HttpWorkspaceGateway(http),
      onboarding: new HttpOnboardingGateway(http),
      accounts: new HttpAccountGateway(http),
      categories: new HttpCategoryGateway(http),
      transactions: new HttpTransactionGateway(http),
      attachments: new HttpAttachmentGateway(http),
      recurrences: new HttpRecurrenceGateway(http),
      notifications: new HttpNotificationGateway(http),
      cards: new HttpCardGateway(http),
    };
  }, [value]);

  return (
    <DependenciesContext.Provider value={dependencies}>{children}</DependenciesContext.Provider>
  );
}

export function useDependencies(): Dependencies {
  const context = useContext(DependenciesContext);

  if (!context) {
    throw new Error('useDependencies precisa estar dentro de <DependenciesProvider>.');
  }

  return context;
}
