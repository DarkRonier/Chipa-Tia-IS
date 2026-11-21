// Las pruebas comparten proceso (isolate: false en vitest.config.ts) para no recargar todo el código en cada
// archivo. Al terminar cada archivo se deshace lo que pudo dejar tocado: reloj simulado, fetch simulado y espías.
import { afterAll, vi } from 'vitest'

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
