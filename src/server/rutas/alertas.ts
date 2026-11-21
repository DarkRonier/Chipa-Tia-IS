// E10, G08, incidencias de máquinas y vencimientos de compras (M10): todos los avisos juntos, para el inicio de cada sector, el Resumen del
// administrador y del supervisor, y el correo. Cada uno ve solo los avisos de lo que tiene permiso de ver.
import { Hono } from 'hono'
import type { Alerta } from '../../shared/alertas'
import { puede, type Permiso } from '../../shared/permisos'
import type { Rol, SectorId } from '../../shared/tipos'
import { alertasLotes } from '../alertasLotes'
import type { BaseD1, Entorno } from '../entorno'
import { sectorPara } from '../sesion'
import { alertasCaja } from './caja'
import { alertasCompras } from './compras'
import { alertasGastosFijos } from './finanzas'
import { alertasIncidencias } from './incidencias'
import { alertasLimpieza } from './limpieza'

export const rutasAlertas = new Hono<Entorno>()

/**
 * Avisos de un sector (o de todos con null). Los lotes de materia prima son de Chipería. Con `rol`, solo los de lo
 * que ese rol puede ver (el correo diario no lo pasa: va al administrador, que ve todo).
 */
export async function todasLasAlertas(db: BaseD1, sector: SectorId | null, rol: Rol = 'admin'): Promise<Alerta[]> {
  const ve = (p: Permiso) => puede(rol, p)
  const nada = Promise.resolve<Alerta[]>([])
  const conLotes = (sector === null || sector === 'chiperia') && ve('lotes.ver')
  const [caja, fijos, compras, lotes, limpieza, incidencias] = await Promise.all([
    ve('caja.operar') ? alertasCaja(db, rol) : nada,
    ve('ie.completo') ? alertasGastosFijos(db) : nada,
    ve('compras.pagar') ? alertasCompras(db) : nada,
    conLotes ? alertasLotes(db) : nada,
    ve('limpieza.ver') ? alertasLimpieza(db, sector) : nada,
    ve('maquinas.ver') ? alertasIncidencias(db, sector) : nada,
  ])
  return [...caja, ...fijos, ...compras, ...incidencias, ...lotes, ...limpieza]
}

rutasAlertas.get('/alertas', async (c) => {
  const u = c.get('usuario')
  const sector = sectorPara(u, c.req.query('sector'))
  return c.json<Alerta[]>(await todasLasAlertas(c.env.DB, sector, u.rol))
})
