// C08, E10, G08: todos los avisos juntos, para el inicio de cada sector, el Resumen del administrador y el correo.
import { Hono } from 'hono'
import type { Alerta } from '../../shared/alertas'
import type { SectorId } from '../../shared/tipos'
import { alertasLotes } from '../alertasLotes'
import type { BaseD1, Entorno } from '../entorno'
import { sectorPara } from '../sesion'
import { alertasLimpieza } from './limpieza'
import { alertasStock } from './stock'

export const rutasAlertas = new Hono<Entorno>()

/** Avisos de un sector (o de todos con null). Los lotes de materia prima son de Chipería. */
export async function todasLasAlertas(db: BaseD1, sector: SectorId | null): Promise<Alerta[]> {
  const conLotes = sector === null || sector === 'chiperia'
  const [stock, lotes, limpieza] = await Promise.all([
    alertasStock(db, sector),
    conLotes ? alertasLotes(db) : Promise.resolve([]),
    alertasLimpieza(db, sector),
  ])
  return [...stock, ...lotes, ...limpieza]
}

rutasAlertas.get('/alertas', async (c) => {
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'))
  return c.json<Alerta[]>(await todasLasAlertas(c.env.DB, sector))
})
