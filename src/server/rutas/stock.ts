// D01–D07: stock por depósito y envíos a sucursales (Mati, 2026-11-21). El stock es la suma del libro `movimientos`,
// por producto, depósito y (en Chipería) lote. Los depósitos no se separan por sector: el sector es de quién produce
// (y quién puede mover) cada producto. Depósitos (migraciones 0014 y 0015):
// - Venta frente (`venta`) y Venta comedor (`comedor`): lo listo para vender. Las ventas de caja descuentan de acá.
// - Almacenes (en frío; el super-administrador crea y borra) y Materia prima: lo guardado o comprado.
// - Las sucursales no son un depósito: un envío sale de un almacén y solo queda registrado lo que se mandó.
// Los productos «sin stock» (el buffet por kilo) no tienen movimientos: solo se registran sus ventas.
// «Sacar para la venta» (`POST /salidas`) pasa unidades de un almacén a un depósito de venta, y
// `POST /transferencias` las pasa entre dos depósitos cualquiera. Los dos son un par de movimientos que no cambia el total.
// El trigger `movimientos_sin_stock_negativo` (D04) rechaza cualquier salida que deje negativo un producto o un lote en
// un depósito (menos las ventas de caja), y un envío de varias líneas va en un solo `batch`: si una línea no alcanza,
// no se registra ninguna.
import { Hono } from 'hono'
import {
  DEPOSITO,
  type EnvioResumen, type Movimiento, type VendidoFila, type RespuestaEnvio, type SectorId, type StockFila, type TipoAjuste, type TipoProducto, type TipoDeposito, type TipoMovimiento,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { leerMovimientos } from '../consultas'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1, UsuarioSesion } from '../entorno'
import { conflicto, esStockInsuficiente, invalido, prohibido } from '../errores'
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
 * Depósito por id (o `porDefecto` si no viene). Tiene que existir y no estar borrado; con `tipo`, ser de ese tipo.
 * `campo`: «el depósito», «de qué depósito sale»…
 */
export async function leerDeposito(
  db: BaseD1, v: unknown, porDefecto: string | null, campo = 'el depósito', tipo?: TipoDeposito,
): Promise<DepositoElegido> {
  if (vacio(v) && !porDefecto) throw invalido(`Elegí ${campo}.`)
  const id = vacio(v) ? porDefecto! : texto(v, campo, { max: 100 })
  const f = await una<{ id: string; nombre: string; activo: number; tipo: TipoDeposito }>(
    db, 'SELECT id, nombre, activo, tipo FROM depositos WHERE id = ?', id,
  )
  if (!f) throw invalido('Ese depósito no existe. Recargá la página y probá de nuevo.')
  if (!f.activo) throw invalido(`El depósito ${f.nombre} ya no existe. Elegí otro.`)
  if (tipo && f.tipo !== tipo) {
    throw invalido(tipo === 'venta' ? `«${f.nombre}» no es un depósito de venta. Elegí Venta frente o Venta comedor.` : `«${f.nombre}» no es un depósito frío. Elegí uno.`)
  }
  return { id: f.id, nombre: f.nombre }
}

/**
 * Un depósito de venta directa admite solo los productos de sus categorías (Mati, 2026-11-21): por ejemplo, el buffet
 * va a Venta comedor y no a Venta frente. Los productos sin categoría cuentan como «Otros». Los fríos admiten todo.
 */
export async function controlarCategoria(db: BaseD1, deposito: DepositoElegido, producto: { id: string; nombre: string }) {
  const f = await una<{ tipo: TipoDeposito; admite: number; categoria: string | null }>(
    db,
    `SELECT d.tipo,
            EXISTS (SELECT 1 FROM deposito_categorias dc WHERE dc.deposito_id = d.id
                       AND dc.categoria_id = COALESCE(p.categoria_id, (SELECT id FROM categorias WHERE sistema = 1 ORDER BY orden LIMIT 1))) AS admite,
            c.nombre AS categoria
       FROM depositos d, productos p LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE d.id = ? AND p.id = ?`,
    deposito.id, producto.id,
  )
  if (f && f.tipo === 'venta' && !f.admite) {
    throw invalido(
      `«${deposito.nombre}» no recibe productos de la categoría ${f.categoria ?? 'Otros'}, así que ${producto.nombre} no va ahí. ` +
      'Elegí otro depósito, o pedile al administrador que sume esa categoría al depósito.',
    )
  }
}

/** El almacén que se usa si no se elige otro: Frío, o el primero que quede. */
export async function almacenPorDefecto(db: BaseD1): Promise<string> {
  const f = await una<{ id: string }>(
    db, "SELECT id FROM depositos WHERE tipo = 'almacen' AND activo = 1 AND id <> ? ORDER BY id = ? DESC, orden LIMIT 1",
    DEPOSITO.materiaPrima, DEPOSITO.frio,
  )
  return f?.id ?? DEPOSITO.frio
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
  sin_stock: number
  tipo: TipoProducto
}

