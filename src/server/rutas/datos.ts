// I01–I05: configuración de los correos, exportación completa (el Excel se arma en el navegador, I03),
// copias de seguridad semanales y a mano (I05) y el registro de cambios del administrador (auditoría).
// La vuelta atrás a cualquier minuto de los últimos 7 días (I02) es Cloudflare D1 Time Travel
// (ver docs/despliegue.md): no pasa por esta API.
import { Hono } from 'hono'
import { diaPY, sumarDias } from '../../shared/hora'
import type { Auditoria, Configuracion, Copia, Exportacion } from '../../shared/tipos'
import { guardarArchivo, leerArchivo } from '../almacen'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, sentencia, todas, una } from '../db'
import type { BaseD1, Entorno, Env, ValorSQL } from '../entorno'
import { invalido, noEncontrado } from '../errores'
import { soloAdmin } from '../sesion'
import { cuerpo, diaOpcional } from '../validar'

export const rutasDatos = new Hono<Entorno>()

// Todo lo de datos es solo para el administrador (soloAdmin en cada ruta).

// ---------- Configuración (H04) ----------

const CLAVES_CONFIG: (keyof Configuracion)[] = ['correoReportes', 'urlPublica']
const MAX_DESTINOS = 5

export async function leerConfiguracion(db: BaseD1): Promise<Configuracion> {
  const filas = await todas<{ clave: string; valor: string }>(db, 'SELECT clave, valor FROM configuracion')
  const valor = (k: keyof Configuracion) => filas.find((f) => f.clave === k)?.valor ?? ''
  return { correoReportes: valor('correoReportes'), urlPublica: valor('urlPublica') }
}

const CORREO = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']{2,}$/

/** Uno o varios correos separados por coma: "a@x.com, b@y.com". Vacío = sin correo. */
export function normalizarCorreos(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') throw invalido('El correo de reportes no es válido.')
  const lista = v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (lista.length > MAX_DESTINOS) throw invalido(`Cargá hasta ${MAX_DESTINOS} correos.`)
  for (const c of lista) {
    if (c.length > 120 || !CORREO.test(c)) throw invalido(`Revisá el correo «${c}»: tiene que ser como nombre@dominio.com.`)
  }
  return [...new Set(lista)].join(', ')
}

