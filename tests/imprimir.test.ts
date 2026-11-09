// Nombres de archivo de los PDF de reportes y trazabilidad (H06, H09).
import { describe, expect, it } from 'vitest'
import { nombreArchivoReporte, nombreArchivoTrazabilidad, nombreSeguro } from '../src/cliente/imprimir'

describe('nombre del PDF', () => {
  it('reporte de un rango', () => {
    expect(nombreArchivoReporte('2026-10-01', '2026-10-31')).toBe('Reporte Chipa Tía 2026-10-01 a 2026-10-31')
  })

  it('reporte de un solo día y con sector', () => {
    expect(nombreArchivoReporte('2026-10-05', '2026-10-05')).toBe('Reporte Chipa Tía 2026-10-05')
    expect(nombreArchivoReporte('2026-10-01', '2026-10-31', 'Chipería')).toBe('Reporte Chipa Tía 2026-10-01 a 2026-10-31 Chipería')
  })

  it('trazabilidad de un lote', () => {
    expect(nombreArchivoTrazabilidad('lote CH-261010-1')).toBe('Trazabilidad Chipa Tía lote CH-261010-1')
  })

  it('saca los caracteres que un archivo no admite', () => {
    expect(nombreSeguro('Lote  A/B: "harina"?\n')).toBe('Lote A B harina')
  })
})
