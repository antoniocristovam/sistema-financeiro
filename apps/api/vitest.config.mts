import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Testes de unidade: casos de uso puros com repositorios in-memory. Sem banco.
 *
 * O arquivo e' `.mts` de proposito: `apps/api` e' CommonJS (por causa do Nest),
 * e o `vite-tsconfig-paths` so existe em ESM. Sem a extensao explicita, o
 * carregador tenta `require` num modulo ESM e quebra.
 */
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    // Necessario para os decorators do Nest nos arquivos de infra.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // So o dominio puro. Cobrir controller e modulo do Nest nao diz nada
      // sobre a regra de negocio estar testada.
      include: ['src/modules/**/core/**', 'src/shared/domain/**', 'src/shared/either.ts'],
      exclude: ['**/*.spec.ts'],
      reporter: ['text', 'html'],
    },
  },
});
