import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Barril de reexport: cobri-lo nao diz nada sobre a regra estar testada.
      exclude: ['src/index.ts', 'src/**/*.spec.ts'],
      reporter: ['text', 'html'],
      // Este pacote e' a regra 1 do dominio. Se a cobertura cair, algo passou
      // sem teste -- e o bug de dinheiro que ninguem ve e' de um centavo.
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
