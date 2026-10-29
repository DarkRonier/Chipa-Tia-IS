// B01–B05: sectores, productos, máquinas, áreas y tareas de limpieza, sucursales.
// Lectura para cualquiera con sesión (el operador solo ve lo activo de su sector; las sucursales son de todos).
// Escritura solo del administrador, con una fila de auditoría por cambio. Nada se borra: se desactiva.
import { Hono, type Context } from 'hono'
import type {
  AreaLimpieza, Maquina, Producto, Sector, SectorId, Sucursal, TareaLimpieza, TipoMaquina,
} from '../../shared/tipos'
import { NOMBRE_TIPO_MAQUINA, SECTOR_IDS } from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1, ValorSQL } from '../entorno'
import { conflicto, invalido, noEncontrado } from '../errores'
import { esSector, sectorPara, soloAdmin } from '../sesion'
import { booleano, cuerpo, entero, texto, textoOpcional } from '../validar'

export const rutasCatalogos = new Hono<Entorno>()

// ---------- Ayudas ----------

/** `todos=1` (incluir desactivados) solo vale para el administrador; el operador ve lo activo. */
const verTodos = (c: Context<Entorno>) => c.get('usuario').rol === 'admin' && ['1', 'true'].includes(c.req.query('todos') ?? '')

/** Lanza 400 si el cuerpo de un PATCH no trae ninguno de los campos editables. */
function algoParaCambiar(b: Record<string, unknown>, campos: string[]) {
  if (!campos.some((k) => b[k] !== undefined)) throw invalido('No hay nada para cambiar.')
}

const accionDe = (antes: boolean, despues: boolean) =>
  antes && !despues ? 'desactivar' : !antes && despues ? 'activar' : 'editar'

const igualNombre = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0

/**
 * 409 si otro registro de la lista ya usa ese nombre (sin distinguir mayúsculas ni tildes).
 * `que` = "un producto", "una sucursal"…; `donde` = " en Cocina", "".
 */
function sinRepetir(existentes: { id: string; nombre: string; activo: number }[], nombre: string, propio: string | null, que: string, donde = '') {
  const otro = existentes.find((e) => e.id !== propio && igualNombre(e.nombre, nombre))
  if (!otro) return
  throw conflicto(
    'nombre_repetido',
    otro.activo
      ? `Ya hay ${que} «${otro.nombre}»${donde}.`
      : `Ya hay ${que} «${otro.nombre}»${donde}, desactivado. Activalo en vez de crear otro.`,
  )
}

async function nombreSector(db: BaseD1, id: SectorId): Promise<string> {
  return (await una<{ nombre: string }>(db, 'SELECT nombre FROM sectores WHERE id = ?', id))?.nombre ?? id
}

/** Arma "WHERE a AND b" con sus parámetros. */
function donde(partes: [boolean, string, ...ValorSQL[]][]): { where: string; params: ValorSQL[] } {
  const usadas = partes.filter(([si]) => si)
  return {
    where: usadas.length ? `WHERE ${usadas.map(([, sql]) => sql).join(' AND ')}` : '',
    params: usadas.flatMap(([, , ...ps]) => ps),
  }
}

// ---------- Sectores ----------

interface FilaSector { id: SectorId; nombre: string; con_lotes: number }
const aSector = (f: FilaSector): Sector => ({ id: f.id, nombre: f.nombre, conLotes: !!f.con_lotes })

rutasCatalogos.get('/sectores', async (c) => {
  const filas = await todas<FilaSector>(c.env.DB, 'SELECT id, nombre, con_lotes FROM sectores ORDER BY orden')
  return c.json<Sector[]>(filas.map(aSector))
})

rutasCatalogos.patch('/sectores/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const fila = await una<FilaSector>(db, 'SELECT id, nombre, con_lotes FROM sectores WHERE id = ?', c.req.param('id'))
  if (!fila) throw noEncontrado('No se encontró ese sector.')
  const nombre = texto(b.nombre, 'el nombre', { max: 40 })
  const otros = await todas<{ id: string; nombre: string; activo: number }>(db, 'SELECT id, nombre, 1 AS activo FROM sectores')
  sinRepetir(otros, nombre, fila.id, 'un sector')
  const antes = aSector(fila)
  const despues: Sector = { ...antes, nombre }
  await db.batch([
    sentencia(db, 'UPDATE sectores SET nombre = ? WHERE id = ?', nombre, fila.id),
    sentenciaAuditoria(db, { tabla: 'sectores', registroId: fila.id, accion: 'editar', usuarioId: c.get('usuario').id, antes, despues }),
  ])
  return c.json<Sector>(despues)
})