async function leerProductos(db: BaseD1, ids: string[]): Promise<Map<string, FilaProducto>> {
  const unicos = [...new Set(ids)]
  const filas = await todasPorTrozos<FilaProducto>(db, unicos, (m) => `SELECT id, sector, nombre, activo, sin_stock, tipo FROM productos WHERE id IN (${m})`)
  return new Map(filas.map((f) => [f.id, f]))
}

/**
 * Producto a mover: tiene que existir, llevar stock y ser del sector del operador (o del `sector` pedido). El movimiento
 * va con el sector del producto. Se aceptan desactivados: puede quedarles stock.
 */
function productoParaMover(productos: Map<string, FilaProducto>, id: string, u: UsuarioSesion, sectorPedido: SectorId | null): FilaProducto {
  const p = productos.get(id)
  if (!p) throw invalido('Ese producto no existe. Recargá la página y probá de nuevo.')
  const sector = u.sector ?? sectorPedido
  if (sector && p.sector !== sector) throw prohibido(`${p.nombre} es de otro sector: lo mueve ese sector o el administrador.`)
  if (p.sin_stock) throw invalido(`${p.nombre} no lleva stock: solo se registran sus ventas.`)
  return p
}

/** El `sector` del pedido, si vino (un operador solo puede pedir el suyo). */
const sectorPedidoDe = (u: UsuarioSesion, v: unknown) => (vacio(v) ? null : sectorPara(u, v))

function leerProductoId(v: unknown): string {
  if (vacio(v)) throw invalido('Elegí el producto.')
  return texto(v, 'el producto', { max: 100 })
}

/**
 * Lote: en sectores sin lotes se ignora; en Chipería es obligatorio (`siFalta` = mensaje) para lo que se elabora. La
 * materia prima y la venta directa de Chipería pueden no tener lote (se compraron sin número).
 * Se guarda sin espacios y en mayúsculas, así un lote escrito "ch-261009-1 " encuentra su stock.
 */
function leerLote(v: unknown, conLotes: boolean, siFalta: string, producto?: { tipo: TipoProducto }): string | null {
  if (!conLotes) return null
  if (vacio(v)) {
    if (producto && producto.tipo !== 'elaborado') return null
    throw invalido(siFalta)
  }
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
          ? ` En ${otros.map((o) => `«${o.nombre}» hay ${o.total}`).join(' y en ')}: pasalo con «Transferir» en Depósitos si querés usarlo.`
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

/**
 * Stock por producto y depósito. Sin `sector` (o con `todos=1`), el de todos los productos: los depósitos no se separan
 * por sector. Con `sector`, solo los de ese sector (lo que un operador puede mover). Los productos «sin stock» no van.
 */
rutasStock.get('/stock', requiere('stock.ver'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const q = c.req.query()
  // Sin sector, todos los productos: los depósitos no se separan por sector (Mati, 2026-11-21).
  const sector = q.todos === '1' || vacio(q.sector) ? null : sectorPara(u, q.sector)

  const [productos, saldos, sectoresConLotes] = await Promise.all([
    todas<{ id: string; nombre: string; activo: number; sector: SectorId; categoria_id: string | null; subcategoria: string; unidad: string }>(
      db,
      `SELECT p.id, p.nombre, p.activo, p.sector, p.categoria_id, p.subcategoria, p.unidad
         FROM productos p JOIN sectores s ON s.id = p.sector
        WHERE p.sin_stock = 0 ${sector ? 'AND p.sector = ?' : ''}
        ORDER BY s.orden, p.orden, p.nombre`,
      ...(sector ? [sector] : []),
    ),
    todas<{ producto_id: string; deposito_id: string; total: number }>(
      db,
      `SELECT producto_id, deposito_id, SUM(cantidad) AS total FROM movimientos ${sector ? 'WHERE sector = ?' : ''}
        GROUP BY producto_id, deposito_id HAVING SUM(cantidad) <> 0`,
      ...(sector ? [sector] : []),
    ),
    todas<{ id: SectorId }>(db, `SELECT id FROM sectores WHERE con_lotes = 1 ${sector ? 'AND id = ?' : ''}`, ...(sector ? [sector] : [])),
  ])
  const lotes = (await Promise.all(sectoresConLotes.map((x) => lotesConStock(db, x.id)))).flat()

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
      sector: p.sector,
      categoriaId: p.categoria_id,
      subcategoria: p.subcategoria,
      unidad: p.unidad,
      activo: !!p.activo,
      total,
      porDeposito,
      lotes: lotes.filter((l) => l.producto_id === p.id).map((l) => ({ lote: l.lote, cantidad: l.cantidad, porDeposito: l.porDeposito })),
    }))
  return c.json<StockFila[]>(filas)
})

