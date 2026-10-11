import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Varios archivos cargan la app completa en un beforeAll: con la máquina cargada (pnpm test corre los tres
    // paquetes a la vez) los 10 s por defecto no siempre alcanzan.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
