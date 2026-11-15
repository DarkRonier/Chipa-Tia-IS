// Fallas e incidencias de máquinas. El supervisor (y el administrador) recorre los sectores y reporta lo que ve
// en una máquina: no carga estado ni temperatura, que siguen siendo las lecturas del sector (F01–F05).
// Cada incidencia queda abierta, como aviso, hasta que el supervisor o el administrador la marca como resuelta.
// Los sectores ven las de sus máquinas.
import { Hono } from 'hono'
import type { Alerta } from '../../shared/alertas'
import { NOMBRE_TIPO_INCIDENCIA, type Incidencia, type SectorId, type TipoIncidencia } from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, nuevoId, sentencia, todas, una } from '../db'
import type { BaseD1, Entorno, ValorSQL } from '../entorno'
import { conflicto, invalido, noEncontrado, prohibido } from '../errores'
import { requiere, sectorPara } from '../sesion'
import { cuerpo, diaOpcional, opcion, texto, textoOpcional } from '../validar'

export const rutasIncidencias = new Hono<Entorno>()

const TIPOS: TipoIncidencia[] = ['falla', 'incidencia']
const SOLO_SUPERVISOR = 'Las fallas e incidencias las reportan el supervisor o el administrador.'

interface FilaIncidencia {
  id: string
  maquina_id: string
  maquina_nombre: string
  maquina_numero: number
  sector: SectorId
  tipo: TipoIncidencia
  descripcion: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia: string
  resuelta_en: string | null
  resuelta_por: string | null
  resuelta_por_nombre: string | null
  resolucion: string | null
}

const COLUMNAS = `SELECT i.id, i.maquina_id, m.nombre AS maquina_nombre, m.numero AS maquina_numero, m.sector, i.tipo,
    i.descripcion, i.usuario_id, u.nombre AS usuario_nombre, i.fecha, i.dia, i.resuelta_en, i.resuelta_por,
    r.nombre AS resuelta_por_nombre, i.resolucion
  FROM incidencias i
  JOIN maquinas m ON m.id = i.maquina_id
  JOIN usuarios u ON u.id = i.usuario_id
  LEFT JOIN usuarios r ON r.id = i.resuelta_por`

const aIncidencia = (f: FilaIncidencia): Incidencia => ({
  id: f.id,
  maquinaId: f.maquina_id,
  maquinaNombre: f.maquina_nombre,
  maquinaNumero: f.maquina_numero,
  sector: f.sector,
  tipo: f.tipo,
  descripcion: f.descripcion,
  usuarioId: f.usuario_id,
  usuarioNombre: f.usuario_nombre,
  fecha: f.fecha,
  dia: f.dia,
  resueltaEn: f.resuelta_en,
  resueltaPor: f.resuelta_por,
  resueltaPorNombre: f.resuelta_por_nombre,
  resolucion: f.resolucion,
})

export interface FiltroIncidencias {
  id?: string
  sector?: SectorId | null
  maquina?: string | null
  desde?: string | null
  hasta?: string | null
  soloAbiertas?: boolean
}

/** Incidencias con nombre de máquina y de quién las reportó, la más nueva primero. */
export async function leerIncidencias(db: BaseD1, filtro: FiltroIncidencias = {}): Promise<Incidencia[]> {
  const partes: string[] = []
  const params: ValorSQL[] = []
  const si = (cond: unknown, sql: string, ...ps: ValorSQL[]) => {
    if (cond) {
      partes.push(sql)
      params.push(...ps)
    }
  }
  si(filtro.id, 'i.id = ?', filtro.id ?? null)
  si(filtro.sector, 'm.sector = ?', filtro.sector ?? null)
  si(filtro.maquina, 'i.maquina_id = ?', filtro.maquina ?? null)
  si(filtro.desde, 'i.dia >= ?', filtro.desde ?? null)
  si(filtro.hasta, 'i.dia <= ?', filtro.hasta ?? null)
  si(filtro.soloAbiertas, 'i.resuelta_en IS NULL')
  const where = partes.length ? `WHERE ${partes.join(' AND ')}` : ''
  const filas = await todas<FilaIncidencia>(db, `${COLUMNAS} ${where} ORDER BY i.fecha DESC, i.id LIMIT 2000`, ...params)
  return filas.map(aIncidencia)
}

