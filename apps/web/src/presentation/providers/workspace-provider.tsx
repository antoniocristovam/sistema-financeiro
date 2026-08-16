import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useSession } from './session-provider';

const STORAGE_KEY = 'finapp.activeWorkspace';

interface WorkspaceContextValue {
  activeId: string | null;
  setActiveId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Workspace ativo.
 *
 * Fica no `localStorage` para sobreviver ao reload -- e' preferencia de
 * navegacao, nao credencial, entao guardar aqui nao tem o problema de guardar
 * token.
 *
 * Trocar de workspace LIMPA o cache do React Query: os dados do anterior nao
 * podem continuar na tela enquanto os novos chegam, senao o usuario ve os
 * gastos de um workspace com o nome de outro no topo.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setActiveId = useCallback(
    (id: string) => {
      setStored(id);

      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // Storage bloqueado: a escolha vale para esta sessao.
      }

      queryClient.clear();
    },
    [queryClient],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      // Sem escolha guardada, cai no pessoal -- o que todo usuario tem.
      activeId: stored ?? user?.personalWorkspaceId ?? null,
      setActiveId,
    }),
    [stored, user, setActiveId],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error('useWorkspace precisa estar dentro de <WorkspaceProvider>.');
  }

  return context;
}
