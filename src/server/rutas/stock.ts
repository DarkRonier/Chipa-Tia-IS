// D01–D07: stock en frío y envíos a sucursales. El stock es la suma del libro `movimientos`:
// lo guardado en producción suma; salidas a venta, envíos, mermas y vencimientos restan; los ajustes
// del administrador van en los dos sentidos. El trigger `movimientos_sin_stock_negativo` (D04) rechaza
// cualquier salida que deje negativo el producto o el lote, y un envío de varias líneas va en un solo
// `batch`: si una línea no alcanza, no se registra ninguna.
import { Hono } from 'hono'
import type {
  Movimiento, RespuestaEnvio, SectorId, StockFila, TipoAjuste, TipoMovimiento,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { leerMovimientos } from '../consultas'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1 } from '../entorno'
import { conflicto, esStockInsuficiente, invalido } from '../errores'
import { sectorPara, soloAdmin } from '../sesion'
import { cuerpo, diaOpcional, texto } from '../validar'

export const rutasStock = new Hono<Entorno>()

const TIPOS_MOVIMIENTO: readonly TipoMovimiento[] = [
  'produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste',
]
const TIPOS_AJUSTE: readonly TipoAjuste[] = ['merma', 'vencimiento', 'ajuste', 'stock_inicial']
const MAX_CANTIDAD = 1_000_000
const MAX_LINEAS_ENVIO = 100
const MAX_LOTE = 40

// ---------- Ayudas ----------

const vacio = (v: unknown) => v === undefined || v === null || v === ''

/** Sector con lotes (Chipería): exige lote en salidas, envíos y ajustes, y muestra el stock por lote. */
async function sectorConLotes(db: BaseD1, sector: SectorId): Promise<boolean> {
  const f = await una<{ con_lotes: number }>(db, 'SELECT con_lotes FROM sectores WHERE id = ?', sector)
  return !!f?.con_lotes
}

/** Entero > 0. El servidor pone el signo según el tipo de movimiento. */
function cantidadPositiva(v: unknown, campo = 'La cantidad'): number {
  if (vacio(v) || v === 0) throw invalido('Cargá una cantidad mayor que cero.')
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalido(`${campo} tiene que ser un número entero.`)
  if (v < 1) throw invalido('Cargá una cantidad mayor que cero.')
  if (v > MAX_CANTIDAD) throw invalido(`${campo} es demasiado grande.`)
  return v
}

interface FilaProducto {
  id: string
  sector: SectorId
  nombre: string
  activo: number
}

async function leerProductos(db: BaseD1, ids: string[]): Promise<Map<string, FilaProducto>> {
  const unicos = [...new Set(ids)]
  const filas = await todasPorTrozos<FilaProducto>(db, unicos, (m) => `SELECT id, sector, nombre, activo FROM productos WHERE id IN (${m})`)
  return new Map(filas.map((f) => [f.id, f]))
}

/** El producto tiene que existir y ser del sector. Se aceptan desactivados: puede quedarles stock. */
function productoDelSector(productos: Map<string, FilaProducto>, id: string, sector: SectorId): FilaProducto {
  const p = productos.get(id)
  if (!p) throw invalido('Ese producto no existe. Recargá la página y probá de nuevo.')
  if (p.sector !== sector) throw invalido(`${p.nombre} no es un producto de este sector.`)
  return p
}

function leerProductoId(v: unknown): string {
  if (vacio(v)) throw invalido('Elegí el producto.')
  return texto(v, 'el producto', { max: 100 })
}

/**
 * Lote opcional: en sectores sin lotes se ignora; en Chipería es obligatorio (`siFalta` = mensaje).
 * Se guarda sin espacios y en mayúsculas, así un lote escrito "ch-261009-1 " encuentra su stock.
 */
function leerLote(v: unknown, conLotes: boolean, siFalta: string): string | null {
  if (!conLotes) return null
  if (vacio(v)) throw invalido(siFalta)
  if (typeof v !== 'string' || !v.trim()) throw invalido(siFalta)
  return texto(v, 'El lote', { max: MAX_LOTE }).toUpperCase()
}

