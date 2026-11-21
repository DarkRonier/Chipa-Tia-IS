// D01–D07: stock por depósito y envíos a sucursales (stock por depósitos, Mati 2026-11-21). El stock es la suma del
// libro `movimientos`, por producto, depósito y (en Chipería) lote. Depósitos del sistema (ver migración 0014):
// - Directo a Venta: lo que está listo para vender; las ventas de caja descuentan de acá.
// - Frío: lo guardado para reponer la venta. Lo producido va acá si no se elige otro depósito.
// - Para sucursales: los envíos salen de acá.
// - Materia prima: lo comprado para producir.
// «Sacar para la venta» (`POST /salidas`) pasa unidades de un depósito (Frío) a Directo a Venta, y
// `POST /transferencias` las pasa entre dos depósitos cualquiera. Los dos son un par de movimientos que no cambia el total.
// El trigger `movimientos_sin_stock_negativo` (D04) rechaza cualquier salida que deje negativo un producto o un lote en
// un depósito (menos las ventas de caja), y un envío de varias líneas va en un solo `batch`: si una línea no alcanza,
// no se registra ninguna.
import { Hono } from 'hono'
import {
  DEPOSITO,
  type Movimiento, type RespuestaEnvio, type SectorId, type StockFila, type TipoAjuste, type TipoMovimiento,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { leerMovimientos } from '../consultas'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1 } from '../entorno'
import { conflicto, esStockInsuficiente, invalido } from '../errores'
import { requiere, sectorPara } from '../sesion'
import { cuerpo, diaOpcional, texto } from '../validar'

export const rutasStock = new Hono<Entorno>()

const TIPOS_MOVIMIENTO: readonly TipoMovimiento[] = [
  'produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste', 'transferencia', 'compra', 'venta',
]
const TIPOS_AJUSTE: readonly TipoAjuste[] = ['merma', 'vencimiento', 'ajuste', 'stock_inicial']
const MAX_CANTIDAD = 1_000_000
const MAX_LINEAS_ENVIO = 100
const MAX_LOTE = 40

// ---------- Ayudas ----------

const vacio = (v: unknown) => v === undefined || v === null || v === ''

export interface DepositoElegido { id: string; nombre: string }

/**
 * Depósito por id (o `porDefecto` si no viene). Tiene que existir y estar activo. `campo`: «el depósito»,
 * «el depósito de origen»…
 */
export async function leerDeposito(db: BaseD1, v: unknown, porDefecto: string | null, campo = 'el depósito'): Promise<DepositoElegido> {
  if (vacio(v) && !porDefecto) throw invalido(`Elegí ${campo}.`)
  const id = vacio(v) ? porDefecto! : texto(v, campo, { max: 100 })
  const f = await una<{ id: string; nombre: string; activo: number }>(db, 'SELECT id, nombre, activo FROM depositos WHERE id = ?', id)
  if (!f) throw invalido('Ese depósito no existe. Recargá la página y probá de nuevo.')
  if (!f.activo) throw invalido(`El depósito ${f.nombre} está desactivado. Elegí otro.`)
  return { id: f.id, nombre: f.nombre }
}

