// Qué productos usa cada sector (compra, mueve, ve en stock y anota como materia prima usada).
// - Lo elaborado: el sector que lo elabora (productos.sector), que es quien lo produce.
// - Lo comprado (materia prima y venta directa): los sectores que tienen habilitada su categoría (activa) en Catálogos.
//   El sector guardado en esos productos no cuenta: la harina es una sola y la usan todos los que compran «Materia prima»
//   (Mati, 2026-11-23). Ese dato solo sigue diciendo si la materia prima lleva lote (Chipería) y en qué libro va su stock.
import { todas } from './db'
import type { BaseD1, ValorSQL } from './entorno'
import type { SectorId } from '../shared/tipos'

/** Condición SQL (con sus dos parámetros) para «el producto `alias` lo usa el sector». */
export function sqlDelSector(alias: string, sector: SectorId): { sql: string; params: ValorSQL[] } {
  return {
    sql: `((${alias}.tipo = 'elaborado' AND ${alias}.sector = ?) OR (${alias}.tipo <> 'elaborado' AND EXISTS (
            SELECT 1 FROM categorias_sectores x JOIN categorias k ON k.id = x.categoria_id
             WHERE x.categoria_id = ${alias}.categoria_id AND x.sector = ? AND k.activo = 1)))`,
    params: [sector, sector],
  }
}

/** De los `ids`, los que usa el sector. */
export async function idsDelSector(db: BaseD1, sector: SectorId, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const c = sqlDelSector('p', sector)
  const filas = await todas<{ id: string }>(
    db, `SELECT p.id FROM productos p WHERE p.id IN (SELECT value FROM json_each(?)) AND ${c.sql}`, JSON.stringify([...new Set(ids)]), ...c.params,
  )
  return new Set(filas.map((f) => f.id))
}
