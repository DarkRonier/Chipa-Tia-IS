// M10: proveedores, compras y pagos a proveedores.
// - Proveedores: los cargan y editan el administrador y el supervisor. Los sectores solo los eligen al cargar una compra.
// - Compras: con fecha, comprobante, detalle, importe y vencimiento. Cada renglón con producto suma a su stock (tipo
//   'compra' en el libro de movimientos, en el sector del producto). El administrador y el supervisor compran
//   cualquier producto y pueden agregar renglones de texto libre (flete, servicio…), que no tocan el stock. Un sector
//   compra solo productos de su sector cuya categoría el administrador habilitó para ese sector.
// - Pagos: parciales o totales. Solo el administrador y el supervisor los marcan; nunca superan el saldo (trigger
//   `pagos_proveedor_sin_exceso`). La compra queda pendiente, con pago parcial o pagada según lo pagado.
// - Anular: una compra sin pagos se anula y su stock se descuenta; un pago se anula y vuelve a quedar como saldo.
import { Hono } from 'hono'
import type { Alerta } from '../../shared/alertas'
import { diaLegible, sumarDias } from '../../shared/hora'
import { puede } from '../../shared/permisos'
import {
  MEDIOS_PAGO, NOMBRE_MEDIO_PAGO,
  type Compra, type CompraItem, type CuentaProveedor, type EstadoCompra, type MedioPago, type PagoProveedor, type ProductoCompra,
  type Proveedor, type ReporteCompras, type SectorId,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1, UsuarioSesion, ValorSQL } from '../entorno'
import { conflicto, esStockInsuficiente, invalido, noEncontrado, prohibido } from '../errores'
import { esSector, requiere } from '../sesion'
import { booleano, cuerpo, dia, diaOpcional, texto, textoOpcional } from '../validar'

export const rutasCompras = new Hono<Entorno>()

const MAX_RENGLONES = 100
const MAX_PRECIO = 1_000_000_000
const MAX_CANTIDAD = 1_000_000
const MAX_COMPRAS = 500
const SOLO_PAGOS = 'Los pagos a proveedores los marcan el supervisor o el administrador.'

const vacio = (v: unknown) => v === undefined || v === null || v === ''
const igualNombre = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0
const guaranies = (n: number) => `Gs. ${Math.round(n).toLocaleString('es-PY')}`

/** Lanza 400 si el cuerpo de un PATCH no trae ninguno de los campos editables. */
function algoParaCambiar(b: Record<string, unknown>, campos: string[]) {
  if (!campos.some((k) => b[k] !== undefined)) throw invalido('No hay nada para cambiar.')
}

/** Importe en guaraníes: entero ≥ `min`. */
function importe(v: unknown, campo: string, min = 0): number {
  if (vacio(v)) throw invalido(`Falta ${campo}.`)
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalido(`${campo[0].toUpperCase()}${campo.slice(1)} tiene que ser un número entero de guaraníes.`)
  if (v < min) throw invalido(min > 0 ? `${campo[0].toUpperCase()}${campo.slice(1)} tiene que ser mayor que cero.` : `${campo[0].toUpperCase()}${campo.slice(1)} no puede ser negativo.`)
  if (v > MAX_PRECIO * 1000) throw invalido(`${campo[0].toUpperCase()}${campo.slice(1)} es demasiado grande.`)
  return v
}

function medio(v: unknown): MedioPago {
  if (vacio(v)) throw invalido('Elegí el medio de pago.')
  if (!(MEDIOS_PAGO as unknown[]).includes(v)) throw invalido('El medio de pago no es válido.')
  return v as MedioPago
}

/** Fecha que no puede ser posterior a hoy. Vacía = hoy. */
function diaHastaHoy(v: unknown, campo: string, hoy: string): string {
  const d = diaOpcional(v, campo) ?? hoy
  if (d > hoy) throw invalido(`${campo} no puede ser posterior a hoy.`)
  return d
}

// ---------- Proveedores ----------

interface FilaProveedor {
  id: string
  nombre: string
  ruc: string
  telefono: string
  notas: string
  activo: number
  saldo?: number
}

const aProveedor = (f: FilaProveedor, conSaldo: boolean): Proveedor => ({
  id: f.id, nombre: f.nombre, ruc: f.ruc, telefono: f.telefono, notas: f.notas, activo: !!f.activo,
  saldo: conSaldo ? f.saldo ?? 0 : null,
})

/** Lo que se debe de cada compra sin anular: total menos pagos sin anular. */
const SQL_SALDO_COMPRA = `(c.total - COALESCE((SELECT SUM(g.importe) FROM pagos_proveedor g WHERE g.compra_id = c.id AND g.anulado_en IS NULL), 0))`

const SQL_PROVEEDOR = `SELECT p.id, p.nombre, p.ruc, p.telefono, p.notas, p.activo,
    COALESCE((SELECT SUM(${SQL_SALDO_COMPRA}) FROM compras c WHERE c.proveedor_id = p.id AND c.anulada_en IS NULL), 0) AS saldo
  FROM proveedores p`

async function leerProveedor(db: BaseD1, id: string): Promise<FilaProveedor> {
  const f = await una<FilaProveedor>(db, `${SQL_PROVEEDOR} WHERE p.id = ?`, id)
  if (!f) throw noEncontrado('No se encontró ese proveedor.')
  return f
}