/** Sector con lotes (Chipería): exige lote en salidas, envíos y ajustes, y muestra el stock por lote. */
export async function sectorConLotes(db: BaseD1, sector: SectorId): Promise<boolean> {
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

/** Lo que hay de un producto (y lote, si se indica) en un depósito; sin depósito, en todos. */
export async function stockActual(db: BaseD1, sector: SectorId, productoId: string, lote: string | null, depositoId?: string): Promise<number> {
  const f = await una<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos
      WHERE sector = ? AND producto_id = ? ${lote === null ? '' : 'AND lote = ?'} ${depositoId ? 'AND deposito_id = ?' : ''}`,
    sector, productoId, ...(lote === null ? [] : [lote]), ...(depositoId ? [depositoId] : []),
  )
  return f?.total ?? 0
}

const enLote = (lote: string | null) => (lote ? ` del lote ${lote}` : '')

/**
 * Corre el batch y, si el trigger de D04 lo rechaza, busca qué línea no alcanza para decirlo claro
 * ("No hay stock suficiente en Frío: de Empanada frita (carne) hay 3…"). Si en otro depósito hay, lo dice.
 * Siempre responde 409 stock_insuficiente.
 */
async function conControlDeStock(
  db: BaseD1,
  sentencias: SentenciaD1[],
  lineas: { sector: SectorId; productoId: string; nombre: string; lote: string | null; deposito: DepositoElegido; sale: number }[],
) {
  try {
    await db.batch(sentencias)
  } catch (e) {
    if (!esStockInsuficiente(e)) throw e
    for (const l of lineas) {
      // Lo que piden de un mismo producto y lote en varias líneas se suma.
      const pedido = lineas
        .filter((o) => o.productoId === l.productoId && o.deposito.id === l.deposito.id && (l.lote === null || o.lote === l.lote))
        .reduce((s, o) => s + o.sale, 0)
      const hay = Math.max(0, await stockActual(db, l.sector, l.productoId, l.lote, l.deposito.id))
      if (pedido > hay) {
        const otros = await todas<{ nombre: string; total: number }>(
          db,
          `SELECT d.nombre, SUM(m.cantidad) AS total FROM movimientos m JOIN depositos d ON d.id = m.deposito_id
            WHERE m.sector = ? AND m.producto_id = ? ${l.lote === null ? '' : 'AND m.lote = ?'} AND m.deposito_id <> ?
            GROUP BY d.id HAVING SUM(m.cantidad) > 0 ORDER BY d.orden`,
          l.sector, l.productoId, ...(l.lote === null ? [] : [l.lote]), l.deposito.id,
        )
        const aclaracion = otros.length
          ? ` En ${otros.map((o) => `«${o.nombre}» hay ${o.total}`).join(' y en ')}: pasalo con «Transferir» en Stock si querés usarlo.`
          : ''
        throw conflicto(
          'stock_insuficiente',
          (hay === 0
            ? `No hay stock de ${l.nombre}${enLote(l.lote)} en «${l.deposito.nombre}».`
            : `No hay stock suficiente en «${l.deposito.nombre}»: de ${l.nombre}${enLote(l.lote)} hay ${hay} y querés sacar ${pedido}.`) + aclaracion,
        )
      }
    }
    throw conflicto('stock_insuficiente', 'No hay stock suficiente para esa salida.')
  }
}

export function sentenciaMovimiento(db: BaseD1, m: {
  id: string
  sector: SectorId
  productoId: string
  depositoId: string
  lote: string | null
  tipo: TipoMovimiento
  cantidad: number
  motivo: string | null
  sucursalId?: string | null
  envioId?: string | null
  produccionId?: string | null
  compraId?: string | null
  ventaId?: string | null
  usuarioId: string
  fecha: string
  dia: string
}): SentenciaD1 {
  return sentencia(
    db,
    `INSERT INTO movimientos (id, sector, producto_id, deposito_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id,
                              compra_id, venta_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, m.sector, m.productoId, m.depositoId, m.lote, m.tipo, m.cantidad, m.motivo, m.sucursalId ?? null, m.envioId ?? null,
    m.produccionId ?? null, m.compraId ?? null, m.ventaId ?? null, m.usuarioId, m.fecha, m.dia,
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

interface FilaLoteDeposito {
  producto_id: string
  lote: string
  deposito_id: string
  cantidad: number
  lote_dia: string | null
  amasada: number | null
  primera_dia: string
  primera: string
}

/** Lotes de un sector con stock, por depósito, el más viejo primero. */
async function lotesConStock(db: BaseD1, sector: SectorId, productoId?: string) {
  const filas = await todas<FilaLoteDeposito>(
    db,
    `SELECT m.producto_id, m.lote, m.deposito_id, SUM(m.cantidad) AS cantidad, MIN(m.dia) AS primera_dia, MIN(m.fecha) AS primera,
            (SELECT l.dia FROM lotes_chipa l WHERE l.codigo = m.lote) AS lote_dia,
            (SELECT l.amasada FROM lotes_chipa l WHERE l.codigo = m.lote) AS amasada
       FROM movimientos m
      WHERE m.sector = ? AND m.lote IS NOT NULL ${productoId ? 'AND m.producto_id = ?' : ''}
      GROUP BY m.producto_id, m.lote, m.deposito_id`,
    sector, ...(productoId ? [productoId] : []),
  )
  const porLote = new Map<string, FilaLoteDeposito & { porDeposito: Record<string, number> }>()
  for (const f of filas) {
    const clave = `${f.producto_id}|${f.lote}`
    const l = porLote.get(clave) ?? { ...f, cantidad: 0, porDeposito: {} }
    l.cantidad += f.cantidad
    if (f.cantidad !== 0) l.porDeposito[f.deposito_id] = f.cantidad
    if (f.primera_dia < l.primera_dia) l.primera_dia = f.primera_dia
    if (f.primera < l.primera) l.primera = f.primera
    porLote.set(clave, l)
  }
  return [...porLote.values()]
    .filter((l) => l.cantidad > 0)
    .map((f) => ({ f, k: claveLote(f) }))
    .sort((a, b) =>
      a.k.dia.localeCompare(b.k.dia) || a.k.amasada - b.k.amasada || a.k.primera.localeCompare(b.k.primera) || a.f.lote.localeCompare(b.f.lote))
    .map(({ f }) => f)
}

/**
 * Para la venta en caja en un sector con lotes: de qué lotes sale `cantidad` en un depósito, el más viejo primero.
 * Lo que no alcanza a cubrir ningún lote sale sin lote (y deja el depósito en negativo).
 */
export async function repartirPorLotes(db: BaseD1, sector: SectorId, productoId: string, depositoId: string, cantidad: number) {
  const partes: { lote: string | null; cantidad: number }[] = []
  let falta = cantidad
  for (const l of await lotesConStock(db, sector, productoId)) {
    const hay = l.porDeposito[depositoId] ?? 0
    if (hay <= 0 || falta <= 0) continue
    const sale = Math.min(hay, falta)
    partes.push({ lote: l.lote, cantidad: sale })
    falta -= sale
  }
  if (falta > 0) partes.push({ lote: null, cantidad: falta })
  return partes
}

rutasStock.get('/stock', requiere('stock.ver'), async (c) => {
  const db = c.env.DB
  const sector = sectorPara(c.get('usuario'), c.req.query('sector'), true)
  const conLotes = await sectorConLotes(db, sector)

  const [productos, saldos, lotes] = await Promise.all([
    todas<{ id: string; nombre: string; activo: number }>(
      db, 'SELECT p.id, p.nombre, p.activo FROM productos p WHERE p.sector = ? ORDER BY p.orden, p.nombre', sector,
    ),
    todas<{ producto_id: string; deposito_id: string; total: number }>(
      db,
      `SELECT producto_id, deposito_id, SUM(cantidad) AS total FROM movimientos WHERE sector = ?
        GROUP BY producto_id, deposito_id HAVING SUM(cantidad) <> 0`,
      sector,
    ),
    conLotes ? lotesConStock(db, sector) : Promise.resolve([]),
  ])

  const filas: StockFila[] = productos
    .map((p) => {
      const porDeposito: Record<string, number> = {}
      for (const s of saldos) if (s.producto_id === p.id) porDeposito[s.deposito_id] = s.total
      return { p, porDeposito, total: Object.values(porDeposito).reduce((a, n) => a + n, 0) }
    })
    .filter(({ p, porDeposito }) => p.activo || Object.keys(porDeposito).length > 0)
    .map(({ p, porDeposito, total }) => ({
      productoId: p.id,
      productoNombre: p.nombre,
      activo: !!p.activo,
      total,
      porDeposito,
      lotes: lotes.filter((l) => l.producto_id === p.id).map((l) => ({ lote: l.lote, cantidad: l.cantidad, porDeposito: l.porDeposito })),
    }))
  return c.json<StockFila[]>(filas)
})

// ---------- Sacar para la venta (D02, D04): de un depósito (Frío) a Directo a Venta ----------

rutasStock.post('/salidas', requiere('stock.mover'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)
  const productoId = leerProductoId(b.productoId)
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Elegí de qué lote sale.')
  const cantidad = cantidadPositiva(b.cantidad)
  const desde = await leerDeposito(db, b.desde, DEPOSITO.frio, 'de qué depósito sale')
  const venta = await leerDeposito(db, DEPOSITO.venta, null)
  if (desde.id === venta.id) throw invalido(`Ya está en «${venta.nombre}». Elegí de qué otro depósito sale.`)
  const producto = productoDelSector(await leerProductos(db, [productoId]), productoId, sector)

  const ids = [nuevoId(), nuevoId()]
  const { fecha, dia } = ahora()
  const base = { sector, productoId, lote, tipo: 'salida_venta' as const, motivo: `De «${desde.nombre}» a «${venta.nombre}»`, usuarioId: u.id, fecha, dia }
  await conControlDeStock(
    db,
    [
      sentenciaMovimiento(db, { ...base, id: ids[0], depositoId: desde.id, cantidad: -cantidad }),
      sentenciaMovimiento(db, { ...base, id: ids[1], depositoId: venta.id, cantidad }),
    ],
    [{ sector, productoId, nombre: producto.nombre, lote, deposito: desde, sale: cantidad }],
  )
  const [m] = await movimientosEnOrden(db, [ids[0]])
  return c.json<Movimiento>(m)
})

// ---------- Envío a sucursal (D03, D04, E05): sale de «Para sucursales» ----------

rutasStock.post('/envios', requiere('stock.mover'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)

  if (vacio(b.sucursalId)) throw invalido('Elegí la sucursal.')
  const sucursalId = texto(b.sucursalId, 'la sucursal', { max: 100 })
  const sucursal = await una<{ nombre: string; activo: number }>(db, 'SELECT nombre, activo FROM sucursales WHERE id = ?', sucursalId)
  if (!sucursal) throw invalido('Esa sucursal no existe. Recargá la página y probá de nuevo.')
  if (!sucursal.activo) throw invalido(`La sucursal ${sucursal.nombre} está desactivada. Elegí otra.`)
  const deposito = await leerDeposito(db, DEPOSITO.sucursales, null)

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
      id: ids[i], sector, productoId: l.productoId, depositoId: deposito.id, lote: l.lote, tipo: 'envio', cantidad: -l.cantidad, motivo: null,
      sucursalId, envioId, usuarioId: u.id, fecha, dia,
    })),
    lineas.map((l) => ({ sector, productoId: l.productoId, nombre: l.nombre, lote: l.lote, deposito, sale: l.cantidad })),
  )
  return c.json<RespuestaEnvio>({ envioId, movimientos: await movimientosEnOrden(db, ids) })
})

