import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