async function proveedorSinRepetir(db: BaseD1, nombre: string, propio: string | null) {
  const otro = (await todas<FilaProveedor>(db, 'SELECT id, nombre, activo FROM proveedores')).find((p) => p.id !== propio && igualNombre(p.nombre, nombre))
  if (!otro) return
  throw conflicto(
    'nombre_repetido',
    otro.activo ? `Ya hay un proveedor «${otro.nombre}».` : `Ya hay un proveedor «${otro.nombre}», desactivado. Activalo en vez de crear otro.`,
  )
}

const puedeVerProveedores = (u: UsuarioSesion) => puede(u.rol, 'compras.registrar') || puede(u.rol, 'proveedores.gestionar')

rutasCompras.get('/proveedores', async (c) => {
  const u = c.get('usuario')
  if (!puedeVerProveedores(u)) throw prohibido()
  const gestiona = puede(u.rol, 'proveedores.gestionar')
  const todos = gestiona && ['1', 'true'].includes(c.req.query('todos') ?? '')
  const filas = await todas<FilaProveedor>(db(c), `${SQL_PROVEEDOR} ${todos ? '' : 'WHERE p.activo = 1'}`)
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return c.json<Proveedor[]>(filas.map((f) => aProveedor(f, puede(u.rol, 'compras.pagar'))))
})

function datosProveedor(b: Record<string, unknown>, antes?: Proveedor) {
  return {
    nombre: b.nombre !== undefined ? texto(b.nombre, 'el nombre del proveedor', { max: 100 }) : antes!.nombre,
    ruc: b.ruc !== undefined ? textoOpcional(b.ruc, 'El RUC', 30) ?? '' : antes?.ruc ?? '',
    telefono: b.telefono !== undefined ? textoOpcional(b.telefono, 'El teléfono', 40) ?? '' : antes?.telefono ?? '',
    notas: b.notas !== undefined ? textoOpcional(b.notas, 'Las notas', 300) ?? '' : antes?.notas ?? '',
  }
}

rutasCompras.post('/proveedores', requiere('proveedores.gestionar', 'Los proveedores los cargan el supervisor o el administrador.'), async (c) => {
  const b = await cuerpo(c)
  const base = db(c)
  const d = datosProveedor(b)
  await proveedorSinRepetir(base, d.nombre, null)
  const nuevo: Proveedor = { id: nuevoId(), ...d, activo: true, saldo: 0 }
  await base.batch([
    sentencia(base, 'INSERT INTO proveedores (id, nombre, ruc, telefono, notas, activo, creado_en) VALUES (?, ?, ?, ?, ?, 1, ?)',
      nuevo.id, d.nombre, d.ruc, d.telefono, d.notas, ahora().fecha),
    sentenciaAuditoria(base, { tabla: 'proveedores', registroId: nuevo.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nuevo }),
  ])
  return c.json<Proveedor>(nuevo)
})

rutasCompras.patch('/proveedores/:id', requiere('proveedores.gestionar', 'Los proveedores los editan el supervisor o el administrador.'), async (c) => {
  const b = await cuerpo(c)
  const base = db(c)
  algoParaCambiar(b, ['nombre', 'ruc', 'telefono', 'notas', 'activo'])
  const antes = aProveedor(await leerProveedor(base, c.req.param('id')), true)
  const despues: Proveedor = { ...antes, ...datosProveedor(b, antes) }
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  if (despues.nombre !== antes.nombre) await proveedorSinRepetir(base, despues.nombre, antes.id)
  await base.batch([
    sentencia(base, 'UPDATE proveedores SET nombre = ?, ruc = ?, telefono = ?, notas = ?, activo = ? WHERE id = ?',
      despues.nombre, despues.ruc, despues.telefono, despues.notas, despues.activo, antes.id),
    sentenciaAuditoria(base, {
      tabla: 'proveedores', registroId: antes.id,
      accion: antes.activo && !despues.activo ? 'desactivar' : !antes.activo && despues.activo ? 'activar' : 'editar',
      usuarioId: c.get('usuario').id, antes, despues,
    }),
  ])
  return c.json<Proveedor>(despues)
})

// Historial de saldos de un proveedor: cada compra suma y cada pago resta.
rutasCompras.get('/proveedores/:id/cuenta', requiere('compras.pagar', SOLO_PAGOS), async (c) => {
  const base = db(c)
  const proveedor = aProveedor(await leerProveedor(base, c.req.param('id')), true)
  const [compras, pagos] = await Promise.all([
    todas<{ id: string; dia_compra: string; fecha: string; comprobante: string; total: number; renglones: number }>(
      base,
      `SELECT c.id, c.dia_compra, c.fecha, c.comprobante, c.total, (SELECT COUNT(*) FROM compra_items i WHERE i.compra_id = c.id) AS renglones
         FROM compras c WHERE c.proveedor_id = ? AND c.anulada_en IS NULL`,
      proveedor.id,
    ),
    todas<{ id: string; compra_id: string; dia_pago: string; fecha: string; comprobante: string; importe: number; medio: MedioPago }>(
      base,
      `SELECT g.id, g.compra_id, g.dia_pago, g.fecha, c.comprobante, g.importe, g.medio
         FROM pagos_proveedor g JOIN compras c ON c.id = g.compra_id
        WHERE g.proveedor_id = ? AND g.anulado_en IS NULL AND c.anulada_en IS NULL`,
      proveedor.id,
    ),
  ])
  const eventos = [
    ...compras.map((x) => ({
      tipo: 'compra' as const, id: x.id, compraId: x.id, dia: x.dia_compra, fecha: x.fecha, comprobante: x.comprobante,
      detalle: `Compra${x.comprobante ? ` ${x.comprobante}` : ''} (${x.renglones} ${x.renglones === 1 ? 'renglón' : 'renglones'})`,
      importe: x.total,
    })),
    ...pagos.map((x) => ({
      tipo: 'pago' as const, id: x.id, compraId: x.compra_id, dia: x.dia_pago, fecha: x.fecha, comprobante: x.comprobante,
      detalle: `Pago en ${NOMBRE_MEDIO_PAGO[x.medio].toLowerCase()}${x.comprobante ? ` de la compra ${x.comprobante}` : ''}`,
      importe: x.importe,
    })),
  ].sort((a, b) => a.dia.localeCompare(b.dia) || (a.tipo === b.tipo ? 0 : a.tipo === 'compra' ? -1 : 1) || a.fecha.localeCompare(b.fecha))
  let saldo = 0
  const movimientos = eventos.map((e) => {
    saldo += e.tipo === 'compra' ? e.importe : -e.importe
    return { ...e, saldo }
  })
  const totalComprado = compras.reduce((s, x) => s + x.total, 0)
  const totalPagado = pagos.reduce((s, x) => s + x.importe, 0)
  return c.json<CuentaProveedor>({ proveedor, totalComprado, totalPagado, saldo: totalComprado - totalPagado, movimientos })
})

