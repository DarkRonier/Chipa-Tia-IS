// Serie diaria por sector para los gráficos del Resumen: cocinado, guardado en frío, enviado a sucursales
// y sacado a la venta. Mismas definiciones que armarReporte (src/server/reporte.ts), así que la suma de la
// serie de un rango coincide con el reporte del mismo rango. Dos consultas agrupadas por (día, sector),
// nunca una por día: Workers Free permite 50 consultas a D1 por pedido.
import { sumarDias } from '../shared/hora'
import { SECTOR_IDS, type DiaSerie, type MedidasSerie, type SectorId, type SerieReporte } from '../shared/tipos'
import { todas } from './db'
import type { BaseD1 } from './entorno'

const vacias = (): MedidasSerie => ({ cocinado: 0, guardado: 0, enviado: 0, vendido: 0 })

export async function armarSerie(db: BaseD1, p: { desde: string; hasta: string }): Promise<SerieReporte> {
  const [produccion, movimientos] = await Promise.all([
    // Como «produccion» del reporte: items de producciones con producto y sector existentes.
    todas<{ dia: string; sector: SectorId; cocinado: number; guardado: number }>(
      db,
      `SELECT p.dia, p.sector, SUM(i.cocinado) AS cocinado, SUM(i.guardado) AS guardado
         FROM produccion_items i
         JOIN producciones p ON p.id = i.produccion_id
         JOIN productos pr ON pr.id = i.producto_id
         JOIN sectores s ON s.id = p.sector
        WHERE p.dia >= ? AND p.dia <= ?
        GROUP BY p.dia, p.sector`,
      p.desde, p.hasta,
    ),
    // Enviado: los «envio» con sucursal, como `envios` del reporte. Vendido: lo que salió del frío como
    // «salida_venta», como `salidas` del reporte (solo cantidades negativas). Ambos en unidades positivas.
    todas<{ dia: string; sector: SectorId; enviado: number; vendido: number }>(
      db,
      `SELECT m.dia, m.sector,
              -SUM(CASE WHEN m.tipo = 'envio' AND m.sucursal_id IS NOT NULL THEN m.cantidad ELSE 0 END) AS enviado,
              -SUM(CASE WHEN m.tipo = 'salida_venta' AND m.cantidad < 0 THEN m.cantidad ELSE 0 END) AS vendido
         FROM movimientos m
         JOIN productos pr ON pr.id = m.producto_id
         JOIN sectores s ON s.id = m.sector
        WHERE m.tipo IN ('envio', 'salida_venta') AND m.dia >= ? AND m.dia <= ?
        GROUP BY m.dia, m.sector`,
      p.desde, p.hasta,
    ),
  ])

  const dias = new Map<string, DiaSerie>()
  for (let d = p.desde; d <= p.hasta; d = sumarDias(d, 1)) {
    dias.set(d, { dia: d, sectores: Object.fromEntries(SECTOR_IDS.map((s) => [s, vacias()])) as Record<SectorId, MedidasSerie> })
  }
  for (const f of produccion) {
    const m = dias.get(f.dia)?.sectores[f.sector]
    if (m) Object.assign(m, { cocinado: f.cocinado, guardado: f.guardado })
  }
  for (const f of movimientos) {
    const m = dias.get(f.dia)?.sectores[f.sector]
    if (m) Object.assign(m, { enviado: f.enviado, vendido: f.vendido })
  }
  return { desde: p.desde, hasta: p.hasta, dias: [...dias.values()] }
}
