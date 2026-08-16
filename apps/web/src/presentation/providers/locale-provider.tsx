import { type Locale } from '@finapp/contracts';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { DICTIONARIES, interpolate, LOCALE_TAG, type Dictionary } from '../../i18n';

/** Caminho de chave dentro do dicionario: `'auth.signIn.title'`. */
type Path<T> = T extends string
  ? []
  : { [K in keyof T]: [K, ...Path<T[K]>] }[keyof T];

type Join<T extends unknown[]> = T extends [infer F]
  ? F
  : T extends [infer F, ...infer R]
    ? F extends string
      ? `${F}.${Join<R> & string}`
      : never
    : string;

export type TranslationKey = Join<Path<Dictionary>>;

interface LocaleContextValue {
  locale: Locale;
  /** Tag BCP-47 para o `Intl`. */
  tag: string;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function resolve(dictionary: Dictionary, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);

  // Chave inexistente devolve a propria chave: e' visivel na tela e nao
  // derruba a pagina. Uma string faltando nao vale um erro em producao.
  return typeof value === 'string' ? value : key;
}

/**
 * Idioma da interface.
 *
 * O FORMATO (data, numero) vem do locale do usuario; a MOEDA vem do workspace.
 * Sao coisas diferentes: um brasileiro olhando um workspace em dolar le
 * "US$ 1.234,56".
 */
export function LocaleProvider({
  children,
  locale,
  onChange,
}: {
  children: ReactNode;
  locale: Locale;
  onChange?: (locale: Locale) => void;
}) {
  const dictionary = DICTIONARIES[locale];

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      interpolate(resolve(dictionary, key as string), values),
    [dictionary],
  );

  const setLocale = useCallback(
    (next: Locale) => {
      onChange?.(next);
    },
    [onChange],
  );

  const value = useMemo(
    () => ({ locale, tag: LOCALE_TAG[locale], t, setLocale }),
    [locale, t, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation(): LocaleContextValue {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error('useTranslation precisa estar dentro de <LocaleProvider>.');
  }

  return context;
}