// ---------- Productos que se pueden comprar ----------

interface FilaProductoCompra {
  id: string
  nombre: string
  unidad: string
  sector: SectorId
  sector_nombre: string
  con_lotes: number
  activo: number
  categoria_id: string | null
  categoria_nombre: string | null
  /** 1 si la categoría está activa y habilitada para el sector de quien compra (o si compra admin/supervisor). */
  habilitado: number
}

/**
 * Productos que `u` puede comprar. Un sector: los activos de su sector cuya categoría (activa) habilitó el
 * administrador para ese sector. Administrador y supervisor: todos los productos activos.
 */
async function productosComprables(base: BaseD1, u: UsuarioSesion, ids?: string[]): Promise<FilaProductoCompra[]> {
  const sql = `SELECT p.id, p.nombre, p.unidad, p.sector, s.nombre AS sector_nombre, s.con_lotes, p.activo, p.categoria_id,
        k.nombre AS categoria_nombre,
        ${u.sector
          ? `CASE WHEN p.sector = ? AND k.activo = 1 AND EXISTS (
               SELECT 1 FROM categorias_sectores x WHERE x.categoria_id = p.categoria_id AND x.sector = ?) THEN 1 ELSE 0 END`
          : '1'} AS habilitado
      FROM productos p
      JOIN sectores s ON s.id = p.sector
      LEFT JOIN categorias k ON k.id = p.categoria_id`
  const params: ValorSQL[] = u.sector ? [u.sector, u.sector] : []
  if (ids) {
    if (!ids.length) return []
    return todas<FilaProductoCompra>(base, `${sql} WHERE p.id IN (SELECT value FROM json_each(?))`, ...params, JSON.stringify([...new Set(ids)]))
  }
  const filas = await todas<FilaProductoCompra>(base, `${sql} WHERE p.activo = 1 ORDER BY s.orden, k.orden, p.orden, p.nombre`, ...params)
  return filas.filter((f) => f.habilitado)
}

rutasCompras.get('/compras/productos', requiere('compras.registrar'), async (c) => {
  const filas = await productosComprables(db(c), c.get('usuario'))
  return c.json<ProductoCompra[]>(filas.map((f) => ({
    id: f.id, nombre: f.nombre, unidad: f.unidad, sector: f.sector, sectorNombre: f.sector_nombre, conLotes: !!f.con_lotes,
    categoriaId: f.categoria_id, categoriaNombre: f.categoria_nombre,
  })))
})

// ---------- Lectura de compras ----------

interface FilaCompra {
  id: string
  proveedor_id: string
  proveedor_nombre: string
  sector: SectorId | null
  comprobante: string
  dia_compra: string
  vencimiento: string | null
  total: number
  pagado: number
  nota: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  anulada_en: string | null
  anulada_por_nombre: string | null
  motivo_anulacion: string | null
}

interface FilaItem {
  id: string
  compra_id: string
  producto_id: string | null
  producto_nombre: string | null
  sector: SectorId | null
  detalle: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  lote: string | null
}

interface FilaPago {
  id: string
  compra_id: string
  proveedor_id: string
  proveedor_nombre: string
  comprobante: string
  dia_pago: string
  importe: number
  medio: MedioPago
  nota: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  anulado_en: string | null
  motivo_anulacion: string | null
}

const SQL_COMPRA = `SELECT c.id, c.proveedor_id, p.nombre AS proveedor_nombre, c.sector, c.comprobante, c.dia_compra, c.vencimiento,
    c.total, COALESCE((SELECT SUM(g.importe) FROM pagos_proveedor g WHERE g.compra_id = c.id AND g.anulado_en IS NULL), 0) AS pagado,
    c.nota, c.usuario_id, u.nombre AS usuario_nombre, c.fecha, c.anulada_en, a.nombre AS anulada_por_nombre, c.motivo_anulacion
  FROM compras c
  JOIN proveedores p ON p.id = c.proveedor_id
  JOIN usuarios u ON u.id = c.usuario_id
  LEFT JOIN usuarios a ON a.id = c.anulada_por`

