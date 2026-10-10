// F01–F05: lecturas de máquinas (estado, temperatura, observación, mantenimiento y foto).
// Reemplaza la planilla de control de temperatura de equipos fríos (RE-TE.01: lectura al inicio y al fin
// de la jornada; en el buffet T° inicial e intermedia) y la de mantenimiento de equipos (RE-04.01).
import { Hono } from 'hono'
import type { EstadoMaquina, Lectura, Momento, SectorId, TipoMaquina } from '../../shared/tipos'
import { aDataUrl, desdeDataUrl, guardarArchivo, leerArchivo } from '../almacen'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, ValorSQL } from '../entorno'
import { invalido, noEncontrado, prohibido } from '../errores'
import { sectorPara } from '../sesion'
import { cuerpo, diaOpcional, opcion, texto, textoOpcional } from '../validar'

export const rutasMaquinas = new Hono<Entorno>()

const MOMENTOS: Momento[] = ['inicio', 'fin', 'inicial', 'intermedia', 'otro']
const ESTADOS: EstadoMaquina[] = ['funciona', 'con_fallas', 'fuera_de_servicio']

/** Foto ya achicada en el navegador: hasta 1,5 MB una vez decodificada. */
export const FOTO_MAXIMA_BYTES = 1.5 * 1024 * 1024
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** true si la temperatura queda afuera del rango; un lado del rango puede faltar (≤ −18 °C, ≥ 63 °C). F04. */
export function estaFueraDeRango(m: { tempMin: number | null; tempMax: number | null }, t: number | null): boolean {
  if (t === null) return false
  return (m.tempMin !== null && t < m.tempMin) || (m.tempMax !== null && t > m.tempMax)
}

// ---------- Lectura de la base ----------

interface FilaLectura {
  id: string
  maquina_id: string
  maquina_nombre: string
  maquina_numero: number
  sector: SectorId
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia: string
  momento: Momento
  estado: EstadoMaquina
  temperatura: number | null
  fuera_de_rango: number
  observacion: string
  mantenimiento: string | null
  mantenimiento_por: string | null
  foto_clave: string | null
}

const COLUMNAS = `SELECT l.id, l.maquina_id, m.nombre AS maquina_nombre, m.numero AS maquina_numero, m.sector,
    l.usuario_id, u.nombre AS usuario_nombre, l.fecha, l.dia, l.momento, l.estado, l.temperatura, l.fuera_de_rango,
    l.observacion, l.mantenimiento, l.mantenimiento_por, l.foto_clave
  FROM lecturas l JOIN maquinas m ON m.id = l.maquina_id JOIN usuarios u ON u.id = l.usuario_id`

const aLectura = (f: FilaLectura): Lectura => ({
  id: f.id,
  maquinaId: f.maquina_id,
  maquinaNombre: f.maquina_nombre,
  maquinaNumero: f.maquina_numero,
  sector: f.sector,
  usuarioId: f.usuario_id,
  usuarioNombre: f.usuario_nombre,
  fecha: f.fecha,
  dia: f.dia,
  momento: f.momento,
  estado: f.estado,
  temperatura: f.temperatura,
  fueraDeRango: !!f.fuera_de_rango,
  observacion: f.observacion,
  mantenimiento: f.mantenimiento,
  mantenimientoPor: f.mantenimiento_por,
  tieneFoto: !!f.foto_clave,
})

export interface FiltroLecturas {
  ids?: string[]
  sector?: SectorId | null
  maquina?: string | null
  desde?: string | null
  hasta?: string | null
  fueraDeRango?: boolean
  /** Con fallas o fuera de servicio. */
  conFallas?: boolean
  limite?: number
}

/** Lecturas con nombre de máquina y de usuario, la más nueva primero. También la usan los reportes (H02). */
export async function leerLecturas(db: BaseD1, filtro: FiltroLecturas = {}): Promise<Lectura[]> {
  if (filtro.ids) {
    if (!filtro.ids.length) return []
    const filas = await todasPorTrozos<FilaLectura>(db, filtro.ids, (m) => `${COLUMNAS} WHERE l.id IN (${m})`)
    return filas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(aLectura)
  }
  const partes: string[] = []
  const params: ValorSQL[] = []
  const si = (cond: unknown, sql: string, ...ps: ValorSQL[]) => {
    if (cond) {
      partes.push(sql)
      params.push(...ps)
    }
  }
  si(filtro.sector, 'm.sector = ?', filtro.sector ?? null)
  si(filtro.maquina, 'l.maquina_id = ?', filtro.maquina ?? null)
  si(filtro.desde, 'l.dia >= ?', filtro.desde ?? null)
  si(filtro.hasta, 'l.dia <= ?', filtro.hasta ?? null)
  si(filtro.fueraDeRango, 'l.fuera_de_rango = 1')
  si(filtro.conFallas, "l.estado IN ('con_fallas', 'fuera_de_servicio')")
  const where = partes.length ? `WHERE ${partes.join(' AND ')}` : ''
  const filas = await todas<FilaLectura>(
    db, `${COLUMNAS} ${where} ORDER BY l.fecha DESC, l.id LIMIT ?`, ...params, filtro.limite ?? 2000,
  )
  return filas.map(aLectura)
}

const siONo = (v: string | undefined) => v === '1' || v === 'true'

// ---------- Rutas ----------

