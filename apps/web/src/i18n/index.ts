import { Locale, LOCALE_TAG } from '@finapp/contracts';

import { enUS } from './en-US';
import { ptBR, type Dictionary } from './pt-BR';

export type { Dictionary };

export const DICTIONARIES: Record<Locale, Dictionary> = {
  [Locale.PT_BR]: ptBR,
  [Locale.EN_US]: enUS,
};

export { LOCALE_TAG };

/**
 * Interpolacao simples: `{nome}` no texto vira o valor passado.
 *
 * Sem biblioteca de i18n neste momento de proposito: um dicionario tipado ja
 * cobre o que a fase precisa, e trocar por i18next depois e' local -- so este
 * arquivo e o provider sabem como a traducao e' resolvida.
 */
export function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