// ---------- Productos (B01) ----------

interface FilaProducto { id: string; sector: SectorId; nombre: string; unidad: string; activo: number; stock_minimo: number | null }
const aProducto = (f: FilaProducto): Producto => ({
  id: f.id, sector: f.sector, nombre: f.nombre, unidad: f.unidad, activo: !!f.activo, stockMinimo: f.stock_minimo,
})
const COLUMNAS_PRODUCTO = 'p.id, p.sector, p.nombre, p.unidad, p.activo, p.stock_minimo'

/** Stock mínimo (C08): entero ≥ 0, o vacío / null para quitarlo. Acepta número o texto con el número. */
function stockMinimoOpcional(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
  return entero(n, 'El stock mínimo')
}

async function leerProducto(db: BaseD1, id: string): Promise<FilaProducto> {
  const f = await una<FilaProducto>(db, `SELECT ${COLUMNAS_PRODUCTO} FROM productos p WHERE p.id = ?`, id)
  if (!f) throw noEncontrado('No se encontró ese producto.')
  return f
}

async function productoSinRepetir(db: BaseD1, sector: SectorId, nombre: string, propio: string | null) {
  const existentes = await todas<FilaProducto>(db, `SELECT ${COLUMNAS_PRODUCTO} FROM productos p WHERE p.sector = ?`, sector)
  sinRepetir(existentes, nombre, propio, 'un producto', ` en ${await nombreSector(db, sector)}`)
}

rutasCatalogos.get('/productos', async (c) => {
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'))
  const w = donde([[sector !== null, 'p.sector = ?', sector], [!verTodos(c), 'p.activo = 1']])
  const filas = await todas<FilaProducto>(
    c.env.DB,
    `SELECT ${COLUMNAS_PRODUCTO} FROM productos p JOIN sectores s ON s.id = p.sector ${w.where}
      ORDER BY s.orden, p.orden, p.nombre`,
    ...w.params,
  )
  return c.json<Producto[]>(filas.map(aProducto))
})

rutasCatalogos.post('/productos', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const sector = sectorPara(c.get('usuario'), b.sector, true)
  const nombre = texto(b.nombre, 'el nombre del producto', { max: 100 })
  const unidad = textoOpcional(b.unidad, 'La unidad', 30) ?? 'unidades'
  await productoSinRepetir(db, sector, nombre, null)
  const stockMinimo = stockMinimoOpcional(b.stockMinimo)
  const nuevo: Producto = { id: nuevoId(), sector, nombre, unidad, activo: true, stockMinimo }
  await db.batch([
    sentencia(
      db,
      `INSERT INTO productos (id, sector, nombre, unidad, activo, stock_minimo, orden)
       VALUES (?, ?, ?, ?, 1, ?, (SELECT COALESCE(MAX(orden), -1) + 1 FROM productos WHERE sector = ?))`,
      nuevo.id, sector, nombre, unidad, stockMinimo, sector,
    ),
    sentenciaAuditoria(db, { tabla: 'productos', registroId: nuevo.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nuevo }),
  ])
  return c.json<Producto>(nuevo)
})

