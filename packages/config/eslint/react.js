import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/**
 * Config para o app React.
 *
 * Componentes nunca chamam `fetch` direto: componente -> hook -> caso de uso -> gateway.
 */
export const reactConfig = tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['src/presentation/**/*.{ts,tsx}', 'src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use um gateway (infra/gateways) em vez de fetch direto.' },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', '@tanstack/*', '**/infra/**', '**/presentation/**'],
              message: 'domain/ e puro: sem React, sem infra, sem presentation.',
            },
          ],
        },
      ],
    },
  },
);

export default reactConfig;