const SQL_PAGO = `SELECT g.id, g.compra_id, g.proveedor_id, p.nombre AS proveedor_nombre, c.comprobante, g.dia_pago, g.importe, g.medio,
    g.nota, g.usuario_id, u.nombre AS usuario_nombre, g.fecha, g.anulado_en, g.motivo_anulacion
  FROM pagos_proveedor g
  JOIN compras c ON c.id = g.compra_id
  JOIN proveedores p ON p.id = g.proveedor_id
  JOIN usuarios u ON u.id = g.usuario_id`

export const aPago = (f: FilaPago): PagoProveedor => ({
  id: f.id, compraId: f.compra_id, proveedorId: f.proveedor_id, proveedorNombre: f.proveedor_nombre, comprobante: f.comprobante,
  diaPago: f.dia_pago, importe: f.importe, medio: f.medio, nota: f.nota, usuarioId: f.usuario_id, usuarioNombre: f.usuario_nombre,
  fecha: f.fecha, anulado: f.anulado_en !== null, motivoAnulacion: f.motivo_anulacion,
})

function estadoDe(f: Pick<FilaCompra, 'anulada_en' | 'total' | 'pagado'>): EstadoCompra {
  if (f.anulada_en) return 'anulada'
  if (f.pagado >= f.total) return 'pagada'
  return f.pagado > 0 ? 'parcial' : 'pendiente'
}

function aCompra(f: FilaCompra, items: FilaItem[], hoy: string): Compra {
  const estado = estadoDe(f)
  const saldo = estado === 'anulada' ? 0 : f.total - f.pagado
  return {
    id: f.id,
    proveedorId: f.proveedor_id,
    proveedorNombre: f.proveedor_nombre,
    sector: f.sector,
    comprobante: f.comprobante,
    diaCompra: f.dia_compra,
    vencimiento: f.vencimiento,
    total: f.total,
    pagado: f.pagado,
    saldo,
    estado,
    vencida: saldo > 0 && f.vencimiento !== null && f.vencimiento < hoy,
    nota: f.nota,
    usuarioId: f.usuario_id,
    usuarioNombre: f.usuario_nombre,
    fecha: f.fecha,
    anuladaEn: f.anulada_en,
    anuladaPorNombre: f.anulada_por_nombre,
    motivoAnulacion: f.motivo_anulacion,
    items: items.filter((i) => i.compra_id === f.id).map((i): CompraItem => ({
      id: i.id, productoId: i.producto_id, productoNombre: i.producto_nombre, sector: i.sector, detalle: i.detalle,
      cantidad: i.cantidad, precioUnitario: i.precio_unitario, subtotal: i.subtotal, lote: i.lote,
    })),
  }
}

export interface FiltroCompras {
  ids?: string[]
  /** Sector que la cargó. */
  sector?: SectorId | null
  desde?: string | null
  hasta?: string | null
  proveedor?: string | null
  estados?: EstadoCompra[]
}

export async function leerCompras(base: BaseD1, filtro: FiltroCompras = {}): Promise<Compra[]> {
  const partes: string[] = []
  const params: ValorSQL[] = []
  const si = (cond: boolean, sql: string, ...ps: ValorSQL[]) => {
    if (!cond) return
    partes.push(sql)
    params.push(...ps)
  }
  if (filtro.ids) {
    if (!filtro.ids.length) return []
    si(true, 'c.id IN (SELECT value FROM json_each(?))', JSON.stringify(filtro.ids))
  }
  si(!!filtro.sector, 'c.sector = ?', filtro.sector ?? null)
  si(!!filtro.desde, 'c.dia_compra >= ?', filtro.desde ?? null)
  si(!!filtro.hasta, 'c.dia_compra <= ?', filtro.hasta ?? null)
  si(!!filtro.proveedor, 'c.proveedor_id = ?', filtro.proveedor ?? null)
  const where = partes.length ? `WHERE ${partes.join(' AND ')}` : ''
  let filas = await todas<FilaCompra>(base, `${SQL_COMPRA} ${where} ORDER BY c.dia_compra DESC, c.fecha DESC LIMIT ?`, ...params, MAX_COMPRAS * 4)
  if (filtro.estados?.length) filas = filas.filter((f) => filtro.estados!.includes(estadoDe(f)))
  filas = filas.slice(0, MAX_COMPRAS)
  const items = await todasPorTrozos<FilaItem>(
    base, filas.map((f) => f.id),
    (m) => `SELECT i.id, i.compra_id, i.producto_id, p.nombre AS producto_nombre, p.sector, i.detalle, i.cantidad, i.precio_unitario,
                   i.subtotal, i.lote
              FROM compra_items i LEFT JOIN productos p ON p.id = i.producto_id
             WHERE i.compra_id IN (${m}) ORDER BY i.orden`,
  )
  const hoy = ahora().dia
  return filas.map((f) => aCompra(f, items, hoy))
}

async function leerPagos(base: BaseD1, where: string, ...params: ValorSQL[]): Promise<PagoProveedor[]> {
  return (await todas<FilaPago>(base, `${SQL_PAGO} ${where} ORDER BY g.dia_pago DESC, g.fecha DESC`, ...params)).map(aPago)
}

/** Detalle de una compra. Un sector solo ve las que cargó; los pagos, solo quien los marca. */
async function compraVisible(base: BaseD1, u: UsuarioSesion, id: string): Promise<Compra> {
  const [compra] = await leerCompras(base, { ids: [id] })
  if (!compra || (u.sector && compra.sector !== u.sector)) throw noEncontrado('No se encontró esa compra.')
  if (puede(u.rol, 'compras.pagar')) compra.pagos = await leerPagos(base, 'WHERE g.compra_id = ?', id)
  return compra
}

