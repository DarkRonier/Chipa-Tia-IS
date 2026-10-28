// H01–H04: reporte del administrador por rango de fechas y sector, y envío del resumen por correo.
// El Excel (H03) se arma en el navegador a partir de este mismo reporte.
import { Hono } from 'hono'
import { diaPY } from '../../shared/hora'
import type { PeriodoResumen, Reporte, ResumenCorreo, SerieReporte } from '../../shared/tipos'
import { enviarResumen } from '../correo'
import type { Entorno } from '../entorno'
import { invalido } from '../errores'
import { armarReporte } from '../reporte'
import { armarSerie } from '../serie'
import { sectorPara, soloAdmin } from '../sesion'
import { cuerpo, diaOpcional, opcion } from '../validar'

export const rutasReportes = new Hono<Entorno>()

const PERIODOS: PeriodoResumen[] = ['hoy', 'diario', 'semanal', 'mensual']
/** Hasta unos tres años por pedido: alcanza para comparar dos años completos (I04: 24 meses). */
const MAX_DIAS = 1100

const diasEntre = (desde: string, hasta: string) => (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000

/** Rango de `desde`/`hasta` de la consulta (sin fechas, hoy; con solo `desde`, ese día), ya validado. */
function rangoPedido(q: Record<string, string>): { desde: string; hasta: string } {
  const hoy = diaPY()
  const desde = diaOpcional(q.desde, 'Desde') ?? hoy
  const hasta = diaOpcional(q.hasta, 'Hasta') ?? (q.desde ? desde : hoy)
  if (desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  if (diasEntre(desde, hasta) > MAX_DIAS) throw invalido('Elegí un período de hasta tres años.')
  return { desde, hasta }
}

rutasReportes.get('/reportes', soloAdmin, async (c) => {
  const q = c.req.query()
  const { desde, hasta } = rangoPedido(q)
  const sector = sectorPara(c.get('usuario'), q.sector)
  return c.json<Reporte>(await armarReporte(c.env.DB, { desde, hasta, sector }))
})

// Serie por día y sector para los gráficos del Resumen.
rutasReportes.get('/reportes/serie', soloAdmin, async (c) => {
  return c.json<SerieReporte>(await armarSerie(c.env.DB, rangoPedido(c.req.query())))
})

rutasReportes.post('/reportes/enviar', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const periodo = b.periodo === undefined ? 'diario' : opcion(b.periodo, PERIODOS, 'El período del resumen')
  return c.json<ResumenCorreo>(await enviarResumen(c.env, periodo, diaPY()))
})
