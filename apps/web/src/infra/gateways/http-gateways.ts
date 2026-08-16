import {
  type AuthenticatedUser,
  type CategoriesStepBody,
  type CreditCardsStepBody,
  type FirstAccountStepBody,
  type IncomeStepBody,
  type LoginBody,
  type OnboardingState,
  type RegisterBody,
  type SavingsTargetStepBody,
  type SeedCatalog,
  type Session,
  type UpdateProfileBody,
  type Workspace,
} from '@finapp/contracts';

import {
  type AuthGateway,
  type OnboardingGateway,
  type WorkspaceGateway,
} from '../../application/gateways';
import { ApiRequestError, type HttpClient } from '../http/http-client';

export class HttpAuthGateway implements AuthGateway {
  constructor(private readonly http: HttpClient) {}

  async register(body: RegisterBody): Promise<Session> {
    const session = await this.http.post<Session>('/auth/register', body, { skipAuth: true });
    this.http.setAccessToken(session.tokens.accessToken);

    return session;
  }

  async signIn(body: LoginBody): Promise<Session> {
    const session = await this.http.post<Session>('/auth/login', body, { skipAuth: true });
    this.http.setAccessToken(session.tokens.accessToken);

    return session;
  }

  /**
   * Retomada da sessao no boot do app.
   *
   * O access token vive so em memoria, entao um F5 sempre perde. O cookie de
   * refresh sobrevive -- e' ele que traz a sessao de volta sem novo login.
   *
   * Devolve `null` em vez de lancar: "nao ha sessao" e' o estado NORMAL de quem
   * abre o app deslogado, nao um erro.
   */
  async restore(): Promise<Session | null> {
    try {
      const session = await this.http.post<Session>('/auth/refresh', undefined, {
        skipAuth: true,
      });

      this.http.setAccessToken(session.tokens.accessToken);

      return session;
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 0)) {
        return null;
      }

      throw error;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.http.post<void>('/auth/logout', undefined, { skipAuth: true });
    } finally {
      // O token local some mesmo se a chamada falhar: o usuario pediu para sair.
      this.http.setAccessToken(null);
    }
  }

  me(): Promise<AuthenticatedUser> {
    return this.http.get<AuthenticatedUser>('/auth/me');
  }

  updateProfile(body: UpdateProfileBody): Promise<AuthenticatedUser> {
    return this.http.patch<AuthenticatedUser>('/auth/me', body);
  }

  verifyEmail(token: string): Promise<void> {
    return this.http.post<void>('/auth/verify-email', { token }, { skipAuth: true });
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.http.post<void>('/auth/forgot-password', { email }, { skipAuth: true });
  }

  resetPassword(input: {
    token: string;
    password: string;
    passwordConfirmation: string;
  }): Promise<void> {
    return this.http.post<void>('/auth/reset-password', input, { skipAuth: true });
  }
}

export class HttpWorkspaceGateway implements WorkspaceGateway {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<Workspace[]> {
    return this.http.get<Workspace[]>('/workspaces');
  }
}

export class HttpOnboardingGateway implements OnboardingGateway {
  constructor(private readonly http: HttpClient) {}

  state(workspaceId: string): Promise<OnboardingState> {
    return this.http.get<OnboardingState>('/onboarding', { workspaceId });
  }

  seedCategories(workspaceId: string): Promise<SeedCatalog> {
    return this.http.get<SeedCatalog>('/onboarding/seed-categories', { workspaceId });
  }

  saveIncome(workspaceId: string, body: IncomeStepBody): Promise<void> {
    return this.http.put<void>('/onboarding/income', body, { workspaceId });
  }

  createAccount(workspaceId: string, body: FirstAccountStepBody): Promise<{ id: string }> {
    return this.http.post<{ id: string }>('/onboarding/accounts', body, { workspaceId });
  }

  saveCreditCards(workspaceId: string, body: CreditCardsStepBody): Promise<{ ids: string[] }> {
    return this.http.post<{ ids: string[] }>('/onboarding/credit-cards', body, { workspaceId });
  }

  saveCategories(workspaceId: string, body: CategoriesStepBody): Promise<void> {
    return this.http.put<void>('/onboarding/categories', body, { workspaceId });
  }

  saveSavingsTarget(workspaceId: string, body: SavingsTargetStepBody): Promise<void> {
    return this.http.put<void>('/onboarding/savings-target', body, { workspaceId });
  }

  complete(workspaceId: string): Promise<{ completedAt: string }> {
    return this.http.post<{ completedAt: string }>('/onboarding/complete', undefined, {
      workspaceId,
    });
  }
}