const ESTADOS: EstadoCompra[] = ['pendiente', 'parcial', 'pagada', 'anulada']

rutasCompras.get('/compras', requiere('compras.registrar'), async (c) => {
  const u = c.get('usuario')
  const q = c.req.query()
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  const estados = (q.estado ?? '').split(',').map((e) => e.trim()).filter(Boolean)
  if (!estados.every((e) => (ESTADOS as string[]).includes(e))) throw invalido('El estado no es válido.')
  let sector: SectorId | null = null
  if (u.sector) {
    if (!vacio(q.sector) && q.sector !== u.sector) throw prohibido('Solo podés ver las compras de tu sector.')
    sector = u.sector
  } else if (!vacio(q.sector)) {
    if (!esSector(q.sector)) throw invalido('Sector desconocido.')
    sector = q.sector
  }
  const proveedor = vacio(q.proveedor) ? null : texto(q.proveedor, 'el proveedor', { max: 100 })
  return c.json<Compra[]>(await leerCompras(db(c), { sector, desde, hasta, proveedor, estados: estados as EstadoCompra[] }))
})

rutasCompras.get('/compras/:id', requiere('compras.registrar'), async (c) => {
  return c.json<Compra>(await compraVisible(db(c), c.get('usuario'), c.req.param('id')))
})

// ---------- Cargar una compra ----------

/** Cantidad de un renglón con producto: entera (el stock se cuenta en enteros). Texto libre: hasta 3 decimales. */
function cantidadRenglon(v: unknown, conProducto: boolean, nombre: string): number {
  if (vacio(v) || v === 0) throw invalido(`Cargá la cantidad de ${nombre}.`)
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalido(`La cantidad de ${nombre} tiene que ser un número.`)
  if (v <= 0) throw invalido(`La cantidad de ${nombre} tiene que ser mayor que cero.`)
  if (v > MAX_CANTIDAD) throw invalido(`La cantidad de ${nombre} es demasiado grande.`)
  if (conProducto && !Number.isInteger(v)) throw invalido(`La cantidad de ${nombre} tiene que ser un número entero (el stock se cuenta en enteros).`)
  return Math.round(v * 1000) / 1000
}

function precioRenglon(v: unknown, nombre: string): number {
  if (vacio(v)) throw invalido(`Cargá el precio de ${nombre}.`)
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalido(`El precio de ${nombre} tiene que ser un número entero de guaraníes.`)
  if (v < 0) throw invalido(`El precio de ${nombre} no puede ser negativo.`)
  if (v > MAX_PRECIO) throw invalido(`El precio de ${nombre} es demasiado grande.`)
  return v
}

interface Renglon {
  id: string
  productoId: string | null
  sector: SectorId | null
  nombre: string
  detalle: string
  cantidad: number
  precio: number
  subtotal: number
  lote: string | null
}

/** Valida los renglones según quién compra (ver el comentario de arriba del archivo). */
async function leerRenglones(base: BaseD1, u: UsuarioSesion, v: unknown): Promise<Renglon[]> {
  if (!Array.isArray(v) || v.length === 0) throw invalido('Cargá al menos un renglón en la compra.')
  if (v.length > MAX_RENGLONES) throw invalido('Son demasiados renglones en una sola compra.')
  const crudos = v.map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
  const ids = crudos.filter((x) => !vacio(x.productoId)).map((x) => texto(x.productoId, 'el producto', { max: 100 }))
  const productos = new Map((await productosComprables(base, u, ids)).map((p) => [p.id, p]))
  const vistos = new Set<string>()
  return crudos.map((x, i) => {
    const libre = vacio(x.productoId)
    if (libre) {
      if (u.sector) throw invalido('Elegí un producto en cada renglón.')
      const detalle = texto(x.detalle, `el detalle del renglón ${i + 1}`, { max: 200 })
      const cantidad = cantidadRenglon(x.cantidad ?? 1, false, detalle)
      const precio = precioRenglon(x.precioUnitario, detalle)
      return { id: nuevoId(), productoId: null, sector: null, nombre: detalle, detalle, cantidad, precio, subtotal: Math.round(cantidad * precio), lote: null }
    }
    const p = productos.get(x.productoId as string)
    if (!p) throw invalido('Ese producto no existe. Recargá la página y probá de nuevo.')
    if (!p.activo) throw invalido(`${p.nombre} está desactivado.`)
    if (u.sector && p.sector !== u.sector) throw prohibido(`${p.nombre} no es un producto de tu sector.`)
    if (!p.habilitado) {
      throw prohibido(p.categoria_nombre
        ? `Tu sector no tiene habilitadas las compras de «${p.categoria_nombre}». Pedíselo al administrador o al supervisor.`
        : `${p.nombre} no tiene categoría de compras: lo compran el supervisor o el administrador.`)
    }
    const lote = p.con_lotes && !vacio(x.lote) ? texto(x.lote, 'El lote', { max: 40 }).toUpperCase() : null
    const clave = `${p.id}|${lote ?? ''}`
    if (vistos.has(clave)) throw invalido(`${p.nombre} está repetido en la compra: juntá las cantidades en un solo renglón.`)
    vistos.add(clave)
    const cantidad = cantidadRenglon(x.cantidad, true, p.nombre)
    const precio = precioRenglon(x.precioUnitario, p.nombre)
    const detalle = textoOpcional(x.detalle, 'El detalle', 200) ?? ''
    return { id: nuevoId(), productoId: p.id, sector: p.sector, nombre: p.nombre, detalle, cantidad, precio, subtotal: cantidad * precio, lote }
  })
}

