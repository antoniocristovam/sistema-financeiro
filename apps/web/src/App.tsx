import { Locale } from '@finapp/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ApiRequestError } from './infra/http/http-client';
import { DependenciesProvider } from './presentation/providers/dependencies';
import { LocaleProvider } from './presentation/providers/locale-provider';
import { SessionProvider, useSession } from './presentation/providers/session-provider';
import { ThemeProvider } from './presentation/providers/theme-provider';
import { WorkspaceProvider } from './presentation/providers/workspace-provider';
import { router } from './presentation/routes/router';

/**
 * Cliente do TanStack Query.
 *
 * Nao repete requisicao que falhou por 4xx: senha errada nao vira certa na
 * terceira tentativa, e "sem permissao" nao muda -- repetir so atrasa a
 * resposta e gasta o rate limit do usuario.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
            return false;
          }

          return failureCount < 2;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/** O idioma segue o do usuario logado; antes do login, o do navegador. */
function LocalizedApp() {
  const { user } = useSession();

  const locale = useMemo<Locale>(() => {
    if (user) {
      return user.locale;
    }

    return navigator.language.toLowerCase().startsWith('en') ? Locale.EN_US : Locale.PT_BR;
  }, [user]);

  return (
    <LocaleProvider locale={locale}>
      <WorkspaceProvider>
        <RouterProvider router={router} />
      </WorkspaceProvider>
    </LocaleProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <DependenciesProvider>
          <SessionProvider>
            <LocalizedApp />
          </SessionProvider>
        </DependenciesProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
