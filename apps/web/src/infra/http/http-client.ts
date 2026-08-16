import { type ApiError } from '@finapp/contracts';

/** Erro de API tipado, com o codigo estavel do contrato. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: ApiError['issues'],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Erros de campo, no formato que o React Hook Form entende. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const issue of this.issues ?? []) {
      const path = issue.path.join('.');

      if (path && !(path in result)) {
        result[path] = issue.message;
      }
    }

    return result;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Workspace ativo, enviado no header `x-workspace-id`. */
  workspaceId?: string | null;
  signal?: AbortSignal;
  /** Rotas publicas nao tentam renovar a sessao ao tomar 401. */
  skipAuth?: boolean;
}

/**
 * Cliente HTTP com renovacao automatica de sessao.
 *
 * O access token vive apenas em MEMORIA (nunca em localStorage): guardado no
 * storage, qualquer XSS o le. O refresh mora em cookie `httpOnly`, que o
 * JavaScript nao alcanca -- por isso todas as chamadas vao com
 * `credentials: 'include'`.
 *
 * Ao tomar 401, o cliente tenta UMA renovacao e refaz a requisicao. As
 * requisicoes concorrentes que tomarem 401 no mesmo instante compartilham a
 * MESMA promessa de refresh: sem isso, dez chamadas paralelas disparariam dez
 * rotacoes, e a deteccao de replay do servidor derrubaria a sessao inteira --
 * o usuario seria deslogado justamente por usar o app.
 */
export class HttpClient {
  #accessToken: string | null = null;
  #refreshing: Promise<boolean> | null = null;
  #onSessionLost: (() => void) | null = null;

  constructor(private readonly baseUrl: string) {}

  setAccessToken(token: string | null): void {
    this.#accessToken = token;
  }

  getAccessToken(): string | null {
    return this.#accessToken;
  }

  /** Chamado quando a renovacao falha: o app volta para o login. */
  onSessionLost(handler: () => void): void {
    this.#onSessionLost = handler;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);

    if (response.status === 401 && options.skipAuth !== true) {
      const renewed = await this.refreshOnce();

      if (renewed) {
        return this.parse<T>(await this.send(path, options));
      }

      this.#accessToken = null;
      this.#onSessionLost?.();
    }

    return this.parse<T>(response);
  }

  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.#accessToken && options.skipAuth !== true) {
      headers.Authorization = `Bearer ${this.#accessToken}`;
    }

    if (options.workspaceId) {
      headers['x-workspace-id'] = options.workspaceId;
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        // Manda e recebe o cookie httpOnly do refresh token.
        credentials: 'include',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch {
      // Falha de rede (offline, DNS, servidor fora). Vira um erro tipado com
      // codigo proprio para a UI conseguir distinguir de um 4xx.
      throw new ApiRequestError(0, 'NETWORK', 'NETWORK', undefined);
    }
  }

  /**
   * Renovacao com deduplicacao.
   *
   * A promessa fica guardada enquanto corre: quem chegar durante a renovacao
   * espera a mesma, em vez de disparar outra.
   */
  private async refreshOnce(): Promise<boolean> {
    this.#refreshing ??= this.doRefresh().finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        return false;
      }

      const session = (await response.json()) as { tokens?: { accessToken?: string } };

      if (!session.tokens?.accessToken) {
        return false;
      }

      this.#accessToken = session.tokens.accessToken;

      return true;
    } catch {
      return false;
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const error = payload as ApiError | undefined;

      throw new ApiRequestError(
        response.status,
        error?.code ?? 'INTERNAL_ERROR',
        error?.message ?? 'Erro inesperado.',
        error?.issues,
      );
    }

    return payload as T;
  }
}