const sentenciaMovimientoCompra = (base: BaseD1, r: Renglon, compraId: string, cantidad: number, motivo: string, usuarioId: string, fecha: string, dia: string) =>
  sentencia(
    base,
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, finalidad, motivo, usuario_id, fecha, dia, compra_id)
     VALUES (?, ?, ?, ?, 'compra', ?, 'reposicion', ?, ?, ?, ?, ?)`,
    nuevoId(), r.sector, r.productoId, r.lote, cantidad, motivo, usuarioId, fecha, dia, compraId,
  )

async function proveedorActivo(base: BaseD1, v: unknown) {
  if (vacio(v)) throw invalido('Elegí el proveedor.')
  const id = texto(v, 'el proveedor', { max: 100 })
  const p = await una<{ id: string; nombre: string; activo: number }>(base, 'SELECT id, nombre, activo FROM proveedores WHERE id = ?', id)
  if (!p) throw invalido('Ese proveedor no existe. Recargá la página y probá de nuevo.')
  if (!p.activo) throw invalido(`El proveedor ${p.nombre} está desactivado.`)
  return p
}

function sentenciaPago(base: BaseD1, p: { id: string; compraId: string; proveedorId: string; diaPago: string; importe: number; medio: MedioPago; nota: string; usuarioId: string; fecha: string; dia: string }) {
  return sentencia(
    base,
    `INSERT INTO pagos_proveedor (id, compra_id, proveedor_id, dia_pago, importe, medio, nota, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.id, p.compraId, p.proveedorId, p.diaPago, p.importe, p.medio, p.nota, p.usuarioId, p.fecha, p.dia,
  )
}

const esPagoExcedido = (e: unknown) => e instanceof Error && e.message.includes('PAGO_EXCEDE_SALDO')

rutasCompras.post('/compras', requiere('compras.registrar'), async (c) => {
  const u = c.get('usuario')
  const base = db(c)
  const b = await cuerpo(c)
  const { fecha, dia: hoy } = ahora()
  const proveedor = await proveedorActivo(base, b.proveedorId)
  const comprobante = textoOpcional(b.comprobante, 'El comprobante', 60) ?? ''
  const diaCompra = diaHastaHoy(b.diaCompra, 'La fecha de la compra', hoy)
  const vencimiento = diaOpcional(b.vencimiento, 'El vencimiento')
  if (vencimiento && vencimiento < diaCompra) throw invalido('El vencimiento no puede ser anterior a la fecha de la compra.')
  const nota = textoOpcional(b.nota, 'La nota', 300) ?? ''
  const renglones = await leerRenglones(base, u, b.items)
  const total = renglones.reduce((s, r) => s + r.subtotal, 0)
  if (total <= 0) throw invalido('El total de la compra tiene que ser mayor que cero.')

  let pago: { importe: number; medio: MedioPago } | null = null
  if (!vacio(b.pago)) {
    if (!puede(u.rol, 'compras.pagar')) throw prohibido(SOLO_PAGOS)
    const crudo = (typeof b.pago === 'object' ? b.pago : {}) as Record<string, unknown>
    pago = { importe: importe(crudo.importe, 'el importe pagado', 1), medio: medio(crudo.medio) }
    if (pago.importe > total) throw invalido(`Lo pagado (${guaranies(pago.importe)}) no puede superar el total de la compra (${guaranies(total)}).`)
  }

  const id = nuevoId()
  const motivo = `Compra a ${proveedor.nombre}${comprobante ? ` (${comprobante})` : ''}`
  const sentencias: SentenciaD1[] = [
    sentencia(
      base,
      `INSERT INTO compras (id, proveedor_id, sector, comprobante, dia_compra, vencimiento, total, nota, usuario_id, fecha, dia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, proveedor.id, u.sector, comprobante, diaCompra, vencimiento, total, nota, u.id, fecha, hoy,
    ),
    ...renglones.map((r, i) => sentencia(
      base,
      `INSERT INTO compra_items (id, compra_id, orden, producto_id, detalle, cantidad, precio_unitario, subtotal, lote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, id, i, r.productoId, r.detalle, r.cantidad, r.precio, r.subtotal, r.lote,
    )),
    ...renglones.filter((r) => r.productoId).map((r) => sentenciaMovimientoCompra(base, r, id, r.cantidad, motivo, u.id, fecha, hoy)),
  ]
  if (pago) {
    sentencias.push(sentenciaPago(base, {
      id: nuevoId(), compraId: id, proveedorId: proveedor.id, diaPago: diaCompra, importe: pago.importe, medio: pago.medio,
      nota: 'Pagado al cargar la compra', usuarioId: u.id, fecha, dia: hoy,
    }))
  }
  await base.batch(sentencias)
  return c.json<Compra>(await compraVisible(base, u, id))
})

// ---------- Pagos ----------

async function compraParaPagar(base: BaseD1, id: string) {
  const [compra] = await leerCompras(base, { ids: [id] })
  if (!compra) throw noEncontrado('No se encontró esa compra.')
  return compra
}

