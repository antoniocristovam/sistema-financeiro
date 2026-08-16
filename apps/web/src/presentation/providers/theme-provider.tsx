import { Theme } from '@finapp/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const THEME_STORAGE_KEY = 'finapp.theme';

interface ThemeContextValue {
  /** Preferencia escolhida: claro, escuro ou seguir o sistema. */
  theme: Theme;
  /** O que esta REALMENTE pintado agora. `SYSTEM` ja resolvido. */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);

    return stored === Theme.DARK || stored === Theme.LIGHT ? stored : Theme.SYSTEM;
  } catch {
    return Theme.SYSTEM;
  }
}

function applyTheme(theme: Theme): 'light' | 'dark' {
  const isDark = theme === Theme.DARK || (theme === Theme.SYSTEM && prefersDark());

  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

  return isDark ? 'dark' : 'light';
}

/**
 * Tema claro / escuro / sistema.
 *
 * O tema INICIAL nao e' aplicado aqui: um script inline no `index.html` faz
 * isso antes do bundle carregar. Se dependesse deste provider, todo reload em
 * modo escuro piscaria branco entre a primeira pintura e a montagem do React.
 *
 * Este provider cuida do resto: trocar em runtime e acompanhar a mudanca de
 * preferencia do sistema operacional enquanto o app esta aberto.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setResolved(applyTheme(next));

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage bloqueado (aba anonima, politica do navegador): o tema vale
      // para esta sessao e volta ao padrao no proximo boot. Nao e motivo para
      // quebrar a troca de tema.
    }
  }, []);

  // Em modo `SYSTEM`, seguir a mudanca do SO enquanto o app esta aberto.
  useEffect(() => {
    if (theme !== Theme.SYSTEM) {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(applyTheme(Theme.SYSTEM));

    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  }

  return context;
}