rutasMaquinas.get('/lecturas', async (c) => {
  const q = c.req.query()
  const sector = sectorPara(c.get('usuario'), q.sector)
  return c.json<Lectura[]>(await leerLecturas(c.env.DB, {
    sector,
    maquina: q.maquina || null,
    desde: diaOpcional(q.desde, 'Desde'),
    hasta: diaOpcional(q.hasta, 'Hasta'),
    fueraDeRango: siONo(q.fueraDeRango),
    conFallas: siONo(q.conFallas),
  }))
})

interface FilaMaquina {
  id: string
  sector: SectorId
  nombre: string
  tipo: TipoMaquina
  temp_min: number | null
  temp_max: number | null
  activo: number
}

rutasMaquinas.post('/lecturas', async (c) => {
  const b = await cuerpo(c)
  const u = c.get('usuario')
  const db = c.env.DB

  const maquinaId = texto(b.maquinaId, 'la máquina', { max: 100 })
  const maquina = await una<FilaMaquina>(
    db, 'SELECT id, sector, nombre, tipo, temp_min, temp_max, activo FROM maquinas WHERE id = ?', maquinaId,
  )
  if (!maquina) throw noEncontrado('No se encontró esa máquina.')
  // Un operador solo carga máquinas de su sector (A03).
  sectorPara(u, maquina.sector, true)
  if (!maquina.activo) throw invalido('Esa máquina está dada de baja. Elegí otra.')

  const momento = opcion(b.momento, MOMENTOS, 'El momento de la lectura')
  const estado = opcion(b.estado, ESTADOS, 'El estado de la máquina')

  let temperatura: number | null = null
  if (b.temperatura !== undefined && b.temperatura !== null && b.temperatura !== '') {
    if (typeof b.temperatura !== 'number' || !Number.isFinite(b.temperatura)) throw invalido('La temperatura tiene que ser un número.')
    if (b.temperatura < -60 || b.temperatura > 300) throw invalido('Revisá la temperatura: tiene que estar entre −60 °C y 300 °C.')
    temperatura = Math.round(b.temperatura * 10) / 10
  }
  const rango = { tempMin: maquina.temp_min, tempMax: maquina.temp_max }
  const tieneRango = rango.tempMin !== null || rango.tempMax !== null
  // F02: en heladeras, freezers y exhibidoras la temperatura actual es obligatoria.
  if (tieneRango && temperatura === null && estado !== 'fuera_de_servicio') {
    throw invalido('Cargá la temperatura actual: en esta máquina es obligatoria.')
  }

  const observacion = textoOpcional(b.observacion, 'La observación', 500) ?? ''
  const mantenimiento = textoOpcional(b.mantenimiento, 'El mantenimiento', 500)
  const mantenimientoPor = textoOpcional(b.mantenimientoPor, 'Quién hizo el mantenimiento', 120)
  if (mantenimientoPor && !mantenimiento) throw invalido('Contá qué mantenimiento se hizo.')

  let foto: { datos: Uint8Array; tipo: string } | null = null
  if (b.foto !== undefined && b.foto !== null && b.foto !== '') {
    if (typeof b.foto !== 'string') throw invalido('La foto no es una imagen válida.')
    // base64 ocupa 4/3 de los bytes: el peso se calcula antes de decodificar.
    if (Math.floor(((b.foto.length - b.foto.indexOf(',') - 1) * 3) / 4) > FOTO_MAXIMA_BYTES + 2) {
      throw invalido('La foto es muy pesada. Sacala de nuevo o elegí otra.')
    }
    foto = desdeDataUrl(b.foto)
    if (!foto) throw invalido('La foto no es una imagen válida (JPEG, PNG o WEBP).')
    if (foto.datos.length > FOTO_MAXIMA_BYTES) throw invalido('La foto es muy pesada. Sacala de nuevo o elegí otra.')
  }

  const id = nuevoId()
  const { fecha, dia } = ahora()
  let fotoClave: string | null = null
  if (foto) {
    // Primero la foto: así una lectura nunca apunta a una foto que no está.
    fotoClave = `fotos/${id}.${EXTENSION[foto.tipo]}`
    await guardarArchivo(c.env, fotoClave, foto.datos, foto.tipo)
  }
  await sentencia(
    db,
    `INSERT INTO lecturas (id, maquina_id, usuario_id, fecha, dia, momento, estado, temperatura, fuera_de_rango,
       observacion, mantenimiento, mantenimiento_por, foto_clave)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, maquina.id, u.id, fecha, dia, momento, estado, temperatura, estaFueraDeRango(rango, temperatura),
    observacion, mantenimiento, mantenimiento ? mantenimientoPor : null, fotoClave,
  ).run()
  const [lectura] = await leerLecturas(db, { ids: [id] })
  return c.json<Lectura>(lectura)
})

rutasMaquinas.get('/lecturas/:id/foto', async (c) => {
  const fila = await una<{ foto_clave: string | null; sector: SectorId }>(
    c.env.DB,
    'SELECT l.foto_clave, m.sector FROM lecturas l JOIN maquinas m ON m.id = l.maquina_id WHERE l.id = ?',
    c.req.param('id'),
  )
  if (!fila) throw noEncontrado('No se encontró esa lectura.')
  const u = c.get('usuario')
  if (u.sector && u.sector !== fila.sector) throw prohibido('Solo podés ver y cargar datos de tu sector.')
  if (!fila.foto_clave) throw noEncontrado('Esta lectura no tiene foto.')
  const archivo = await leerArchivo(c.env, fila.foto_clave)
  if (!archivo) throw noEncontrado('No se encontró la foto.')
  return c.json({ dataUrl: aDataUrl(archivo.datos, archivo.tipo) })
})