rutasCompras.post('/compras/:id/pagos', requiere('compras.pagar', SOLO_PAGOS), async (c) => {
  const u = c.get('usuario')
  const base = db(c)
  const b = await cuerpo(c)
  const compra = await compraParaPagar(base, c.req.param('id'))
  if (compra.estado === 'anulada') throw conflicto('compra_anulada', 'Esa compra está anulada: no se le pueden cargar pagos.')
  if (compra.saldo <= 0) throw conflicto('compra_pagada', 'Esa compra ya está pagada.')
  const { fecha, dia: hoy } = ahora()
  // «Pagar todo» manda `total: true` en lugar del importe.
  const monto = b.total === true ? compra.saldo : importe(b.importe, 'el importe', 1)
  if (monto > compra.saldo) {
    throw invalido(`El pago (${guaranies(monto)}) supera lo que falta pagar de esa compra (${guaranies(compra.saldo)}).`)
  }
  const diaPago = diaHastaHoy(b.diaPago, 'La fecha del pago', hoy)
  const pagoId = nuevoId()
  try {
    await base.batch([
      sentenciaPago(base, {
        id: pagoId, compraId: compra.id, proveedorId: compra.proveedorId, diaPago, importe: monto, medio: medio(b.medio),
        nota: textoOpcional(b.nota, 'La nota', 300) ?? '', usuarioId: u.id, fecha, dia: hoy,
      }),
    ])
  } catch (e) {
    if (esPagoExcedido(e)) throw conflicto('pago_excede_saldo', 'Ese pago supera lo que falta pagar. Recargá la página: puede que otro pago se haya cargado recién.')
    throw e
  }
  return c.json<Compra>(await compraVisible(base, u, compra.id))
})

rutasCompras.post('/pagos-proveedor/:id/anular', requiere('compras.pagar', SOLO_PAGOS), async (c) => {
  const u = c.get('usuario')
  const base = db(c)
  const b = await cuerpo(c)
  const motivo = texto(b.motivo, 'el motivo', { max: 300 })
  const [pago] = await leerPagos(base, 'WHERE g.id = ?', c.req.param('id'))
  if (!pago) throw noEncontrado('No se encontró ese pago.')
  if (pago.anulado) throw conflicto('pago_anulado', 'Ese pago ya está anulado.')
  const { fecha } = ahora()
  await base.batch([
    sentencia(base, 'UPDATE pagos_proveedor SET anulado_por = ?, anulado_en = ?, motivo_anulacion = ? WHERE id = ? AND anulado_en IS NULL', u.id, fecha, motivo, pago.id),
    sentenciaAuditoria(base, { tabla: 'pagos_proveedor', registroId: pago.id, accion: 'anular', usuarioId: u.id, antes: pago, despues: { ...pago, anulado: true, motivoAnulacion: motivo } }),
  ])
  return c.json<Compra>(await compraVisible(base, u, pago.compraId))
})

// ---------- Anular una compra ----------

rutasCompras.post('/compras/:id/anular', requiere('compras.pagar', 'Las compras las anulan el supervisor o el administrador.'), async (c) => {
  const u = c.get('usuario')
  const base = db(c)
  const b = await cuerpo(c)
  const motivo = texto(b.motivo, 'el motivo', { max: 300 })
  const compra = await compraParaPagar(base, c.req.param('id'))
  if (compra.estado === 'anulada') throw conflicto('compra_anulada', 'Esa compra ya está anulada.')
  if (compra.pagado > 0) throw conflicto('compra_con_pagos', 'Esa compra tiene pagos: anulá primero los pagos y después la compra.')
  const { fecha, dia: hoy } = ahora()
  const texto_ = `Anulación de la compra a ${compra.proveedorNombre}${compra.comprobante ? ` (${compra.comprobante})` : ''}`
  const renglones: Renglon[] = compra.items.filter((i) => i.productoId).map((i) => ({
    id: i.id, productoId: i.productoId, sector: i.sector, nombre: i.productoNombre ?? '', detalle: i.detalle, cantidad: i.cantidad,
    precio: i.precioUnitario, subtotal: i.subtotal, lote: i.lote,
  }))
  try {
    await base.batch([
      ...renglones.map((r) => sentenciaMovimientoCompra(base, r, compra.id, -r.cantidad, texto_, u.id, fecha, hoy)),
      sentencia(base, 'UPDATE compras SET anulada_por = ?, anulada_en = ?, motivo_anulacion = ? WHERE id = ? AND anulada_en IS NULL', u.id, fecha, motivo, compra.id),
      sentenciaAuditoria(base, { tabla: 'compras', registroId: compra.id, accion: 'anular', usuarioId: u.id, antes: compra, despues: { estado: 'anulada', motivo } }),
    ])
  } catch (e) {
    if (!esStockInsuficiente(e)) throw e
    throw conflicto(
      'stock_insuficiente',
      'No se puede anular: ya se usó parte de lo comprado y el stock quedaría en negativo. Corregí el stock con un ajuste y después anulá la compra.',
    )
  }
  return c.json<Compra>(await compraVisible(base, u, compra.id))
})

// ---------- Avisos de vencimiento ----------

/** Días antes del vencimiento en que empieza el aviso. */
export const DIAS_AVISO_VENCIMIENTO = 3

