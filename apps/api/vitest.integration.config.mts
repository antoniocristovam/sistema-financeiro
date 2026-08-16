import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Testes de integracao: controllers contra Postgres REAL.
 *
 * O banco e' o container `postgres-test` (porta 5433), com `tmpfs` -- rapido de
 * resetar e sem residuo entre execucoes.
 *
 * `fileParallelism: false` porque os arquivos compartilham o mesmo banco: em
 * paralelo, o TRUNCATE de um teste apagaria os dados de outro no meio da
 * execucao.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.e2e-spec.ts'],
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./test/integration/global-setup.ts'],
    setupFiles: ['./test/setup-integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