// ---------- Mermas, vencimientos, ajustes y stock inicial (D06, D07) · admin ----------

rutasStock.post('/ajustes', requiere('stock.ajustar', 'Solo el administrador puede hacer esto.'), async (c) => {
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
  const deposito = await leerDeposito(db, b.depositoId, DEPOSITO.frio)
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
  const antes = await stockActual(db, sector, productoId, lote, deposito.id)
  const delta = signo * cantidad
  await conControlDeStock(
    db,
    [
      sentenciaMovimiento(db, {
        id, sector, productoId, depositoId: deposito.id, lote, tipo, cantidad: delta, motivo, usuarioId: u.id, fecha, dia,
      }),
      sentenciaAuditoria(db, {
        tabla: 'movimientos',
        registroId: id,
        accion: 'ajustar',
        usuarioId: u.id,
        antes: { sector, productoId, producto: producto.nombre, lote, deposito: deposito.nombre, stock: antes },
        despues: { sector, productoId, producto: producto.nombre, lote, deposito: deposito.nombre, stock: antes + delta, tipo, cantidad: delta, motivo },
      }),
    ],
    signo < 0 ? [{ sector, productoId, nombre: producto.nombre, lote, deposito, sale: cantidad }] : [],
  )
  const [m] = await movimientosEnOrden(db, [id])
  return c.json<Movimiento>(m)
})