/** Compras con saldo que vencen dentro de los próximos días o ya vencieron (para quien marca pagos). */
export async function alertasCompras(base: BaseD1): Promise<Alerta[]> {
  const hoy = ahora().dia
  const filas = await todas<{ proveedor: string; comprobante: string; vencimiento: string; saldo: number }>(
    base,
    `SELECT * FROM (
       SELECT p.nombre AS proveedor, c.comprobante, c.vencimiento, ${SQL_SALDO_COMPRA} AS saldo
         FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
        WHERE c.anulada_en IS NULL AND c.vencimiento IS NOT NULL AND c.vencimiento <= ?
     ) WHERE saldo > 0 ORDER BY vencimiento, proveedor`,
    sumarDias(hoy, DIAS_AVISO_VENCIMIENTO),
  )
  return filas.map((f) => {
    const vencida = f.vencimiento < hoy
    const cuando = vencida ? `venció el ${diaLegible(f.vencimiento)}` : f.vencimiento === hoy ? 'vence hoy' : `vence el ${diaLegible(f.vencimiento)}`
    return {
      tipo: vencida ? 'compra_vencida' as const : 'compra_por_vencer' as const,
      sector: null,
      texto: `Compra a ${f.proveedor}${f.comprobante ? ` (${f.comprobante})` : ''} ${cuando}: faltan ${guaranies(f.saldo)}.`,
      enlace: '/compras',
    }
  })
}

// ---------- Reporte simple de compras y pagos ----------

export async function reporteCompras(base: BaseD1, desde: string, hasta: string): Promise<ReporteCompras> {
  const hoy = ahora().dia
  const compras = (await leerCompras(base, { desde, hasta })).filter((x) => x.estado !== 'anulada')
  const pagos = (await leerPagos(base, 'WHERE g.dia_pago >= ? AND g.dia_pago <= ? AND g.anulado_en IS NULL AND c.anulada_en IS NULL', desde, hasta))
  const deudas = await todas<{ saldo: number; vencimiento: string | null }>(
    base, `SELECT ${SQL_SALDO_COMPRA} AS saldo, c.vencimiento FROM compras c WHERE c.anulada_en IS NULL`,
  )
  const categorias = await todas<{ categoria_id: string | null; categoria_nombre: string | null; importe: number }>(
    base,
    `SELECT p.categoria_id, k.nombre AS categoria_nombre, SUM(i.subtotal) AS importe
       FROM compra_items i
       JOIN compras c ON c.id = i.compra_id
       LEFT JOIN productos p ON p.id = i.producto_id
       LEFT JOIN categorias k ON k.id = p.categoria_id
      WHERE c.anulada_en IS NULL AND c.dia_compra >= ? AND c.dia_compra <= ?
      GROUP BY p.categoria_id ORDER BY importe DESC`,
    desde, hasta,
  )
  const porProveedor = new Map<string, ReporteCompras['porProveedor'][number]>()
  const fila = (id: string, nombre: string) => {
    if (!porProveedor.has(id)) porProveedor.set(id, { proveedorId: id, proveedorNombre: nombre, comprado: 0, pagado: 0, saldo: 0 })
    return porProveedor.get(id)!
  }
  for (const x of compras) {
    const f = fila(x.proveedorId, x.proveedorNombre)
    f.comprado += x.total
    f.saldo += x.saldo
  }
  for (const g of pagos) fila(g.proveedorId, g.proveedorNombre).pagado += g.importe
  const porMedio = MEDIOS_PAGO
    .map((m) => ({ medio: m, importe: pagos.filter((g) => g.medio === m).reduce((s, g) => s + g.importe, 0) }))
    .filter((m) => m.importe > 0)
  const limite = sumarDias(hoy, 7)
  const porVencer = (await leerCompras(base, { estados: ['pendiente', 'parcial'] }))
    .filter((x) => x.vencimiento !== null && x.vencimiento <= limite)
    .sort((a, b) => a.vencimiento!.localeCompare(b.vencimiento!))
  return {
    desde,
    hasta,
    cantidadCompras: compras.length,
    totalComprado: compras.reduce((s, x) => s + x.total, 0),
    totalPagado: pagos.reduce((s, g) => s + g.importe, 0),
    pendientePeriodo: compras.reduce((s, x) => s + x.saldo, 0),
    deudaTotal: deudas.reduce((s, d) => s + Math.max(0, d.saldo), 0),
    deudaVencida: deudas.filter((d) => d.vencimiento !== null && d.vencimiento < hoy).reduce((s, d) => s + Math.max(0, d.saldo), 0),
    porProveedor: [...porProveedor.values()].sort((a, b) => b.comprado - a.comprado || a.proveedorNombre.localeCompare(b.proveedorNombre, 'es')),
    porCategoria: categorias.map((k) => ({
      categoriaId: k.categoria_id,
      categoriaNombre: k.categoria_nombre ?? 'Sin categoría (texto libre o producto sin categoría)',
      importe: k.importe,
    })),
    porMedio,
    pagos,
    porVencer,
  }
}

rutasCompras.get('/reportes/compras', requiere('reportes.compras', 'Este reporte lo ven el supervisor y el administrador.'), async (c) => {
  const q = c.req.query()
  const hoy = ahora().dia
  const desde = vacio(q.desde) ? `${hoy.slice(0, 8)}01` : dia(q.desde, 'La fecha desde')
  const hasta = vacio(q.hasta) ? hoy : dia(q.hasta, 'La fecha hasta')
  if (desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  return c.json<ReporteCompras>(await reporteCompras(db(c), desde, hasta))
})

function db(c: { env: { DB: BaseD1 } }): BaseD1 {
  return c.env.DB
}
