// H01–H02: el reporte del administrador para un rango de días (en hora de Paraguay) y, si se pide, un sector.
// Producción por producto (cocinado contra guardado), stock en frío actual, envíos por sucursal, salidas del
// stock por tipo, lotes de Chipería, temperaturas fuera de rango, máquinas con fallas y limpiezas.
// Lo usan GET /reportes, el resumen por correo (H04) y el Excel (H03, en el navegador).
import type { Reporte, SectorId, TipoMovimiento } from '../shared/tipos'
import { leerLotesChipa } from './consultas'
import { todas, una } from './db'
import type { BaseD1, ValorSQL } from './entorno'
import { leerLecturas } from './rutas/maquinas'

export interface PedidoReporte {
  desde: string
  hasta: string
  /** null = todos los sectores. */
  sector: SectorId | null
}

/** Filtro de período y sector sobre una tabla con columnas `dia` y `sector`. */
function periodo(alias: string, p: PedidoReporte): { sql: string; params: ValorSQL[] } {
  const params: ValorSQL[] = [p.desde, p.hasta]
  let sql = `${alias}.dia >= ? AND ${alias}.dia <= ?`
  if (p.sector) {
    sql += ` AND ${alias}.sector = ?`
    params.push(p.sector)
  }
  return { sql, params }
}

export async function armarReporte(db: BaseD1, p: PedidoReporte): Promise<Reporte> {
  const prod = periodo('p', p)
  const mov = periodo('m', p)
  const lim = periodo('l', p)
  const soloSector = p.sector ? 'WHERE m.sector = ?' : ''
  const conLotes = !p.sector || p.sector === 'chiperia'

  const [produccion, cargas, stock, envios, salidas, limpiezas, lotesChipa, fueraDeRango, conFallas] = await Promise.all([
    todas<{ sector: SectorId; producto_id: string; nombre: string; cocinado: number; guardado: number }>(
      db,
      `SELECT p.sector, i.producto_id, pr.nombre, SUM(i.cocinado) AS cocinado, SUM(i.guardado) AS guardado
         FROM produccion_items i
         JOIN producciones p ON p.id = i.produccion_id
         JOIN productos pr ON pr.id = i.producto_id
         JOIN sectores s ON s.id = p.sector
        WHERE ${prod.sql}
        GROUP BY p.sector, i.producto_id
        ORDER BY s.orden, pr.orden, pr.nombre`,
      ...prod.params,
    ),
    una<{ n: number }>(db, `SELECT COUNT(*) AS n FROM producciones p WHERE ${prod.sql}`, ...prod.params),
    // Stock actual (no el del período): la suma del libro de movimientos, sin los productos en cero.
    todas<{ sector: SectorId; producto_id: string; nombre: string; total: number }>(
      db,
      `SELECT m.sector, m.producto_id, pr.nombre, SUM(m.cantidad) AS total
         FROM movimientos m
         JOIN productos pr ON pr.id = m.producto_id
         JOIN sectores s ON s.id = m.sector
        ${soloSector}
        GROUP BY m.sector, m.producto_id
       HAVING SUM(m.cantidad) <> 0
        ORDER BY s.orden, pr.orden, pr.nombre`,
      ...(p.sector ? [p.sector] : []),
    ),
    todas<{ sucursal_id: string; sucursal_nombre: string; producto_nombre: string; sector: SectorId; cantidad: number }>(
      db,
      `SELECT m.sucursal_id, su.nombre AS sucursal_nombre, pr.nombre AS producto_nombre, m.sector, -SUM(m.cantidad) AS cantidad
         FROM movimientos m
         JOIN sucursales su ON su.id = m.sucursal_id
         JOIN productos pr ON pr.id = m.producto_id
         JOIN sectores s ON s.id = m.sector
        WHERE m.tipo = 'envio' AND ${mov.sql}
        GROUP BY m.sucursal_id, m.producto_id
        ORDER BY su.nombre, s.orden, pr.orden, pr.nombre`,
      ...mov.params,
    ),
    // Lo que salió del frío en el período, por tipo (en unidades positivas). Los ajustes que suman no son salidas.
    todas<{ sector: SectorId; tipo: TipoMovimiento; cantidad: number }>(
      db,
      `SELECT m.sector, m.tipo, -SUM(m.cantidad) AS cantidad
         FROM movimientos m
         JOIN sectores s ON s.id = m.sector
        WHERE m.cantidad < 0 AND ${mov.sql}
        GROUP BY m.sector, m.tipo
        ORDER BY s.orden,
          CASE m.tipo WHEN 'salida_venta' THEN 1 WHEN 'envio' THEN 2 WHEN 'merma' THEN 3 WHEN 'vencimiento' THEN 4 ELSE 5 END`,
      ...mov.params,
    ),
    todas<{ sector: SectorId; area_nombre: string; cantidad: number; sin_controlar: number; tareas_no_hechas: number }>(
      db,
      `SELECT l.sector, a.nombre AS area_nombre, COUNT(*) AS cantidad,
              SUM(CASE WHEN l.controlado_por IS NULL THEN 1 ELSE 0 END) AS sin_controlar,
              SUM((SELECT COUNT(*) FROM limpieza_marcas lm WHERE lm.limpieza_id = l.id AND lm.marca = '-')) AS tareas_no_hechas
         FROM limpiezas l
         JOIN areas_limpieza a ON a.id = l.area_id
         JOIN sectores s ON s.id = l.sector
        WHERE ${lim.sql}
        GROUP BY l.sector, l.area_id
        ORDER BY s.orden, a.orden, a.nombre`,
      ...lim.params,
    ),
    conLotes ? leerLotesChipa(db, { desde: p.desde, hasta: p.hasta }) : Promise.resolve([]),
    leerLecturas(db, { sector: p.sector, desde: p.desde, hasta: p.hasta, fueraDeRango: true }),
    leerLecturas(db, { sector: p.sector, desde: p.desde, hasta: p.hasta, conFallas: true }),
  ])

  const suma = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
  return {
    desde: p.desde,
    hasta: p.hasta,
    generadoEn: new Date().toISOString(),
    produccion: produccion.map((f) => ({
      sector: f.sector, productoId: f.producto_id, productoNombre: f.nombre, cocinado: f.cocinado, guardado: f.guardado,
    })),
    stock: stock.map((f) => ({ sector: f.sector, productoId: f.producto_id, productoNombre: f.nombre, total: f.total })),
    envios: envios.map((f) => ({
      sucursalId: f.sucursal_id, sucursalNombre: f.sucursal_nombre, productoNombre: f.producto_nombre, sector: f.sector, cantidad: f.cantidad,
    })),
    salidas,
    lotesChipa,
    temperaturasFueraDeRango: fueraDeRango,
    maquinasConFallas: conFallas,
    limpiezas: limpiezas.map((f) => ({
      sector: f.sector, areaNombre: f.area_nombre, cantidad: f.cantidad, sinControlar: f.sin_controlar, tareasNoHechas: f.tareas_no_hechas,
    })),
    totales: {
      cargasProduccion: cargas?.n ?? 0,
      unidadesCocinadas: suma(produccion, (f) => f.cocinado),
      unidadesGuardadas: suma(produccion, (f) => f.guardado),
      unidadesEnviadas: suma(envios, (f) => f.cantidad),
      temperaturasFueraDeRango: fueraDeRango.length,
      limpiezas: suma(limpiezas, (f) => f.cantidad),
      limpiezasSinControlar: suma(limpiezas, (f) => f.sin_controlar),
    },
  }
}
