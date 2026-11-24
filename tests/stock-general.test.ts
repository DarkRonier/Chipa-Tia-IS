// «Todo el stock» (2026-11-24): la tabla con un producto por fila y un depósito por columna.
import { describe, expect, it } from 'vitest'
import { filasGenerales, listadoPDF } from '../src/cliente/stockGeneral'
import type { StockFila } from '../src/shared/tipos'

const fila = (id: string, nombre: string, categoriaId: string | null, porDeposito: Record<string, number>, subcategoria = ''): StockFila => ({
  productoId: id, productoNombre: nombre, sector: 'chiperia', categoriaId, subcategoria, unidad: 'unidades', activo: true,
  total: Object.values(porDeposito).reduce((a, b) => a + b, 0), porDeposito, lotes: [],
})

const FILAS = [
  fila('p1', 'Chipa so’o', 'chipas', { venta: 10, frio: 30 }),
  fila('p2', 'Coca-Cola 500 ml', 'bebidas', { venta: 24 }, 'Gaseosas'),
  fila('p3', 'Chipa común', 'chipas', { frio: 50, materia_prima: 5 }),
  fila('p4', 'Agua 500 ml', 'bebidas', {}),
  fila('p5', 'Pan felipe', 'panificados', { comedor: -2 }),
]
const TODOS = { categoria: '', buscar: '', ocultarCeros: true }

describe('Todo el stock', () => {
  it('una columna por depósito, con el total de esas columnas; agrupado por categoría en el orden del catálogo', () => {
    const g = filasGenerales(FILAS, ['venta', 'comedor', 'frio'], TODOS, ['chipas', 'panificados', 'bebidas'])
    expect(g.map((x) => x.categoria)).toEqual(['chipas', 'panificados', 'bebidas'])
    // Dentro de cada categoría, por nombre.
    expect(g[0].filas.map((f) => [f.fila.productoNombre, f.cantidades, f.total])).toEqual([
      ['Chipa común', [0, 0, 50], 50],
      ['Chipa so’o', [10, 0, 30], 40],
    ])
    // Lo que está en un depósito que no se muestra (materia prima) no suma; los negativos se ven.
    expect(g[1].filas[0].cantidades).toEqual([0, -2, 0])
  })

  it('oculta lo que está en 0 en las columnas que se muestran, salvo que se pida verlo', () => {
    const soloVenta = filasGenerales(FILAS, ['venta'], TODOS).flatMap((x) => x.filas.map((f) => f.fila.productoId))
    expect(soloVenta.sort()).toEqual(['p1', 'p2'])
    const conCeros = filasGenerales(FILAS, ['venta'], { ...TODOS, ocultarCeros: false }).flatMap((x) => x.filas)
    expect(conCeros).toHaveLength(5)
  })

  it('busca por nombre, subcategoría o código sin importar tildes, y filtra por categoría', () => {
    const ids = (f: Parameters<typeof filasGenerales>[2]) =>
      filasGenerales(FILAS, ['venta', 'comedor', 'frio'], f).flatMap((x) => x.filas.map((r) => r.fila.productoId))
    expect(ids({ ...TODOS, buscar: 'CHIPA comun' })).toEqual(['p3'])
    expect(ids({ ...TODOS, buscar: 'gaseosas' })).toEqual(['p2'])
    expect(ids({ ...TODOS, buscar: 'p5' })).toEqual(['p5'])
    expect(ids({ ...TODOS, categoria: 'bebidas' })).toEqual(['p2'])
  })
})

describe('PDF del stock de un depósito', () => {
  it('lista lo que hay en ese depósito (también lo negativo), por categoría y por nombre, con los lotes si lleva', () => {
    const conLote: StockFila = { ...fila('p6', 'Chipa almidón', 'chipas', { frio: 12 }), lotes: [
      { lote: 'CH-1', cantidad: 5, porDeposito: { frio: 5 } },
      { lote: 'CH-2', cantidad: 7, porDeposito: { frio: 7, venta: 0 } },
      { lote: 'CH-0', cantidad: 3, porDeposito: { venta: 3 } },
    ] }
    const g = listadoPDF([...FILAS, conLote], 'frio', ['chipas'], (f) => f.productoId === 'p6')
    expect(g.map((x) => x.categoria)).toEqual(['chipas'])
    expect(g[0].filas.map((f) => [f.nombre, f.cantidad, f.lotes.map((l) => l.lote)])).toEqual([
      ['Chipa almidón', 12, ['CH-1', 'CH-2']],
      ['Chipa común', 50, []],
      ['Chipa so’o', 30, []],
    ])
    expect(listadoPDF(FILAS, 'comedor')[0].filas[0]).toMatchObject({ nombre: 'Pan felipe', cantidad: -2 })
    expect(listadoPDF(FILAS, 'no-existe')).toEqual([])
  })
})