async function stockActual(db: BaseD1, sector: SectorId, productoId: string, lote: string | null): Promise<number> {
  const f = await una<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos
      WHERE sector = ? AND producto_id = ? ${lote === null ? '' : 'AND lote = ?'}`,
    sector, productoId, ...(lote === null ? [] : [lote]),
  )
  return f?.total ?? 0
}

const enLote = (lote: string | null) => (lote ? ` del lote ${lote}` : '')

/**
 * Corre el batch y, si el trigger de D04 lo rechaza, busca qué línea no alcanza para decirlo claro
 * ("Solo hay 3 de Empanada frita (carne)…"). Siempre responde 409 stock_insuficiente.
 */
async function conControlDeStock(
  db: BaseD1,
  sentencias: SentenciaD1[],
  lineas: { sector: SectorId; productoId: string; nombre: string; lote: string | null; sale: number }[],
) {
  try {
    await db.batch(sentencias)
  } catch (e) {
    if (!esStockInsuficiente(e)) throw e
    for (const l of lineas) {
      // Lo que piden de un mismo producto y lote en varias líneas se suma.
      const pedido = lineas
        .filter((o) => o.productoId === l.productoId && (l.lote === null || o.lote === l.lote))
        .reduce((s, o) => s + o.sale, 0)
      const hay = Math.max(0, await stockActual(db, l.sector, l.productoId, l.lote))
      if (pedido > hay) {
        throw conflicto(
          'stock_insuficiente',
          hay === 0
            ? `No hay stock de ${l.nombre}${enLote(l.lote)}.`
            : `No hay stock suficiente: de ${l.nombre}${enLote(l.lote)} hay ${hay} y querés sacar ${pedido}.`,
        )
      }
    }
    throw conflicto('stock_insuficiente', 'No hay stock suficiente para esa salida.')
  }
}

function sentenciaMovimiento(db: BaseD1, m: {
  id: string
  sector: SectorId
  productoId: string
  lote: string | null
  tipo: TipoMovimiento
  cantidad: number
  motivo: string | null
  sucursalId: string | null
  envioId: string | null
  usuarioId: string
  fecha: string
  dia: string
}): SentenciaD1 {
  return sentencia(
    db,
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    m.id, m.sector, m.productoId, m.lote, m.tipo, m.cantidad, m.motivo, m.sucursalId, m.envioId, m.usuarioId, m.fecha, m.dia,
  )
}

/** Los movimientos recién creados, en el mismo orden en que se cargaron. */
async function movimientosEnOrden(db: BaseD1, ids: string[]): Promise<Movimiento[]> {
  const leidos = new Map((await leerMovimientos(db, { ids })).map((m) => [m.id, m]))
  return ids.map((id) => leidos.get(id)!).filter(Boolean)
}

/** Orden de los lotes, el más viejo primero: día y amasada del lote (o de su código CH-AAMMDD-N). */
function claveLote(f: { lote: string; lote_dia: string | null; amasada: number | null; primera_dia: string; primera: string }) {
  let dia = f.lote_dia
  let amasada = f.amasada
  if (!dia) {
    const m = /^CH-(\d{2})(\d{2})(\d{2})-(\d+)$/i.exec(f.lote)
    if (m) {
      dia = `20${m[1]}-${m[2]}-${m[3]}`
      amasada = Number(m[4])
    }
  }
  return { dia: dia ?? f.primera_dia, amasada: amasada ?? 0, primera: f.primera }
}

// ---------- Stock (D01, D07) ----------

rutasStock.get('/stock', async (c) => {
  const db = c.env.DB
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'), true)
  const conLotes = await sectorConLotes(db, sector)

  const productos = await todas<{ id: string; nombre: string; activo: number; total: number }>(
    db,
    `SELECT p.id, p.nombre, p.activo,
            COALESCE((SELECT SUM(m.cantidad) FROM movimientos m WHERE m.sector = p.sector AND m.producto_id = p.id), 0) AS total
       FROM productos p
      WHERE p.sector = ?
      ORDER BY p.orden, p.nombre`,
    sector,
  )

  const lotes = conLotes
    ? await todas<{ producto_id: string; lote: string; cantidad: number; lote_dia: string | null; amasada: number | null; primera_dia: string; primera: string }>(
      db,
      `SELECT m.producto_id, m.lote, SUM(m.cantidad) AS cantidad, MIN(m.dia) AS primera_dia, MIN(m.fecha) AS primera,
              (SELECT l.dia FROM lotes_chipa l WHERE l.codigo = m.lote) AS lote_dia,
              (SELECT l.amasada FROM lotes_chipa l WHERE l.codigo = m.lote) AS amasada
         FROM movimientos m
        WHERE m.sector = ? AND m.lote IS NOT NULL
        GROUP BY m.producto_id, m.lote
       HAVING SUM(m.cantidad) > 0`,
      sector,
    )
    : []
  const ordenados = lotes
    .map((f) => ({ f, k: claveLote(f) }))
    .sort((a, b) =>
      a.k.dia.localeCompare(b.k.dia) || a.k.amasada - b.k.amasada || a.k.primera.localeCompare(b.k.primera) || a.f.lote.localeCompare(b.f.lote))
    .map(({ f }) => f)

  const filas: StockFila[] = productos
    .filter((p) => p.activo || p.total !== 0)
    .map((p) => ({
      productoId: p.id,
      productoNombre: p.nombre,
      activo: !!p.activo,
      total: p.total,
      lotes: ordenados.filter((l) => l.producto_id === p.id).map((l) => ({ lote: l.lote, cantidad: l.cantidad })),
    }))
  return c.json<StockFila[]>(filas)
})

// ---------- Salida a venta (D02, D04) ----------

rutasStock.post('/salidas', async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)
  const productoId = leerProductoId(b.productoId)
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Elegí de qué lote sale.')
  const cantidad = cantidadPositiva(b.cantidad)
  const producto = productoDelSector(await leerProductos(db, [productoId]), productoId, sector)

  const id = nuevoId()
  const { fecha, dia } = ahora()
  await conControlDeStock(
    db,
    [sentenciaMovimiento(db, {
      id, sector, productoId, lote, tipo: 'salida_venta', cantidad: -cantidad, motivo: null,
      sucursalId: null, envioId: null, usuarioId: u.id, fecha, dia,
    })],
    [{ sector, productoId, nombre: producto.nombre, lote, sale: cantidad }],
  )
  const [m] = await movimientosEnOrden(db, [id])
  return c.json<Movimiento>(m)
})

// ---------- Envío a sucursal (D03, D04, E05) ----------

rutasStock.post('/envios', async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)

  if (vacio(b.sucursalId)) throw invalido('Elegí la sucursal.')
  const sucursalId = texto(b.sucursalId, 'la sucursal', { max: 100 })
  const sucursal = await una<{ nombre: string; activo: number }>(db, 'SELECT nombre, activo FROM sucursales WHERE id = ?', sucursalId)
  if (!sucursal) throw invalido('Esa sucursal no existe. Recargá la página y probá de nuevo.')
  if (!sucursal.activo) throw invalido(`La sucursal ${sucursal.nombre} está desactivada. Elegí otra.`)

  if (!Array.isArray(b.items) || b.items.length === 0) throw invalido('Cargá al menos un producto para enviar.')
  if (b.items.length > MAX_LINEAS_ENVIO) throw invalido('Son demasiados productos en un solo envío.')
  const conLotes = await sectorConLotes(db, sector)
  const crudos = (b.items as unknown[]).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
  const productos = await leerProductos(db, crudos.map((it) => leerProductoId(it.productoId)))

  const vistos = new Set<string>()
  const lineas = crudos.map((it) => {
    const productoId = leerProductoId(it.productoId)
    const producto = productoDelSector(productos, productoId, sector)
    const lote = leerLote(it.lote, conLotes, `Elegí el lote de ${producto.nombre}.`)
    const cantidad = cantidadPositiva(it.cantidad, `La cantidad de ${producto.nombre}`)
    const clave = `${productoId}|${lote ?? ''}`
    if (vistos.has(clave)) {
      throw invalido(`${producto.nombre}${enLote(lote)} está repetido en el envío: juntá las cantidades en una sola línea.`)
    }
    vistos.add(clave)
    return { productoId, nombre: producto.nombre, lote, cantidad }
  })

  const envioId = nuevoId()
  const { fecha, dia } = ahora()
  const ids = lineas.map(() => nuevoId())
  await conControlDeStock(
    db,
    lineas.map((l, i) => sentenciaMovimiento(db, {
      id: ids[i], sector, productoId: l.productoId, lote: l.lote, tipo: 'envio', cantidad: -l.cantidad, motivo: null,
      sucursalId, envioId, usuarioId: u.id, fecha, dia,
    })),
    lineas.map((l) => ({ sector, productoId: l.productoId, nombre: l.nombre, lote: l.lote, sale: l.cantidad })),
  )
  return c.json<RespuestaEnvio>({ envioId, movimientos: await movimientosEnOrden(db, ids) })
})

// ---------- Mermas, vencimientos, ajustes y stock inicial (D06, D07) · admin ----------

rutasStock.post('/ajustes', soloAdmin, async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)
  if (vacio(b.tipo)) throw invalido('Elegí si es merma, vencimiento, ajuste o stock inicial.')
  if (!(TIPOS_AJUSTE as readonly unknown[]).includes(b.tipo)) throw invalido('El tipo de ajuste no es válido.')
  const tipo = b.tipo as TipoAjuste
  const productoId = leerProductoId(b.productoId)
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Indicá el lote.')
  const cantidad = cantidadPositiva(b.cantidad)
  let signo: 1 | -1
  if (tipo === 'ajuste') {
    if (b.sentido !== 1 && b.sentido !== -1) throw invalido('Elegí si el ajuste suma o resta.')
    signo = b.sentido
  } else {
    signo = tipo === 'stock_inicial' ? 1 : -1
  }
  if (vacio(b.motivo) || (typeof b.motivo === 'string' && !b.motivo.trim())) throw invalido('Escribí el motivo.')
  const motivo = texto(b.motivo, 'El motivo', { max: 300 })
  const producto = productoDelSector(await leerProductos(db, [productoId]), productoId, sector)

  const id = nuevoId()
  const { fecha, dia } = ahora()
  const antes = await stockActual(db, sector, productoId, lote)
  const delta = signo * cantidad
  await conControlDeStock(
    db,
    [
      sentenciaMovimiento(db, {
        id, sector, productoId, lote, tipo, cantidad: delta, motivo, sucursalId: null, envioId: null, usuarioId: u.id, fecha, dia,
      }),
      sentenciaAuditoria(db, {
        tabla: 'movimientos',
        registroId: id,
        accion: 'ajustar',
        usuarioId: u.id,
        antes: { sector, productoId, producto: producto.nombre, lote, stock: antes },
        despues: { sector, productoId, producto: producto.nombre, lote, stock: antes + delta, tipo, cantidad: delta, motivo },
      }),
    ],
    signo < 0 ? [{ sector, productoId, nombre: producto.nombre, lote, sale: cantidad }] : [],
  )
  const [m] = await movimientosEnOrden(db, [id])
  return c.json<Movimiento>(m)
})

// ---------- Historial (D05) ----------

rutasStock.get('/movimientos', async (c) => {
  const q = c.req.query()
  const sector = sectorPara(c.get('usuario'), q.sector)
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  const tipos = (q.tipo ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  for (const t of tipos) {
    if (!(TIPOS_MOVIMIENTO as readonly string[]).includes(t)) throw invalido('El tipo de movimiento no es válido.')
  }
  const corto = (v: string | undefined, campo: string) => {
    if (vacio(v)) return null
    if (v!.length > 100) throw invalido(`${campo} no es válido.`)
    return v!
  }
  return c.json<Movimiento[]>(await leerMovimientos(c.env.DB, {
    sector,
    desde,
    hasta,
    sucursal: corto(q.sucursal, 'La sucursal'),
    producto: corto(q.producto, 'El producto'),
    tipos: tipos as TipoMovimiento[],
    lote: corto(q.lote, 'El lote'),
  }))
})

