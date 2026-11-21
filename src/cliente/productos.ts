// Pantalla de productos: filtro, páginas de la tabla y exportación (CSV y PDF). Funciones puras, probadas en
// tests/productos-tabla.test.ts; la pantalla está en src/pages/admin/Productos.tsx.
import { normalizar } from '../components/Buscador'
import { gs } from '../shared/dinero'
import { NOMBRE_IVA, type Producto, type SectorId, type TipoProducto } from '../shared/tipos'

export const POR_PAGINA = 10

/** Nombre corto del tipo, para la tabla (el largo, con la explicación, va en el formulario). */
export const TIPO_CORTO: Record<TipoProducto, string> = {
  elaborado: 'Elaborado',
  materia_prima: 'Materia prima',
  reventa: 'Venta directa',
}

export type EstadoFiltro = 'todos' | 'activos' | 'desactivados'

export interface FiltroProductos {
  /** Texto libre: busca en nombre, código, categoría, subcategoría y sector. */
  texto: string
  sector: SectorId | ''
  tipo: TipoProducto | ''
  /** Id de la categoría, '' = cualquiera, 'ninguna' = sin categoría. */
  categoria: string
  estado: EstadoFiltro
}

export const FILTRO_VACIO: FiltroProductos = { texto: '', sector: '', tipo: '', categoria: '', estado: 'todos' }

export const hayFiltro = (f: FiltroProductos) =>
  Boolean(f.texto.trim() || f.sector || f.tipo || f.categoria || f.estado !== FILTRO_VACIO.estado)

export interface Nombres {
  sector: (id: SectorId) => string
  categoria: (id: string | null) => string
}

/**
 * Los productos que pasan el filtro. Los activos primero y, dentro de cada grupo, el orden que trae la API
 * (sector y orden del producto). Todas las palabras del texto tienen que aparecer, sin importar tildes ni mayúsculas.
 */
export function filtrarProductos(lista: Producto[], f: FiltroProductos, n: Nombres): Producto[] {
  const palabras = normalizar(f.texto).split(/\s+/).filter(Boolean)
  const pasan = lista.filter((p) => {
    if (f.sector && p.sector !== f.sector) return false
    if (f.tipo && p.tipo !== f.tipo) return false
    if (f.categoria === 'ninguna' ? p.categoriaId !== null : f.categoria && p.categoriaId !== f.categoria) return false
    if (f.estado === 'activos' && !p.activo) return false
    if (f.estado === 'desactivados' && p.activo) return false
    if (!palabras.length) return true
    const todo = normalizar([p.nombre, p.codigo, n.categoria(p.categoriaId), p.subcategoria, n.sector(p.sector)].join(' '))
    return palabras.every((x) => todo.includes(x))
  })
  return [...pasan.filter((p) => p.activo), ...pasan.filter((p) => !p.activo)]
}

export interface Pagina<T> {
  items: T[]
  /** Página que se muestra (1 en adelante), ya ajustada si la pedida no existe. */
  pagina: number
  paginas: number
  /** Posición (desde 1) del primero y del último que se muestran; 0 si no hay nada. */
  desde: number
  hasta: number
  total: number
}

export function paginar<T>(lista: T[], pagina: number, porPagina = POR_PAGINA): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina))
  const actual = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas)
  const inicio = (actual - 1) * porPagina
  const items = lista.slice(inicio, inicio + porPagina)
  return { items, pagina: actual, paginas, desde: items.length ? inicio + 1 : 0, hasta: inicio + items.length, total: lista.length }
}

/** Números de página a mostrar: siempre la primera, la última y las vecinas de la actual; null es «…». */
export function botonesPagina(actual: number, paginas: number): (number | null)[] {
  const ver = new Set([1, paginas, actual - 1, actual, actual + 1].filter((x) => x >= 1 && x <= paginas))
  const orden = [...ver].sort((a, b) => a - b)
  const r: (number | null)[] = []
  orden.forEach((x, i) => {
    if (i && x - orden[i - 1] === 2) r.push(x - 1)
    else if (i && x - orden[i - 1] > 2) r.push(null)
    r.push(x)
  })
  return r
}

export const ENCABEZADOS_EXPORTACION = [
  'Producto', 'Código', 'Sector', 'Tipo', 'Categoría', 'Subcategoría', 'Unidad', 'Stock', 'Precio de venta', 'IVA', 'Estado',
]

/** Una fila por producto, con las mismas columnas que ENCABEZADOS_EXPORTACION. */
export function filasExportacion(lista: Producto[], n: Nombres): string[][] {
  return lista.map((p) => [
    p.nombre,
    p.codigo,
    n.sector(p.sector),
    TIPO_CORTO[p.tipo],
    n.categoria(p.categoriaId),
    p.subcategoria,
    p.unidad,
    p.sinStock ? 'Solo ventas' : 'Con stock',
    p.precioVenta === null ? '' : gs(p.precioVenta),
    p.precioVenta === null ? '' : NOMBRE_IVA[p.iva],
    p.activo ? 'Activo' : 'Desactivado',
  ])
}

/**
 * CSV que Excel abre bien en español: separado por punto y coma, con BOM para que respete las tildes,
 * y comillas en los campos que las necesitan.
 */
export function aCSV(encabezados: string[], filas: string[][]): string {
  const celda = (v: string) => (/[";\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n'
}

/** Descarga un texto como archivo (en el navegador). */
export function descargarTexto(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