/** Dirección pública del sistema sin "#…", sin "?…" y sin la barra final: "https://chipatia.com". */
export function normalizarUrl(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') throw invalido('La dirección pública no es válida.')
  const t = v.trim()
  if (!t) return ''
  let u: URL
  try {
    u = new URL(t)
  } catch {
    throw invalido('Revisá la dirección pública: tiene que empezar con https:// (por ejemplo https://chipatia.com).')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw invalido('Revisá la dirección pública: tiene que empezar con https:// (por ejemplo https://chipatia.com).')
  }
  if (u.username || u.password) throw invalido('La dirección pública no puede llevar usuario ni contraseña.')
  const limpia = `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  if (limpia.length > 300) throw invalido('La dirección pública es demasiado larga.')
  return limpia
}

rutasDatos.get('/config', soloAdmin, async (c) => c.json<Configuracion>(await leerConfiguracion(c.env.DB)))

rutasDatos.patch('/config', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const db = c.env.DB
  const antes = await leerConfiguracion(db)
  const despues: Configuracion = { ...antes }
  if ('correoReportes' in b) despues.correoReportes = normalizarCorreos(b.correoReportes)
  if ('urlPublica' in b) despues.urlPublica = normalizarUrl(b.urlPublica)
  const cambiadas = CLAVES_CONFIG.filter((k) => despues[k] !== antes[k])
  if (cambiadas.length) {
    await db.batch(cambiadas.flatMap((k) => [
      sentencia(
        db,
        'INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor',
        k, despues[k],
      ),
      sentenciaAuditoria(db, {
        tabla: 'configuracion', registroId: k, accion: 'editar', usuarioId: c.get('usuario').id,
        antes: { [k]: antes[k] }, despues: { [k]: despues[k] },
      }),
    ]))
  }
  return c.json<Configuracion>(despues)
})

// ---------- Exportación completa (I03) y copias (I05) ----------

/** Tablas en orden de lectura: primero los catálogos, después los registros. */
const TABLAS = [
  'sectores', 'usuarios', 'productos', 'maquinas', 'areas_limpieza', 'areas_sectores', 'tareas_limpieza', 'sucursales',
  'lotes_mp', 'producciones', 'produccion_items', 'lotes_chipa', 'lote_chipa_mp', 'movimientos', 'lecturas',
  'limpiezas', 'limpieza_marcas', 'auditoria', 'copias', 'configuracion', 'archivos',
]
/** Nunca salen: las sesiones abiertas. */
const EXCLUIDAS = new Set(['sesiones'])
/** Columnas que no salen: contraseñas (aunque sean hash) y el contenido de fotos y copias. */
const COLUMNAS_EXCLUIDAS: Record<string, string[]> = { usuarios: ['clave_hash'], archivos: ['datos'] }

/** Tablas de la base: las conocidas y cualquiera que agregue una migración nueva. */
async function tablasDeLaBase(db: BaseD1): Promise<string[]> {
  let nombres: string[] = []
  try {
    nombres = (await todas<{ name: string }>(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'`,
    )).map((f) => f.name)
  } catch {
    // Sin acceso al catálogo de SQLite: alcanzan las conocidas.
  }
  const extra = nombres.filter((n) => !TABLAS.includes(n)).sort()
  const presentes = nombres.length ? TABLAS.filter((t) => nombres.includes(t)) : TABLAS
  return [...presentes, ...extra].filter((t) => !EXCLUIDAS.has(t) && /^[a-z0-9_]+$/i.test(t))
}

export async function exportarTodo(db: BaseD1): Promise<Exportacion> {
  const tablas: Exportacion['tablas'] = {}
  for (const t of await tablasDeLaBase(db)) {
    const filas = await todas<Record<string, ValorSQL>>(db, `SELECT * FROM "${t}" ORDER BY rowid`)
      .catch(() => todas<Record<string, ValorSQL>>(db, `SELECT * FROM "${t}"`))
    const fuera = COLUMNAS_EXCLUIDAS[t] ?? []
    tablas[t] = fuera.length
      ? filas.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !fuera.includes(k))))
      : filas
  }
  return { generadoEn: new Date().toISOString(), tablas }
}

const formatoHoraPY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

/** "copias/2026-10-12T060012.json", con el día y la hora de Paraguay. */
function claveCopia(fecha: Date): string {
  const hhmmss = formatoHoraPY.format(fecha).replace(/\D/g, '').replace(/^24/, '00')
  return `copias/${diaPY(fecha)}T${hhmmss}.json`
}

/** Copia de toda la base como JSON, guardada aparte (R2 en Cloudflare). I05. */
export async function hacerCopia(env: Env, origen: Copia['origen'], usuarioId?: string): Promise<Copia> {
  const datos = await exportarTodo(env.DB)
  const { fecha, dia } = ahora()
  let clave = claveCopia(new Date(fecha))
  // Dos copias en el mismo segundo: la segunda lleva un número.
  for (let n = 2; await una(env.DB, 'SELECT 1 AS x FROM copias WHERE clave = ?', clave); n++) {
    clave = `${claveCopia(new Date(fecha)).replace(/\.json$/, '')}-${n}.json`
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ ...datos, copia: { clave, origen } }))
  // Primero el archivo: así la lista nunca muestra una copia que no está.
  await guardarArchivo(env, clave, bytes, 'application/json')
  const copia: Copia = { clave, fecha, dia, bytes: bytes.length, origen }
  const insertar = sentencia(
    env.DB, 'INSERT INTO copias (clave, fecha, dia, bytes, origen) VALUES (?, ?, ?, ?, ?)', clave, fecha, dia, bytes.length, origen,
  )
  if (usuarioId) {
    await env.DB.batch([
      insertar,
      sentenciaAuditoria(env.DB, { tabla: 'copias', registroId: clave, accion: 'crear', usuarioId, despues: copia }),
    ])
  } else {
    await insertar.run()
  }
  return copia
}

