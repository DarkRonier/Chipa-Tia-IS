// Arma y descarga archivos .xlsx en el navegador (H03, I03) con write-excel-file.
// Las fechas van como fechas de Excel con la hora de Paraguay (I04): se pueden ordenar y filtrar.
import type { Cell, CellObject, SheetData } from 'write-excel-file/browser'
import { ZONA } from '../shared/hora'

export type Celda = Cell

export interface Hoja {
  /** Nombre de la pestaña (se corta a 31 caracteres y se le sacan los caracteres prohibidos). */
  nombre: string
  encabezados: string[]
  filas: Celda[][]
  /** Filas antes del encabezado (título del reporte, período). */
  arriba?: Celda[][]
  /** Ancho de cada columna en caracteres; si falta se calcula por el contenido. */
  anchos?: number[]
}

const FORMATO_FECHA_HORA = 'dd/mm/yyyy hh:mm'
const FORMATO_DIA = 'dd/mm/yyyy'
const MAX_TEXTO = 32_000 // Excel admite hasta 32.767 caracteres por celda.

const partesPY = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

/** Instante ISO (UTC) → fecha de Excel con el reloj de Paraguay. */
export function celdaFechaHora(iso: string | null | undefined): Celda {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = Object.fromEntries(partesPY.formatToParts(d).map((x) => [x.type, x.value]))
  const valor = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second))
  return { value: valor, type: Date, format: FORMATO_FECHA_HORA }
}

/** Día AAAA-MM-DD (ya en hora de Paraguay) → fecha de Excel. */
export function celdaDia(dia: string | null | undefined): Celda {
  if (!dia) return null
  const valor = new Date(`${dia}T00:00:00Z`)
  return Number.isNaN(valor.getTime()) ? dia : { value: valor, type: Date, format: FORMATO_DIA }
}

/** Texto en negrita (títulos dentro de una hoja). */
export const negrita = (value: string, extra: Partial<CellObject> = {}): Celda => ({ value, fontWeight: 'bold', ...extra })

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/
const DIA = /^\d{4}-\d{2}-\d{2}$/

/** Valor crudo de la base (exportación completa) → celda: fechas UTC a hora de Paraguay, días como fecha. */
export function celdaDeValor(v: string | number | boolean | null | undefined): Celda {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    if (ISO.test(v)) return celdaFechaHora(v)
    if (DIA.test(v)) return celdaDia(v)
    return v.length > MAX_TEXTO ? `${v.slice(0, MAX_TEXTO)}…` : v
  }
  return v
}

/** Nombre de pestaña válido para Excel y distinto de los anteriores. */
function nombreHoja(nombre: string, usados: Set<string>): string {
  const base = (nombre.replace(/[[\]/\\:*?]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Hoja').slice(0, 31).trim()
  let n = base
  for (let i = 2; usados.has(n.toLowerCase()); i++) {
    const sufijo = ` (${i})`
    n = `${base.slice(0, 31 - sufijo.length).trim()}${sufijo}`
  }
  usados.add(n.toLowerCase())
  return n
}

function largo(c: Celda): number {
  if (c === null || c === undefined) return 0
  if (typeof c === 'object' && !(c instanceof Date) && 'value' in c) {
    if (c.value instanceof Date) return c.format === FORMATO_DIA ? 10 : 16
    return String(c.value ?? '').length
  }
  if (c instanceof Date) return 16
  return String(c).length
}

const ENCABEZADO: Partial<CellObject> = { fontWeight: 'bold', backgroundColor: '#F4E3CC', bottomBorderStyle: 'thin', bottomBorderColor: '#8A4B12' }

/** Arma el .xlsx con una pestaña por hoja y lo descarga con el nombre indicado. */
export async function descargarExcel(archivo: string, hojas: Hoja[]): Promise<void> {
  // Se carga solo al exportar: no pesa en la carga inicial de la app.
  const { default: escribirExcel } = await import('write-excel-file/browser')
  const usados = new Set<string>()
  const pestañas = hojas.map((h) => {
    const arriba = h.arriba ?? []
    const columnas = Math.max(h.encabezados.length, ...h.filas.map((f) => f.length), ...arriba.map((f) => f.length), 1)
    const data: SheetData = [
      ...arriba,
      ...(arriba.length ? [[]] : []),
      ...(h.encabezados.length ? [h.encabezados.map((t) => ({ value: t, ...ENCABEZADO }))] : []),
      ...(h.filas.length ? h.filas : h.encabezados.length ? [[{ value: 'Sin registros', fontStyle: 'italic' as const, textColor: '#75644F' }]] : []),
    ]
    const anchos = Array.from({ length: columnas }, (_, i) => {
      if (h.anchos?.[i]) return h.anchos[i]
      // Hasta 200 filas alcanzan para estimar; el título de arriba no cuenta.
      const max = Math.max(largo(h.encabezados[i]), ...h.filas.slice(0, 200).map((f) => largo(f[i])))
      return Math.min(60, Math.max(8, max + 2))
    })
    return {
      data,
      sheet: nombreHoja(h.nombre, usados),
      columns: anchos.map((width) => ({ width })),
      stickyRowsCount: h.encabezados.length ? arriba.length + (arriba.length ? 1 : 0) + 1 : 0,
    }
  })
  await escribirExcel(pestañas, { fontFamily: 'Calibri', fontSize: 11 }).toFile(archivo.endsWith('.xlsx') ? archivo : `${archivo}.xlsx`)
}

/** Descarga un texto (por ejemplo, una copia de seguridad en JSON). */
export function descargarTexto(archivo: string, contenido: string, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([contenido], { type: `${tipo};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = archivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
