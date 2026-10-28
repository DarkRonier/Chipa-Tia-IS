// Cuentas de los gráficos del Resumen: períodos comparados, variación y escala de los ejes.
import { describe, expect, it } from 'vitest'
import { escalaY, pasoRotulos, periodosComparados, sumaSerie, variacion } from '../src/components/graficos/datos'
import type { SerieReporte } from '../src/shared/tipos'

describe('períodos comparados', () => {
  it('semana: de lunes a hoy contra el mismo tramo de la semana pasada', () => {
    // 2026-10-10 es sábado.
    expect(periodosComparados('semana', '2026-10-10')).toEqual({
      actual: { desde: '2026-10-05', hasta: '2026-10-10' },
      previo: { desde: '2026-09-28', hasta: '2026-10-03' },
    })
    // Un lunes se compara con el lunes anterior.
    expect(periodosComparados('semana', '2026-10-05')).toEqual({
      actual: { desde: '2026-10-05', hasta: '2026-10-05' },
      previo: { desde: '2026-09-28', hasta: '2026-09-28' },
    })
  })

  it('mes: del 1 a hoy contra el mismo tramo del mes pasado, sin pasarse de su último día', () => {
    expect(periodosComparados('mes', '2026-10-10')).toEqual({
      actual: { desde: '2026-10-01', hasta: '2026-10-10' },
      previo: { desde: '2026-09-01', hasta: '2026-09-10' },
    })
    expect(periodosComparados('mes', '2026-03-31').previo).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(periodosComparados('mes', '2026-01-15').previo).toEqual({ desde: '2025-12-01', hasta: '2025-12-15' })
  })
})

describe('variación', () => {
  it('sube, baja, igual y sin base', () => {
    expect(variacion(112, 100)).toMatchObject({ texto: '▲ +12 %', sentido: 'sube' })
    expect(variacion(92, 100)).toMatchObject({ texto: '▼ −8 %', sentido: 'baja' })
    expect(variacion(104, 100)).toMatchObject({ texto: '▲ +4 %' })
    expect(variacion(1045, 1000).texto).toBe('▲ +4,5 %')
    expect(variacion(0, 0)).toMatchObject({ texto: '= 0 %', sentido: 'igual' })
    expect(variacion(5, 5).sentido).toBe('igual')
    expect(variacion(7, 0)).toMatchObject({ texto: '▲ nuevo', sentido: 'sube' })
    expect(variacion(0, 7)).toMatchObject({ texto: '▼ −100 %', sentido: 'baja' })
  })
})

describe('escala', () => {
  it('redondea el tope y arranca en cero', () => {
    expect(escalaY(0).ticks[0]).toBe(0)
    expect(escalaY(87)).toEqual({ tope: 100, ticks: [0, 25, 50, 75, 100] })
    expect(escalaY(1234)).toEqual({ tope: 1500, ticks: [0, 500, 1000, 1500] })
    for (const m of [1, 3, 17, 260, 9999, 123456]) expect(escalaY(m).tope).toBeGreaterThanOrEqual(m)
  })
  it('espacia los rótulos del eje', () => {
    expect(pasoRotulos(40)).toBe(2)
    expect(pasoRotulos(4)).toBe(12)
    expect(pasoRotulos(100)).toBe(1)
  })
})

describe('suma de la serie', () => {
  const cero = { cocinado: 0, guardado: 0, enviado: 0, vendido: 0 }
  const serie: SerieReporte = {
    desde: '2026-10-01', hasta: '2026-10-03',
    dias: ['2026-10-01', '2026-10-02', '2026-10-03'].map((dia, i) => ({
      dia,
      sectores: { chiperia: { ...cero, cocinado: 10 * (i + 1) }, chipitas: cero, panaderia: cero, cocina: { ...cero, cocinado: 1, vendido: 2 } },
    })),
  }
  it('por sector, total y rango', () => {
    expect(sumaSerie(serie, 'cocinado', { desde: '2026-10-02', hasta: '2026-10-03' }, 'chiperia')).toBe(50)
    expect(sumaSerie(serie, 'cocinado', { desde: '2026-10-01', hasta: '2026-10-03' })).toBe(63)
    expect(sumaSerie(serie, 'vendido', { desde: '2026-10-01', hasta: '2026-10-01' })).toBe(2)
  })
})
