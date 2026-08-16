import { type AuthenticatedUser, type Session } from '@finapp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useDependencies } from './dependencies';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  user: AuthenticatedUser | null;
  /** Workspace ativo. No onboarding e' sempre o pessoal. */
  workspaceId: string | null;
  setSession: (session: Session) => void;
  setUser: (user: AuthenticatedUser) => void;
  signOut: () => Promise<void>;
  isOnboardingComplete: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Sessao do usuario.
 *
 * No boot, tenta RESTAURAR pelo cookie de refresh: o access token so vive em
 * memoria, entao um F5 sempre o perde -- sem essa tentativa, recarregar a
 * pagina deslogaria o usuario a cada vez.
 *
 * Enquanto o status e' `loading`, o router nao decide nada. Decidir antes
 * mandaria para o login quem tem sessao valida, e a tela piscaria.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { auth, http } = useDependencies();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<AuthenticatedUser | null>(null);

  const setSession = useCallback((session: Session) => {
    setUserState(session.user);
    setStatus('authenticated');
  }, []);

  const setUser = useCallback((next: AuthenticatedUser) => {
    setUserState(next);
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setUserState(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [auth, queryClient]);

  // Restauracao no boot.
  useEffect(() => {
    let cancelled = false;

    void auth
      .restore()
      .then((session) => {
        if (cancelled) {
          return;
        }

        if (session) {
          setUserState(session.user);
          setStatus('authenticated');
        } else {
          setStatus('anonymous');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('anonymous');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth]);

  // Sessao perdida no meio do uso (refresh falhou): volta para o estado anonimo.
  useEffect(() => {
    http.onSessionLost(() => {
      setUserState(null);
      setStatus('anonymous');
      queryClient.clear();
    });
  }, [http, queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      workspaceId: user?.personalWorkspaceId ?? null,
      setSession,
      setUser,
      signOut,
      isOnboardingComplete: user?.onboardingCompletedAt !== null && user !== null,
    }),
    [status, user, setSession, setUser, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  }

  return context;
}
