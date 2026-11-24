// «Todo el stock» (Mati, 2026-11-24: «facilitar la vista del stock de los depósitos»): una sola tabla con un producto
// por fila y un depósito por columna, para ver de un vistazo qué hay en cada lado sin entrar a cada depósito.
import { normalizar } from '../components/Buscador'
import type { StockFila } from '../shared/tipos'

export interface FiltroGeneral {
  /** Id de categoría; vacío = todas. */
  categoria: string
  /** Palabras a buscar en nombre, subcategoría o código. */
  buscar: string
  /** Saca las filas que no tienen nada en ninguna de las columnas que se muestran. */
  ocultarCeros: boolean
}

export interface FilaGeneral {
  fila: StockFila
  /** Cantidad en cada columna, en el mismo orden que `columnas`. */
  cantidades: number[]
  /** Suma de las columnas que se muestran. */
  total: number
}

/** Arma las filas de la tabla: filtradas, agrupadas por categoría (en el orden del catálogo) y por nombre dentro de cada una. */
export function filasGenerales(filas: StockFila[], columnas: string[], filtro: FiltroGeneral, ordenCategorias: string[] = []) {
  const palabras = normalizar(filtro.buscar).split(/\s+/).filter(Boolean)
  const grupos = new Map<string, FilaGeneral[]>()
  for (const f of filas) {
    if (filtro.categoria && (f.categoriaId ?? '') !== filtro.categoria) continue
    const texto = normalizar(`${f.productoNombre} ${f.subcategoria} ${f.productoId}`)
    if (!palabras.every((p) => texto.includes(p))) continue
    const cantidades = columnas.map((id) => f.porDeposito[id] ?? 0)
    if (filtro.ocultarCeros && cantidades.every((n) => n === 0)) continue
    const k = f.categoriaId ?? ''
    grupos.set(k, [...(grupos.get(k) ?? []), { fila: f, cantidades, total: cantidades.reduce((a, b) => a + b, 0) }])
  }
  const pos = (id: string) => ordenCategorias.indexOf(id) + 1 || 9999
  return [...grupos.entries()]
    .sort(([a], [b]) => pos(a) - pos(b))
    .map(([categoria, lista]) => ({ categoria, filas: lista.sort((a, b) => a.fila.productoNombre.localeCompare(b.fila.productoNombre, 'es')) }))
}
