// G01–G03: reportes de limpieza y desinfección, como las planillas RE-09.01 a RE-09.09.
// Cada reporte marca TODAS las tareas activas del área: X (diaria), XX (profunda) o - (no se hizo),
// sin cuadros en blanco. El administrador firma el "Controlado por".
import { Hono } from 'hono'
import type { Limpieza, Marca, SectorId } from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, ValorSQL } from '../entorno'
import { conflicto, invalido, noEncontrado, prohibido } from '../errores'
import { esSector, sectorPara, soloAdmin } from '../sesion'
import { cuerpo, diaOpcional, lista, texto, textoOpcional } from '../validar'

export const rutasLimpieza = new Hono<Entorno>()

const MARCAS: Marca[] = ['X', 'XX', '-']

// ---------- Lectura de la base ----------

interface FilaLimpieza {
  id: string
  area_id: string
  area_nombre: string
  sector: SectorId
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia: string
  comentario: string
  controlado_por: string | null
  controlado_por_nombre: string | null
  controlado_en: string | null
}

const COLUMNAS = `SELECT l.id, l.area_id, a.nombre AS area_nombre, l.sector, l.usuario_id, u.nombre AS usuario_nombre,
    l.fecha, l.dia, l.comentario, l.controlado_por, c.nombre AS controlado_por_nombre, l.controlado_en
  FROM limpiezas l
  JOIN areas_limpieza a ON a.id = l.area_id
  JOIN usuarios u ON u.id = l.usuario_id
  LEFT JOIN usuarios c ON c.id = l.controlado_por`

export interface FiltroLimpiezas {
  ids?: string[]
  sector?: SectorId | null
  area?: string | null
  desde?: string | null
  hasta?: string | null
  sinControlar?: boolean
  limite?: number
}

/** Limpiezas con sus marcas en el orden de la planilla, la más nueva primero. También la usan los reportes (H02). */
export async function leerLimpiezas(db: BaseD1, filtro: FiltroLimpiezas = {}): Promise<Limpieza[]> {
  let filas: FilaLimpieza[]
  if (filtro.ids) {
    if (!filtro.ids.length) return []
    filas = await todasPorTrozos<FilaLimpieza>(db, filtro.ids, (m) => `${COLUMNAS} WHERE l.id IN (${m})`)
    filas.sort((a, b) => b.fecha.localeCompare(a.fecha))
  } else {
    const partes: string[] = []
    const params: ValorSQL[] = []
    const si = (cond: unknown, sql: string, ...ps: ValorSQL[]) => {
      if (cond) {
        partes.push(sql)
        params.push(...ps)
      }
    }
    si(filtro.sector, 'l.sector = ?', filtro.sector ?? null)
    si(filtro.area, 'l.area_id = ?', filtro.area ?? null)
    si(filtro.desde, 'l.dia >= ?', filtro.desde ?? null)
    si(filtro.hasta, 'l.dia <= ?', filtro.hasta ?? null)
    si(filtro.sinControlar, 'l.controlado_por IS NULL')
    const where = partes.length ? `WHERE ${partes.join(' AND ')}` : ''
    filas = await todas<FilaLimpieza>(db, `${COLUMNAS} ${where} ORDER BY l.fecha DESC, l.id LIMIT ?`, ...params, filtro.limite ?? 1000)
  }
  if (!filas.length) return []
  const marcas = await todasPorTrozos<{ limpieza_id: string; tarea_id: string; nombre: string; marca: Marca; numero: string | null }>(
    db, filas.map((f) => f.id),
    (m) => `SELECT lm.limpieza_id, lm.tarea_id, t.nombre, lm.marca, lm.numero
              FROM limpieza_marcas lm JOIN tareas_limpieza t ON t.id = lm.tarea_id
             WHERE lm.limpieza_id IN (${m}) ORDER BY t.orden, t.nombre`,
  )
  return filas.map((f) => ({
    id: f.id,
    areaId: f.area_id,
    areaNombre: f.area_nombre,
    sector: f.sector,
    usuarioId: f.usuario_id,
    usuarioNombre: f.usuario_nombre,
    fecha: f.fecha,
    dia: f.dia,
    comentario: f.comentario,
    marcas: marcas.filter((m) => m.limpieza_id === f.id).map((m) => ({
      tareaId: m.tarea_id, tareaNombre: m.nombre, marca: m.marca, numero: m.numero,
    })),
    controladoPor: f.controlado_por,
    controladoPorNombre: f.controlado_por_nombre,
    controladoEn: f.controlado_en,
  }))
}

/** "Techo, Piso y Puerta"; con muchas, las tres primeras y "y 5 más". */
function enumerar(nombres: string[]): string {
  const vistos = nombres.slice(0, 3)
  const resto = nombres.length - vistos.length
  if (resto > 0) return `${vistos.join(', ')} y ${resto} más`
  return vistos.length > 1 ? `${vistos.slice(0, -1).join(', ')} y ${vistos[vistos.length - 1]}` : vistos[0]
}

// ---------- Rutas ----------

rutasLimpieza.get('/limpiezas', async (c) => {
  const q = c.req.query()
  const sector = sectorPara(c.get('usuario'), q.sector)
  return c.json<Limpieza[]>(await leerLimpiezas(c.env.DB, {
    sector,
    area: q.area || null,
    desde: diaOpcional(q.desde, 'Desde'),
    hasta: diaOpcional(q.hasta, 'Hasta'),
    sinControlar: q.sinControlar === '1' || q.sinControlar === 'true',
  }))
})