rutasCatalogos.patch('/productos/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  algoParaCambiar(b, ['nombre', 'unidad', 'activo', 'stockMinimo'])
  const antes = aProducto(await leerProducto(db, c.req.param('id')))
  const despues: Producto = { ...antes }
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre del producto', { max: 100 })
  if (b.unidad !== undefined) despues.unidad = texto(b.unidad, 'la unidad', { max: 30 })
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  if (b.stockMinimo !== undefined) despues.stockMinimo = stockMinimoOpcional(b.stockMinimo)
  if (despues.nombre !== antes.nombre) await productoSinRepetir(db, antes.sector, despues.nombre, antes.id)
  await db.batch([
    sentencia(db, 'UPDATE productos SET nombre = ?, unidad = ?, activo = ?, stock_minimo = ? WHERE id = ?',
      despues.nombre, despues.unidad, despues.activo, despues.stockMinimo, antes.id),
    sentenciaAuditoria(db, {
      tabla: 'productos', registroId: antes.id, accion: accionDe(antes.activo, despues.activo), usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<Producto>(despues)
})

// ---------- Máquinas (B02) ----------

const TIPOS_MAQUINA = Object.keys(NOMBRE_TIPO_MAQUINA) as TipoMaquina[]

interface FilaMaquina {
  id: string
  sector: SectorId
  numero: number
  nombre: string
  tipo: TipoMaquina
  temp_min: number | null
  temp_max: number | null
  activo: number
}
const aMaquina = (f: FilaMaquina): Maquina => ({
  id: f.id, sector: f.sector, numero: f.numero, nombre: f.nombre, tipo: f.tipo,
  tempMin: f.temp_min, tempMax: f.temp_max, activo: !!f.activo,
})
const COLUMNAS_MAQUINA = 'm.id, m.sector, m.numero, m.nombre, m.tipo, m.temp_min, m.temp_max, m.activo'

function tipoMaquina(v: unknown): TipoMaquina {
  if (typeof v !== 'string' || !(TIPOS_MAQUINA as string[]).includes(v)) throw invalido('Elegí el tipo de máquina.')
  return v as TipoMaquina
}

function temperatura(v: unknown, campo: string): number | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalido(`${campo} tiene que ser un número.`)
  if (v < -60 || v > 300) throw invalido(`${campo} tiene que estar entre -60 °C y 300 °C.`)
  return Math.round(v * 10) / 10
}

/**
 * Rango aceptable según el tipo. "Otra" no controla temperatura (sin rango). El resto necesita al menos un
 * límite: un lado puede quedar vacío (freezer ≤ −18 °C: sin mínima; bufetera caliente ≥ 63 °C: sin máxima).
 */
function rango(tipo: TipoMaquina, min: unknown, max: unknown): { tempMin: number | null; tempMax: number | null } {
  if (tipo === 'otra') return { tempMin: null, tempMax: null }
  const tempMin = temperatura(min, 'La temperatura mínima')
  const tempMax = temperatura(max, 'La temperatura máxima')
  if (tempMin === null && tempMax === null) {
    throw invalido('Indicá la temperatura mínima, la máxima o las dos. Si la máquina no controla temperatura, elegí el tipo «Otra».')
  }
  if (tempMin !== null && tempMax !== null && tempMin > tempMax) throw invalido('La temperatura mínima no puede ser mayor que la máxima.')
  return { tempMin, tempMax }
}

const numeroMaquina = (v: unknown) => entero(v, 'El N° de máquina', { min: 1, max: 999 })

async function leerMaquina(db: BaseD1, id: string): Promise<FilaMaquina> {
  const f = await una<FilaMaquina>(db, `SELECT ${COLUMNAS_MAQUINA} FROM maquinas m WHERE m.id = ?`, id)
  if (!f) throw noEncontrado('No se encontró esa máquina.')
  return f
}

/** Dos máquinas activas del mismo sector no pueden tener el mismo número (las planillas las nombran por N°). */
async function numeroLibre(db: BaseD1, sector: SectorId, numero: number, propio: string | null) {
  const otra = await una<{ nombre: string }>(
    db, 'SELECT nombre FROM maquinas WHERE sector = ? AND numero = ? AND activo = 1 AND id <> ?', sector, numero, propio ?? '',
  )
  if (otra) {
    throw conflicto('numero_repetido', `Ya hay una máquina con el N° ${numero} en ${await nombreSector(db, sector)} (${otra.nombre}). Usá otro número.`)
  }
}

rutasCatalogos.get('/maquinas', async (c) => {
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'))
  const w = donde([[sector !== null, 'm.sector = ?', sector], [!verTodos(c), 'm.activo = 1']])
  const filas = await todas<FilaMaquina>(
    c.env.DB,
    `SELECT ${COLUMNAS_MAQUINA} FROM maquinas m JOIN sectores s ON s.id = m.sector ${w.where}
      ORDER BY s.orden, m.numero, m.nombre`,
    ...w.params,
  )
  return c.json<Maquina[]>(filas.map(aMaquina))
})

rutasCatalogos.post('/maquinas', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const sector = sectorPara(c.get('usuario'), b.sector, true)
  const nombre = texto(b.nombre, 'el nombre de la máquina', { max: 80 })
  const tipo = tipoMaquina(b.tipo)
  const r = rango(tipo, b.tempMin, b.tempMax)
  // Sin número: el siguiente al más alto del sector (no reusa el de una máquina dada de baja).
  const numero = b.numero === undefined || b.numero === null || b.numero === ''
    ? ((await una<{ n: number }>(db, 'SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM maquinas WHERE sector = ?', sector))!.n)
    : numeroMaquina(b.numero)
  await numeroLibre(db, sector, numero, null)
  const nueva: Maquina = { id: nuevoId(), sector, numero, nombre, tipo, ...r, activo: true }
  await db.batch([
    sentencia(
      db,
      'INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      nueva.id, sector, numero, nombre, tipo, r.tempMin, r.tempMax,
    ),
    sentenciaAuditoria(db, { tabla: 'maquinas', registroId: nueva.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nueva }),
  ])
  return c.json<Maquina>(nueva)
})

rutasCatalogos.patch('/maquinas/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  algoParaCambiar(b, ['numero', 'nombre', 'tipo', 'tempMin', 'tempMax', 'activo'])
  const antes = aMaquina(await leerMaquina(db, c.req.param('id')))
  const despues: Maquina = { ...antes }
  if (b.numero !== undefined) despues.numero = numeroMaquina(b.numero)
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre de la máquina', { max: 80 })
  if (b.tipo !== undefined) despues.tipo = tipoMaquina(b.tipo)
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  // El rango se valida completo con lo que llega y lo que ya tenía.
  Object.assign(despues, rango(
    despues.tipo,
    b.tempMin !== undefined ? b.tempMin : antes.tempMin,
    b.tempMax !== undefined ? b.tempMax : antes.tempMax,
  ))
  if (despues.activo && (despues.numero !== antes.numero || !antes.activo)) await numeroLibre(db, antes.sector, despues.numero, antes.id)
  await db.batch([
    sentencia(
      db,
      'UPDATE maquinas SET numero = ?, nombre = ?, tipo = ?, temp_min = ?, temp_max = ?, activo = ? WHERE id = ?',
      despues.numero, despues.nombre, despues.tipo, despues.tempMin, despues.tempMax, despues.activo, antes.id,
    ),
    sentenciaAuditoria(db, {
      tabla: 'maquinas', registroId: antes.id, accion: accionDe(antes.activo, despues.activo), usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<Maquina>(despues)
})

// ---------- Áreas y tareas de limpieza (B03) ----------

interface FilaArea { id: string; nombre: string; codigo: string; activo: number; frecuencia_dias: number | null }
interface FilaTarea { id: string; area_id: string; nombre: string; pide_numero: number; activo: number }
const aTarea = (f: FilaTarea): TareaLimpieza => ({
  id: f.id, areaId: f.area_id, nombre: f.nombre, pideNumero: !!f.pide_numero, activo: !!f.activo,
})

/** Áreas con sus sectores y sus tareas en el orden de la planilla. Sin `todos`, solo lo activo. */
async function leerAreas(db: BaseD1, filtro: { sector?: SectorId | null; todos?: boolean; id?: string }): Promise<AreaLimpieza[]> {
  const w = donde([
    [!!filtro.id, 'a.id = ?', filtro.id ?? null],
    [!!filtro.sector, 'a.id IN (SELECT area_id FROM areas_sectores WHERE sector = ?)', filtro.sector ?? null],
    [!filtro.todos, 'a.activo = 1'],
  ])
  const areas = await todas<FilaArea>(db, `SELECT a.id, a.nombre, a.codigo, a.activo, a.frecuencia_dias FROM areas_limpieza a ${w.where} ORDER BY a.orden, a.nombre`, ...w.params)
  if (!areas.length) return []
  const ids = areas.map((a) => a.id)
  const sectores = await todasPorTrozos<{ area_id: string; sector: SectorId }>(
    db, ids,
    (m) => `SELECT x.area_id, x.sector FROM areas_sectores x JOIN sectores s ON s.id = x.sector
             WHERE x.area_id IN (${m}) ORDER BY s.orden`,
  )
  const tareas = await todasPorTrozos<FilaTarea & { orden: number }>(
    db, ids,
    (m) => `SELECT id, area_id, nombre, pide_numero, activo, orden FROM tareas_limpieza WHERE area_id IN (${m})`,
  )
  tareas.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
  return areas.map((a) => ({
    id: a.id,
    nombre: a.nombre,
    codigo: a.codigo,
    activo: !!a.activo,
    frecuenciaDias: a.frecuencia_dias,
    sectores: sectores.filter((s) => s.area_id === a.id).map((s) => s.sector),
    tareas: tareas.filter((t) => t.area_id === a.id && (filtro.todos || t.activo)).map(aTarea),
  }))
}

async function leerArea(db: BaseD1, id: string): Promise<AreaLimpieza> {
  const [a] = await leerAreas(db, { id, todos: true })
  if (!a) throw noEncontrado('No se encontró esa área de limpieza.')
  return a
}

function listaSectores(v: unknown): SectorId[] {
  if (!Array.isArray(v) || v.length === 0) throw invalido('Elegí al menos un sector que cargue esta área.')
  if (!v.every(esSector)) throw invalido('Sector desconocido.')
  // Sin repetir y en el orden de siempre.
  return SECTOR_IDS.filter((s) => v.includes(s))
}

async function areaSinRepetir(db: BaseD1, nombre: string, propio: string | null) {
  const existentes = await todas<FilaArea>(db, 'SELECT id, nombre, codigo, activo, frecuencia_dias FROM areas_limpieza')
  sinRepetir(existentes, nombre, propio, 'un área')
}

const sentenciasSectores = (db: BaseD1, areaId: string, sectores: SectorId[]): SentenciaD1[] => [
  sentencia(db, 'DELETE FROM areas_sectores WHERE area_id = ?', areaId),
  ...sectores.map((s) => sentencia(db, 'INSERT INTO areas_sectores (area_id, sector) VALUES (?, ?)', areaId, s)),
]

rutasCatalogos.get('/areas', async (c) => {
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'))
  return c.json<AreaLimpieza[]>(await leerAreas(c.env.DB, { sector, todos: verTodos(c) }))
})

rutasCatalogos.post('/areas', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const nombre = texto(b.nombre, 'el nombre del área', { max: 80 })
  const codigo = textoOpcional(b.codigo, 'El código', 30) ?? ''
  const sectores = listaSectores(b.sectores)
  await areaSinRepetir(db, nombre, null)
  const nueva: AreaLimpieza = { id: nuevoId(), nombre, codigo, sectores, activo: true, frecuenciaDias: null, tareas: [] }
  await db.batch([
    sentencia(
      db,
      `INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden)
       VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(orden), -1) + 1 FROM areas_limpieza))`,
      nueva.id, nombre, codigo,
    ),
    ...sentenciasSectores(db, nueva.id, sectores),
    sentenciaAuditoria(db, { tabla: 'areas_limpieza', registroId: nueva.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nueva }),
  ])
  return c.json<AreaLimpieza>(nueva)
})

rutasCatalogos.patch('/areas/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  algoParaCambiar(b, ['nombre', 'codigo', 'sectores', 'activo', 'frecuenciaDias'])
  const area = await leerArea(db, c.req.param('id'))
  const { tareas, ...antes } = area
  const despues = { ...antes }
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre del área', { max: 80 })
  if (b.codigo !== undefined) despues.codigo = textoOpcional(b.codigo, 'El código', 30) ?? ''
  if (b.sectores !== undefined) despues.sectores = listaSectores(b.sectores)
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  // G08: días entre limpiezas (1 a 365); null = sin exigencia.
  if (b.frecuenciaDias !== undefined) {
    despues.frecuenciaDias = b.frecuenciaDias === null ? null : entero(b.frecuenciaDias, 'La frecuencia de limpieza', { min: 1, max: 365 })
  }
  if (despues.nombre !== antes.nombre) await areaSinRepetir(db, despues.nombre, antes.id)
  await db.batch([
    sentencia(db, 'UPDATE areas_limpieza SET nombre = ?, codigo = ?, activo = ?, frecuencia_dias = ? WHERE id = ?', despues.nombre, despues.codigo, despues.activo, despues.frecuenciaDias, antes.id),
    ...(b.sectores !== undefined ? sentenciasSectores(db, antes.id, despues.sectores) : []),
    sentenciaAuditoria(db, {
      tabla: 'areas_limpieza', registroId: antes.id, accion: accionDe(antes.activo, despues.activo), usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<AreaLimpieza>({ ...despues, tareas })
})

async function leerTarea(db: BaseD1, id: string): Promise<FilaTarea> {
  const f = await una<FilaTarea>(db, 'SELECT id, area_id, nombre, pide_numero, activo FROM tareas_limpieza WHERE id = ?', id)
  if (!f) throw noEncontrado('No se encontró esa tarea de limpieza.')
  return f
}

async function tareaSinRepetir(db: BaseD1, areaId: string, nombre: string, propio: string | null) {
  const existentes = await todas<FilaTarea>(db, 'SELECT id, area_id, nombre, pide_numero, activo FROM tareas_limpieza WHERE area_id = ?', areaId)
  sinRepetir(existentes, nombre, propio, 'una tarea', ' en esta área')
}

rutasCatalogos.post('/areas/:id/tareas', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const area = await leerArea(db, c.req.param('id'))
  const nombre = texto(b.nombre, 'el nombre de la tarea', { max: 100 })
  const pideNumero = b.pideNumero === undefined || b.pideNumero === null ? false : booleano(b.pideNumero, 'pideNumero')
  await tareaSinRepetir(db, area.id, nombre, null)
  const nueva: TareaLimpieza = { id: nuevoId(), areaId: area.id, nombre, pideNumero, activo: true }
  await db.batch([
    sentencia(
      db,
      `INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden)
       VALUES (?, ?, ?, ?, 1, (SELECT COALESCE(MAX(orden), -1) + 1 FROM tareas_limpieza WHERE area_id = ?))`,
      nueva.id, area.id, nombre, pideNumero, area.id,
    ),
    sentenciaAuditoria(db, { tabla: 'tareas_limpieza', registroId: nueva.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nueva }),
  ])
  return c.json<TareaLimpieza>(nueva)
})

rutasCatalogos.patch('/tareas/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  algoParaCambiar(b, ['nombre', 'pideNumero', 'activo'])
  const antes = aTarea(await leerTarea(db, c.req.param('id')))
  const despues: TareaLimpieza = { ...antes }
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre de la tarea', { max: 100 })
  if (b.pideNumero !== undefined) despues.pideNumero = booleano(b.pideNumero, 'pideNumero')
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  if (despues.nombre !== antes.nombre) await tareaSinRepetir(db, antes.areaId, despues.nombre, antes.id)
  await db.batch([
    sentencia(db, 'UPDATE tareas_limpieza SET nombre = ?, pide_numero = ?, activo = ? WHERE id = ?', despues.nombre, despues.pideNumero, despues.activo, antes.id),
    sentenciaAuditoria(db, {
      tabla: 'tareas_limpieza', registroId: antes.id, accion: accionDe(antes.activo, despues.activo), usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<TareaLimpieza>(despues)
})

// ---------- Sucursales (B04) ----------

interface FilaSucursal { id: string; nombre: string; activo: number }
const aSucursal = (f: FilaSucursal): Sucursal => ({ id: f.id, nombre: f.nombre, activo: !!f.activo })

async function sucursalSinRepetir(db: BaseD1, nombre: string, propio: string | null) {
  sinRepetir(await todas<FilaSucursal>(db, 'SELECT id, nombre, activo FROM sucursales'), nombre, propio, 'una sucursal')
}

rutasCatalogos.get('/sucursales', async (c) => {
  const w = donde([[!verTodos(c), 'activo = 1']])
  const filas = await todas<FilaSucursal>(c.env.DB, `SELECT id, nombre, activo FROM sucursales ${w.where}`, ...w.params)
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return c.json<Sucursal[]>(filas.map(aSucursal))
})

rutasCatalogos.post('/sucursales', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const nombre = texto(b.nombre, 'el nombre de la sucursal', { max: 80 })
  await sucursalSinRepetir(db, nombre, null)
  const nueva: Sucursal = { id: nuevoId(), nombre, activo: true }
  await db.batch([
    sentencia(db, 'INSERT INTO sucursales (id, nombre, activo) VALUES (?, ?, 1)', nueva.id, nombre),
    sentenciaAuditoria(db, { tabla: 'sucursales', registroId: nueva.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nueva }),
  ])
  return c.json<Sucursal>(nueva)
})

rutasCatalogos.patch('/sucursales/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  algoParaCambiar(b, ['nombre', 'activo'])
  const fila = await una<FilaSucursal>(db, 'SELECT id, nombre, activo FROM sucursales WHERE id = ?', c.req.param('id'))
  if (!fila) throw noEncontrado('No se encontró esa sucursal.')
  const antes = aSucursal(fila)
  const despues: Sucursal = { ...antes }
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre de la sucursal', { max: 80 })
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  if (despues.nombre !== antes.nombre) await sucursalSinRepetir(db, despues.nombre, antes.id)
  await db.batch([
    sentencia(db, 'UPDATE sucursales SET nombre = ?, activo = ? WHERE id = ?', despues.nombre, despues.activo, antes.id),
    sentenciaAuditoria(db, {
      tabla: 'sucursales', registroId: antes.id, accion: accionDe(antes.activo, despues.activo), usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<Sucursal>(despues)
})
