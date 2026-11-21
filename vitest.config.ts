import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    // Hilos en paralelo que reutilizan el código ya cargado entre archivos: la suite pasa de ~13 s a ~4 s.
    // Cada prueba sigue teniendo su propia base (ver tests/ayuda.ts) y tests/preparar.ts limpia lo global.
    pool: 'threads',
    isolate: false,
    setupFiles: ['tests/preparar.ts'],
  },
})