/**
 * Lo vendido por producto y depósito de venta en un período (por defecto, hoy). Por ahora todas las ventas son de la
 * caja del frente (Venta frente). Incluye los productos «sin stock» (el buffet), que solo registran ventas.
 */
rutasStock.get('/stock/vendido', requiere('stock.ver'), async (c) => {
  const q = c.req.query()
  const hoy = ahora().dia
  const desde = diaOpcional(q.desde, 'La fecha desde') ?? hoy
  const hasta = diaOpcional(q.hasta, 'La fecha hasta') ?? hoy
  if (desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  const filas = await todas<{ producto_id: string; producto_nombre: string; cantidad: number }>(
    c.env.DB,
    `SELECT i.producto_id, p.nombre AS producto_nombre, SUM(i.cantidad) AS cantidad
       FROM venta_items i JOIN ventas v ON v.id = i.venta_id JOIN productos p ON p.id = i.producto_id
      WHERE v.anulada_en IS NULL AND v.dia >= ? AND v.dia <= ?
      GROUP BY i.producto_id`,
    desde, hasta,
  )
  return c.json<VendidoFila[]>(filas.map((f) => ({
    productoId: f.producto_id, productoNombre: f.producto_nombre, depositoId: DEPOSITO.venta, cantidad: f.cantidad,
  })))
})

/** Sucursales: no tienen stock en el sistema; solo se registra lo que se les envió (por sucursal y producto). */
rutasStock.get('/envios', requiere('stock.ver'), async (c) => {
  const q = c.req.query()
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  const filas = await todas<{ sucursal_id: string; sucursal_nombre: string; producto_id: string; producto_nombre: string; cantidad: number; envios: number; ultimo: string }>(
    c.env.DB,
    `SELECT m.sucursal_id, su.nombre AS sucursal_nombre, m.producto_id, p.nombre AS producto_nombre, -SUM(m.cantidad) AS cantidad,
            COUNT(DISTINCT m.envio_id) AS envios, MAX(m.dia) AS ultimo
       FROM movimientos m JOIN sucursales su ON su.id = m.sucursal_id JOIN productos p ON p.id = m.producto_id
      WHERE m.tipo = 'envio' ${desde ? 'AND m.dia >= ?' : ''} ${hasta ? 'AND m.dia <= ?' : ''}
      GROUP BY m.sucursal_id, m.producto_id
      ORDER BY su.nombre, p.nombre`,
    ...(desde ? [desde] : []), ...(hasta ? [hasta] : []),
  )
  return c.json<EnvioResumen[]>(filas.map((f) => ({
    sucursalId: f.sucursal_id, sucursalNombre: f.sucursal_nombre, productoId: f.producto_id, productoNombre: f.producto_nombre,
    cantidad: f.cantidad, envios: f.envios, ultimo: f.ultimo,
  })))
})

// ---------- Sacar para la venta (D02, D04): de un almacén a Venta frente (o Venta comedor) ----------

rutasStock.post('/salidas', requiere('stock.mover'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const productoId = leerProductoId(b.productoId)
  const producto = productoParaMover(await leerProductos(db, [productoId]), productoId, u, sectorPedidoDe(u, b.sector))
  const sector = producto.sector
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Elegí de qué lote sale.', producto)
  const cantidad = cantidadPositiva(b.cantidad)
  const desde = await leerDeposito(db, b.desde, await almacenPorDefecto(db), 'de qué depósito sale', 'almacen')
  const venta = await leerDeposito(db, b.hacia, DEPOSITO.venta, 'a qué venta va', 'venta')
  if (desde.id === venta.id) throw invalido(`Ya está en «${venta.nombre}». Elegí de qué otro depósito sale.`)
  await controlarCategoria(db, venta, producto)

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

// ---------- Envío a sucursal (D03, D04, E05): sale de un almacén (Frío si no se elige otro) ----------

rutasStock.post('/envios', requiere('stock.mover'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sectorPedido = sectorPedidoDe(u, b.sector)

  if (vacio(b.sucursalId)) throw invalido('Elegí la sucursal.')
  const sucursalId = texto(b.sucursalId, 'la sucursal', { max: 100 })
  const sucursal = await una<{ nombre: string; activo: number }>(db, 'SELECT nombre, activo FROM sucursales WHERE id = ?', sucursalId)
  if (!sucursal) throw invalido('Esa sucursal no existe. Recargá la página y probá de nuevo.')
  if (!sucursal.activo) throw invalido(`La sucursal ${sucursal.nombre} está desactivada. Elegí otra.`)
  const deposito = await leerDeposito(db, b.desde, await almacenPorDefecto(db), 'de qué depósito sale', 'almacen')

  if (!Array.isArray(b.items) || b.items.length === 0) throw invalido('Cargá al menos un producto para enviar.')
  if (b.items.length > MAX_LINEAS_ENVIO) throw invalido('Son demasiados productos en un solo envío.')
  const crudos = (b.items as unknown[]).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
  const productos = await leerProductos(db, crudos.map((it) => leerProductoId(it.productoId)))
  const sectoresConLotes = new Set((await todas<{ id: SectorId }>(db, 'SELECT id FROM sectores WHERE con_lotes = 1')).map((x) => x.id))

  const vistos = new Set<string>()
  const lineas = crudos.map((it) => {
    const productoId = leerProductoId(it.productoId)
    const producto = productoParaMover(productos, productoId, u, sectorPedido)
    const sector = producto.sector
    const lote = leerLote(it.lote, sectoresConLotes.has(sector), `Elegí el lote de ${producto.nombre}.`, producto)
    const cantidad = cantidadPositiva(it.cantidad, `La cantidad de ${producto.nombre}`)
    const clave = `${productoId}|${lote ?? ''}`
    if (vistos.has(clave)) {
      throw invalido(`${producto.nombre}${enLote(lote)} está repetido en el envío: juntá las cantidades en una sola línea.`)
    }
    vistos.add(clave)
    return { sector, productoId, nombre: producto.nombre, lote, cantidad }
  })

  const envioId = nuevoId()
  const { fecha, dia } = ahora()
  const ids = lineas.map(() => nuevoId())
  await conControlDeStock(
    db,
    lineas.map((l, i) => sentenciaMovimiento(db, {
      id: ids[i], sector: l.sector, productoId: l.productoId, depositoId: deposito.id, lote: l.lote, tipo: 'envio', cantidad: -l.cantidad, motivo: null,
      sucursalId, envioId, usuarioId: u.id, fecha, dia,
    })),
    lineas.map((l) => ({ sector: l.sector, productoId: l.productoId, nombre: l.nombre, lote: l.lote, deposito, sale: l.cantidad })),
  )
  return c.json<RespuestaEnvio>({ envioId, movimientos: await movimientosEnOrden(db, ids) })
})

// ---------- Mermas, vencimientos, ajustes y stock inicial (D06, D07) · admin ----------

rutasStock.post('/ajustes', requiere('stock.ajustar', 'Solo el administrador puede hacer esto.'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  if (vacio(b.tipo)) throw invalido('Elegí si es merma, vencimiento, ajuste o stock inicial.')
  if (!(TIPOS_AJUSTE as readonly unknown[]).includes(b.tipo)) throw invalido('El tipo de ajuste no es válido.')
  const tipo = b.tipo as TipoAjuste
  const productoId = leerProductoId(b.productoId)
  const producto = productoParaMover(await leerProductos(db, [productoId]), productoId, u, sectorPedidoDe(u, b.sector))
  const sector = producto.sector
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Indicá el lote.', producto)
  const cantidad = cantidadPositiva(b.cantidad)
  const deposito = await leerDeposito(db, b.depositoId, await almacenPorDefecto(db))
  let signo: 1 | -1
  if (tipo === 'ajuste') {
    if (b.sentido !== 1 && b.sentido !== -1) throw invalido('Elegí si el ajuste suma o resta.')
    signo = b.sentido
  } else {
    signo = tipo === 'stock_inicial' ? 1 : -1
  }
  if (vacio(b.motivo) || (typeof b.motivo === 'string' && !b.motivo.trim())) throw invalido('Escribí el motivo.')
  const motivo = texto(b.motivo, 'El motivo', { max: 300 })

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
  const productoId = leerProductoId(b.productoId)
  const producto = productoParaMover(await leerProductos(db, [productoId]), productoId, u, sectorPedidoDe(u, b.sector))
  const sector = producto.sector
  const conLotes = await sectorConLotes(db, sector)
  const lote = leerLote(b.lote, conLotes, 'Elegí de qué lote.', producto)
  const cantidad = cantidadPositiva(b.cantidad)
  const desde = await leerDeposito(db, b.desde, null, 'de qué depósito sale')
  const hacia = await leerDeposito(db, b.hacia, null, 'a qué depósito va')
  if (desde.id === hacia.id) throw invalido('El depósito de origen y el de destino son el mismo. Elegí otro destino.')
  await controlarCategoria(db, hacia, producto)

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
  const sector = q.todos === '1' ? null : sectorPara(c.get('usuario'), q.sector)
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