/** Un aviso por cada incidencia abierta del sector (o de todos con null). */
export async function alertasIncidencias(db: BaseD1, sector: SectorId | null): Promise<Alerta[]> {
  const abiertas = await leerIncidencias(db, { sector, soloAbiertas: true })
  return abiertas.map((i) => ({
    tipo: 'incidencia_maquina' as const,
    sector: i.sector,
    texto: `${NOMBRE_TIPO_INCIDENCIA[i.tipo]} en N° ${i.maquinaNumero} · ${i.maquinaNombre}: ${i.descripcion}`,
    enlace: `/maquinas?maquina=${i.maquinaId}`,
  }))
}

rutasIncidencias.get('/incidencias', requiere('maquinas.ver'), async (c) => {
  const q = c.req.query()
  const sector = sectorPara(c.get('usuario'), q.sector)
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  if (q.maquina && q.maquina.length > 100) throw invalido('La máquina no es válida.')
  return c.json<Incidencia[]>(await leerIncidencias(c.env.DB, {
    sector,
    maquina: q.maquina || null,
    desde,
    hasta,
    soloAbiertas: q.abiertas === '1' || q.abiertas === 'true',
  }))
})

rutasIncidencias.post('/incidencias', requiere('maquinas.incidencia', SOLO_SUPERVISOR), async (c) => {
  const b = await cuerpo(c)
  const u = c.get('usuario')
  const db = c.env.DB
  const maquinaId = texto(b.maquinaId, 'la máquina', { max: 100 })
  const maquina = await una<{ id: string; sector: SectorId; activo: number }>(
    db, 'SELECT id, sector, activo FROM maquinas WHERE id = ?', maquinaId,
  )
  if (!maquina) throw noEncontrado('No se encontró esa máquina.')
  if (!maquina.activo) throw invalido('Esa máquina está dada de baja. Elegí otra.')
  const tipo = opcion(b.tipo, TIPOS, 'El tipo (falla o incidencia)')
  const descripcion = texto(b.descripcion, 'qué pasó', { max: 500 })

  const id = nuevoId()
  const { fecha, dia } = ahora()
  await db.batch([
    sentencia(
      db,
      'INSERT INTO incidencias (id, maquina_id, usuario_id, fecha, dia, tipo, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, maquina.id, u.id, fecha, dia, tipo, descripcion,
    ),
    sentenciaAuditoria(db, { tabla: 'incidencias', registroId: id, accion: 'crear', usuarioId: u.id, despues: { maquinaId, tipo, descripcion } }),
  ])
  const [nueva] = await leerIncidencias(db, { id })
  return c.json<Incidencia>(nueva)
})

/** Marca una incidencia como resuelta, con una nota opcional de qué se hizo. */
rutasIncidencias.post('/incidencias/:id/resolver', requiere('maquinas.incidencia', SOLO_SUPERVISOR), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c).catch(() => ({} as Record<string, unknown>))
  const [antes] = await leerIncidencias(db, { id: c.req.param('id') })
  if (!antes) throw noEncontrado('No se encontró esa incidencia.')
  if (u.sector && u.sector !== antes.sector) throw prohibido('Solo podés ver y cargar datos de tu sector.')
  if (antes.resueltaEn) throw conflicto('ya_resuelta', `Esta incidencia ya la resolvió ${antes.resueltaPorNombre ?? 'otra persona'}.`)
  const resolucion = textoOpcional(b.resolucion, 'Qué se hizo', 500)
  const { fecha } = ahora()
  const [r] = await db.batch([
    sentencia(
      db, 'UPDATE incidencias SET resuelta_por = ?, resuelta_en = ?, resolucion = ? WHERE id = ? AND resuelta_en IS NULL',
      u.id, fecha, resolucion, antes.id,
    ),
    sentenciaAuditoria(db, {
      tabla: 'incidencias', registroId: antes.id, accion: 'resolver', usuarioId: u.id,
      antes: { resueltaEn: null }, despues: { resueltaPor: u.id, resueltaEn: fecha, resolucion },
    }),
  ])
  if (r.meta.changes === 0) throw conflicto('ya_resuelta', 'Esta incidencia ya la resolvió otra persona.')
  const [despues] = await leerIncidencias(db, { id: antes.id })
  return c.json<Incidencia>(despues)
})