rutasDatos.get('/exportar', soloAdmin, async (c) => c.json<Exportacion>(await exportarTodo(c.env.DB)))

rutasDatos.get('/copias', soloAdmin, async (c) => {
  const filas = await todas<Copia>(
    c.env.DB, 'SELECT clave, fecha, dia, bytes, origen FROM copias ORDER BY fecha DESC, clave DESC LIMIT 500',
  )
  return c.json<Copia[]>(filas)
})

rutasDatos.post('/copias', soloAdmin, async (c) => c.json<Copia>(await hacerCopia(c.env, 'manual', c.get('usuario').id)))

// La clave lleva una barra ("copias/…json"): se acepta tal cual o codificada (copias%2F…).
rutasDatos.get('/copias/:clave{.+}', soloAdmin, async (c) => {
  let clave = c.req.param('clave')
  try {
    clave = decodeURIComponent(clave)
  } catch {
    throw noEncontrado('No se encontró esa copia.')
  }
  if (!clave.startsWith('copias/')) clave = `copias/${clave}`
  const fila = await una<{ clave: string }>(c.env.DB, 'SELECT clave FROM copias WHERE clave = ?', clave)
  if (!fila) throw noEncontrado('No se encontró esa copia.')
  const archivo = await leerArchivo(c.env, fila.clave)
  if (!archivo) throw noEncontrado('El archivo de esa copia no está. Hacé una copia nueva.')
  return c.body(archivo.datos as Uint8Array<ArrayBuffer>, 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="chipa-tia-${fila.clave.slice('copias/'.length)}"`,
  })
})

// ---------- Auditoría ----------

interface FilaAuditoria {
  id: string
  tabla: string
  registro_id: string
  accion: string
  usuario_id: string
  usuario_nombre: string | null
  fecha: string
  antes: string | null
  despues: string | null
}

const MAX_AUDITORIA = 500

rutasDatos.get('/auditoria', soloAdmin, async (c) => {
  const q = c.req.query()
  const desde = diaOpcional(q.desde, 'Desde')
  const hasta = diaOpcional(q.hasta, 'Hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  const tabla = q.tabla?.trim() || null
  const partes: string[] = []
  const params: ValorSQL[] = []
  if (tabla) {
    partes.push('a.tabla = ?')
    params.push(tabla)
  }
  // La auditoría guarda solo la fecha UTC: se trae un margen y se filtra por el día de Paraguay.
  if (desde) {
    partes.push('a.fecha >= ?')
    params.push(`${sumarDias(desde, -1)}T00:00:00.000Z`)
  }
  if (hasta) {
    partes.push('a.fecha < ?')
    params.push(`${sumarDias(hasta, 2)}T00:00:00.000Z`)
  }
  const where = partes.length ? `WHERE ${partes.join(' AND ')}` : ''
  const filas = await todas<FilaAuditoria>(
    c.env.DB,
    `SELECT a.id, a.tabla, a.registro_id, a.accion, a.usuario_id, u.nombre AS usuario_nombre, a.fecha, a.antes, a.despues
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${where}
      ORDER BY a.fecha DESC, a.id
      LIMIT ?`,
    ...params, MAX_AUDITORIA + 200,
  )
  const lista = filas
    .filter((f) => (!desde || diaPY(f.fecha) >= desde) && (!hasta || diaPY(f.fecha) <= hasta))
    .slice(0, MAX_AUDITORIA)
    .map<Auditoria>((f) => ({
      id: f.id,
      tabla: f.tabla,
      registroId: f.registro_id,
      accion: f.accion,
      usuarioId: f.usuario_id,
      usuarioNombre: f.usuario_nombre ?? f.usuario_id,
      fecha: f.fecha,
      antes: f.antes,
      despues: f.despues,
    }))
  return c.json<Auditoria[]>(lista)
})
