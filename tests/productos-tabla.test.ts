// Pantalla de productos: filtro, páginas de 10 y exportación a CSV.
import { describe, expect, it } from 'vitest'
import {
  aCSV, botonesPagina, ENCABEZADOS_EXPORTACION, filasExportacion, filtrarProductos, FILTRO_VACIO, hayFiltro, paginar, type Nombres,
} from '../src/cliente/productos'
import type { Producto } from '../src/shared/tipos'

const base: Producto = {
  id: '', sector: 'chiperia', nombre: '', unidad: 'unidades', activo: true,
  categoriaId: null, precioVenta: null, iva: 10, codigo: '', tipo: 'elaborado',
}
const prod = (id: string, cambios: Partial<Producto> = {}): Producto => ({ ...base, id, nombre: id, ...cambios })

const nombres: Nombres = {
  sector: (id) => ({ chiperia: 'Chipería', chipitas: 'Chipitas', panaderia: 'Panadería', cocina: 'Cocina y buffet' })[id],
  categoria: (id) => (id === 'lac' ? 'Lácteos' : id === 'beb' ? 'Bebidas' : ''),
}

const lista = [
  prod('Chipa so\'o', { codigo: 'CS1', precioVenta: 5000 }),
  prod('Queso Paraguay', { tipo: 'materia_prima', categoriaId: 'lac' }),
  prod('Coca-Cola 500 ml', { sector: 'cocina', tipo: 'reventa', categoriaId: 'beb', precioVenta: 8000 }),
  prod('Chipa vieja', { activo: false }),
  prod('Pan casero', { sector: 'panaderia' }),
]
const ids = (l: Producto[]) => l.map((p) => p.id)

describe('filtro de productos', () => {
  it('sin filtro trae todos, los desactivados al final', () => {
    expect(ids(filtrarProductos(lista, FILTRO_VACIO, nombres))).toEqual(["Chipa so'o", 'Queso Paraguay', 'Coca-Cola 500 ml', 'Pan casero', 'Chipa vieja'])
    expect(hayFiltro(FILTRO_VACIO)).toBe(false)
  })

  it('busca por nombre sin tildes ni mayúsculas, por código, por categoría y por sector', () => {
    const t = (texto: string) => ids(filtrarProductos(lista, { ...FILTRO_VACIO, texto }, nombres))
    expect(t('chipa')).toEqual(["Chipa so'o", 'Chipa vieja'])
    expect(t('cs1')).toEqual(["Chipa so'o"])
    expect(t('lacteos')).toEqual(['Queso Paraguay'])
    expect(t('panaderia')).toEqual(['Pan casero'])
    expect(t('coca 500')).toEqual(['Coca-Cola 500 ml'])
  })

  it('filtra por sector, tipo, categoría y estado', () => {
    const f = (c: Partial<typeof FILTRO_VACIO>) => ids(filtrarProductos(lista, { ...FILTRO_VACIO, ...c }, nombres))
    expect(f({ sector: 'cocina' })).toEqual(['Coca-Cola 500 ml'])
    expect(f({ tipo: 'materia_prima' })).toEqual(['Queso Paraguay'])
    expect(f({ categoria: 'beb' })).toEqual(['Coca-Cola 500 ml'])
    expect(f({ categoria: 'ninguna' })).toEqual(["Chipa so'o", 'Pan casero', 'Chipa vieja'])
    expect(f({ estado: 'activos' })).not.toContain('Chipa vieja')
    expect(f({ estado: 'desactivados' })).toEqual(['Chipa vieja'])
    expect(hayFiltro({ ...FILTRO_VACIO, estado: 'activos' })).toBe(true)
  })
})

describe('páginas de la tabla', () => {
  const muchos = Array.from({ length: 23 }, (_, i) => i + 1)

  it('muestra hasta 10 por página', () => {
    expect(paginar(muchos, 1)).toMatchObject({ items: muchos.slice(0, 10), pagina: 1, paginas: 3, desde: 1, hasta: 10, total: 23 })
    expect(paginar(muchos, 3)).toMatchObject({ items: [21, 22, 23], desde: 21, hasta: 23 })
  })

  it('si la página pedida ya no existe (por ejemplo, después de filtrar) muestra la última', () => {
    expect(paginar(muchos, 9).pagina).toBe(3)
    expect(paginar([], 2)).toMatchObject({ items: [], pagina: 1, paginas: 1, desde: 0, hasta: 0 })
  })

  it('botones: primera, última y vecinas de la actual, con «…» en los saltos', () => {
    expect(botonesPagina(1, 1)).toEqual([1])
    expect(botonesPagina(1, 3)).toEqual([1, 2, 3])
    expect(botonesPagina(5, 10)).toEqual([1, null, 4, 5, 6, null, 10])
    expect(botonesPagina(3, 10)).toEqual([1, 2, 3, 4, null, 10])
  })
})

describe('exportación', () => {
  it('una fila por producto con todas las columnas', () => {
    const filas = filasExportacion(lista.slice(0, 3), nombres)
    expect(filas.every((f) => f.length === ENCABEZADOS_EXPORTACION.length)).toBe(true)
    expect(filas[2]).toEqual(['Coca-Cola 500 ml', '', 'Cocina y buffet', 'Venta directa', 'Bebidas', 'unidades', 'Gs. 8.000', 'IVA 10 %', 'Activo'])
    expect(filas[1][6]).toBe('')
  })

  it('CSV para Excel en español: BOM, punto y coma y comillas donde hacen falta', () => {
    const csv = aCSV(['Producto', 'Notas'], [['Chipa "so\'o"', 'a;b'], ['Pan', 'simple']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['Producto;Notas', '"Chipa ""so\'o""";"a;b"', 'Pan;simple', ''])
  })
})