// ---------- Transferencia entre depósitos · operador del sector y administrador ----------

rutasStock.post('/transferencias', requiere('stock.mover'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)
  const productoId = leerProductoId(b.productoId)
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Elegí de qué lote.')
  const cantidad = cantidadPositiva(b.cantidad)
  const desde = await leerDeposito(db, b.desde, null, 'de qué depósito sale')
  const hacia = await leerDeposito(db, b.hacia, null, 'a qué depósito va')
  if (desde.id === hacia.id) throw invalido('El depósito de origen y el de destino son el mismo. Elegí otro destino.')
  const producto = productoDelSector(await leerProductos(db, [productoId]), productoId, sector)

  // Primero sale del depósito de origen: si no alcanza, el trigger frena todo el par.
  const motivo = `De «${desde.nombre}» a «${hacia.nombre}»`
  const ids = [nuevoId(), nuevoId()]
  const { fecha, dia } = ahora()
  const base = { sector, productoId, lote, tipo: 'transferencia' as const, motivo, usuarioId: u.id, fecha, dia }
  await conControlDeStock(
    db,
    [
      sentenciaMovimiento(db, { ...base, id: ids[0], depositoId: desde.id, cantidad: -cantidad }),
      sentenciaMovimiento(db, { ...base, id: ids[1], depositoId: hacia.id, cantidad }),
    ],
    [{ sector, productoId, nombre: producto.nombre, lote, deposito: desde, sale: cantidad }],
  )
  return c.json<Movimiento[]>(await movimientosEnOrden(db, ids))
})

// ---------- Historial (D05) ----------

rutasStock.get('/movimientos', requiere('stock.ver'), async (c) => {
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
    deposito: corto(q.deposito, 'El depósito'),
    // De cada par (sacar para la venta, transferencia) se muestra la salida: su motivo dice de dónde a dónde.
    sinEntradasDePares: true,
  }))
})