rutasLimpieza.post('/limpiezas', async (c) => {
  const b = await cuerpo(c)
  const u = c.get('usuario')
  const db = c.env.DB

  const areaId = texto(b.areaId, 'el área', { max: 100 })
  const area = await una<{ id: string; nombre: string; activo: number }>(
    db, 'SELECT id, nombre, activo FROM areas_limpieza WHERE id = ?', areaId,
  )
  if (!area) throw noEncontrado('No se encontró esa área de limpieza.')
  const sectoresArea = (await todas<{ sector: SectorId }>(db, 'SELECT sector FROM areas_sectores WHERE area_id = ?', area.id))
    .map((s) => s.sector)

  // Sector del reporte: el del operador; el administrador lo indica si el área la cargan varios sectores.
  let sector: SectorId
  if (u.sector) {
    sector = sectorPara(u, b.sector, true)
    if (!sectoresArea.includes(sector)) throw prohibido('Esa área no es de tu sector.')
  } else if (b.sector !== undefined && b.sector !== null && b.sector !== '') {
    if (!esSector(b.sector)) throw invalido('Sector desconocido.')
    if (!sectoresArea.includes(b.sector)) throw invalido('Esa área no la carga ese sector.')
    sector = b.sector
  } else if (sectoresArea.length === 1) {
    sector = sectoresArea[0]
  } else {
    throw invalido('Indicá el sector: esta área la cargan varios sectores.')
  }
  if (!area.activo) throw invalido('Esa área está dada de baja. Elegí otra.')

  const tareas = await todas<{ id: string; nombre: string; pide_numero: number }>(
    db, 'SELECT id, nombre, pide_numero FROM tareas_limpieza WHERE area_id = ? AND activo = 1 ORDER BY orden, nombre', area.id,
  )
  if (!tareas.length) throw invalido('Esta área no tiene tareas para marcar.')

  const pedidas = lista<Record<string, unknown>>(b.marcas, 'marcar las tareas', { min: 1, max: 300 })
  const marcas = new Map<string, { marca: Marca; numero: string | null }>()
  for (const p of pedidas) {
    if (!p || typeof p !== 'object') throw invalido('Las marcas no son válidas.')
    const tarea = tareas.find((t) => t.id === p.tareaId)
    if (!tarea) throw invalido('Hay una tarea que no es de esta área o ya no está activa. Volvé a abrir la lista.')
    if (marcas.has(tarea.id)) throw invalido(`«${tarea.nombre}» está marcada dos veces.`)
    if (typeof p.marca !== 'string' || !(MARCAS as string[]).includes(p.marca)) {
      throw invalido(`Elegí X, XX o - para «${tarea.nombre}».`)
    }
    const marca = p.marca as Marca
    const numero = textoOpcional(p.numero, `El N° de equipo de «${tarea.nombre}»`, 30)
    if (numero && !tarea.pide_numero) throw invalido(`«${tarea.nombre}» no lleva N° de equipo.`)
    // "No se hizo" no lleva número de equipo.
    marcas.set(tarea.id, { marca, numero: marca === '-' ? null : numero })
  }
  // Como en la planilla en papel: no se dejan cuadros en blanco.
  const faltan = tareas.filter((t) => !marcas.has(t.id))
  if (faltan.length) {
    throw invalido(
      faltan.length === 1
        ? `Falta marcar «${faltan[0].nombre}» (X, XX o -).`
        : `Faltan marcar ${faltan.length} tareas: ${enumerar(faltan.map((t) => t.nombre))}.`,
    )
  }
  const comentario = textoOpcional(b.comentario, 'El comentario', 500) ?? ''

  const id = nuevoId()
  const { fecha, dia } = ahora()
  await db.batch([
    sentencia(
      db,
      'INSERT INTO limpiezas (id, area_id, sector, usuario_id, fecha, dia, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, area.id, sector, u.id, fecha, dia, comentario,
    ),
    ...tareas.map((t) => {
      const m = marcas.get(t.id)!
      return sentencia(
        db, 'INSERT INTO limpieza_marcas (limpieza_id, tarea_id, marca, numero) VALUES (?, ?, ?, ?)', id, t.id, m.marca, m.numero,
      )
    }),
  ])
  const [limpieza] = await leerLimpiezas(db, { ids: [id] })
  return c.json<Limpieza>(limpieza)
})

/** "Controlado por" de la planilla: el administrador da el visto bueno a un reporte. */
rutasLimpieza.post('/limpiezas/:id/control', soloAdmin, async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const [antes] = await leerLimpiezas(db, { ids: [c.req.param('id')] })
  if (!antes) throw noEncontrado('No se encontró esa limpieza.')
  if (antes.controladoPor) {
    throw conflicto('ya_controlada', `Esta limpieza ya la controló ${antes.controladoPorNombre ?? 'otra persona'}.`)
  }
  const { fecha } = ahora()
  const [r] = await db.batch([
    sentencia(db, 'UPDATE limpiezas SET controlado_por = ?, controlado_en = ? WHERE id = ? AND controlado_por IS NULL', u.id, fecha, antes.id),
    sentenciaAuditoria(db, {
      tabla: 'limpiezas', registroId: antes.id, accion: 'controlar', usuarioId: u.id,
      antes: { controladoPor: null, controladoEn: null },
      despues: { controladoPor: u.id, controladoEn: fecha },
    }),
  ])
  if (r.meta.changes === 0) throw conflicto('ya_controlada', 'Esta limpieza ya la controló otra persona.')
  const [despues] = await leerLimpiezas(db, { ids: [antes.id] })
  return c.json<Limpieza>(despues)
})
