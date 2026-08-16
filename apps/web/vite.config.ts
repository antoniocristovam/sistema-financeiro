import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // As variaveis VITE_* moram no .env da raiz do monorepo, nao em apps/web.
  envDir: fromRoot('../../'),

  resolve: {
    alias: {
      '@': fromRoot('./src'),

      /*
       * Pacotes do workspace consumidos pela FONTE, nao pelo `dist`.
       *
       * `contracts` e `money` compilam para CommonJS porque a API (NestJS) e'
       * CJS. O Rollup nao consegue detectar os exports nomeados de um CJS que
       * so reexporta -- `Locale` some e o build quebra.
       *
       * Ler a fonte resolve isso, e ainda da HMR de verdade: mexer em um
       * schema do contracts recarrega o app na hora, sem rebuild do pacote.
       */
      '@finapp/contracts': fromRoot('../../packages/contracts/src/index.ts'),
      '@finapp/money': fromRoot('../../packages/money/src/index.ts'),
    },
  },

  server: {
    port: 5173,
    strictPort: true,
  },
});
