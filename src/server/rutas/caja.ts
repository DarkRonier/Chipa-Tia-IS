// M11–M13: caja, ventas y factura preimpresa. Lo usan el cajero y el administrador (que no vende).
// - Caja: dos cajas, la del frente (cajero) y la del comedor (Caja Comedor, Mati 2026-11-21); como mucho una abierta
//   de cada una (índice único por punto). El administrador elige cuál mira con ?punto=frente|comedor. Se abre con un fondo inicial en efectivo;
//   cada venta, ingreso y retiro suma o resta en su medio de pago; el arqueo compara el efectivo contado con el
//   esperado; el cierre guarda esperado, contado y diferencia.
// - Ventas: al contado, con productos, cantidades, precios del catálogo, descuento, medio de pago (o varias
//   partes de distintos medios: pago híbrido) y cliente opcional.
//   Solo con la caja abierta. Las registra solo el cajero (Mati, 2026-11-21: el administrador y el supervisor no
//   venden). Todo lo vendido descuenta del depósito Venta frente (en la caja del comedor, de Venta comedor) (en Chipería, de los lotes más viejos primero). La
//   venta nunca se frena por stock: si no estaba cargado, el depósito queda en negativo a la vista.
// - Factura preimpresa: numeración propia (prefijo y número), una por venta; se puede reimprimir con el mismo número.
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { Alerta } from '../../shared/alertas'
import { diaLegible } from '../../shared/hora'
import { puede } from '../../shared/permisos'
import {
  DEPOSITO, MEDIO_CON_BANCO, MEDIOS_PAGO, NOMBRE_PUNTO_CAJA, PUNTOS_CAJA,
  type Arqueo, type Caja, type ConfigFactura, type Factura, type Iva, type MedioPago, type MovimientoCaja, type PartePago, type ProductoVenta,
  type PuntoCaja, type Rol, type SectorId, type TotalesMedio, type Venta, type VentaItem,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, nuevoId, sentencia, todas, todasPorTrozos, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1, ValorSQL } from '../entorno'
import { conflicto, invalido, noEncontrado, prohibido } from '../errores'
import { requiere } from '../sesion'
import { cuerpo, diaOpcional, texto, textoOpcional } from '../validar'
import { repartirPorLotes, sentenciaMovimiento } from './stock'

export const rutasCaja = new Hono<Entorno>()

const MAX_RENGLONES = 100
const MAX_IMPORTE = 1_000_000_000_000
const vacio = (v: unknown) => v === undefined || v === null || v === ''
const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString('es-PY')}`

// ---------- Ayudas comunes (también las usan compras e ingresos y egresos) ----------

export function importeGs(v: unknown, campo: string, min = 1): number {
  const Campo = campo[0].toUpperCase() + campo.slice(1)
  if (vacio(v)) throw invalido(`Falta ${campo}.`)
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalido(`${Campo} tiene que ser un número entero de guaraníes.`)
  if (v < min) throw invalido(min > 0 ? `${Campo} tiene que ser mayor que cero.` : `${Campo} no puede ser negativo.`)
  if (v > MAX_IMPORTE) throw invalido(`${Campo} es demasiado grande.`)
  return v
}

export function medioPago(v: unknown): MedioPago {
  if (vacio(v)) throw invalido('Elegí el medio de pago.')
  if (!(MEDIOS_PAGO as unknown[]).includes(v)) throw invalido('El medio de pago no es válido.')
  return v as MedioPago
}

const MAX_PARTES = 10

/**
 * Las partes de un pago híbrido (`partes`: [{ medio, importe, banco?, chequeNumero? }]). El cheque lleva banco
 * (obligatorio) y número (opcional); la transferencia, banco opcional; los demás medios no llevan ninguno.
 */
export function partesPago(v: unknown): PartePago[] {
  if (!Array.isArray(v) || v.length === 0) throw invalido('Cargá al menos una parte del pago (medio e importe).')
  if (v.length > MAX_PARTES) throw invalido(`Son demasiadas partes en un solo pago (como mucho ${MAX_PARTES}).`)
  return v.map((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const cual = v.length > 1 ? ` de la parte ${i + 1}` : ''
    const medio = medioPago(o.medio)
    const importe = importeGs(o.importe, `el importe${cual}`)
    const banco = MEDIO_CON_BANCO[medio] ? textoOpcional(o.banco, `El banco${cual}`, 60) ?? '' : ''
    if (medio === 'cheque' && !banco) throw invalido(`Falta el banco del cheque${cual}.`)
    const chequeNumero = medio === 'cheque' ? textoOpcional(o.chequeNumero, `El número del cheque${cual}`, 30) ?? '' : ''
    return { medio, importe, banco, chequeNumero }
  })
}

/** El medio de la parte más grande (la primera si empatan). */
export const medioPrincipal = (partes: PartePago[]): MedioPago =>
  partes.reduce((a, b) => (b.importe > a.importe ? b : a), partes[0]).medio

export const esCajaCerrada = (e: unknown) => e instanceof Error && e.message.includes('CAJA_CERRADA')
export const cajaCerradaError = () => conflicto('caja_cerrada', 'La caja está cerrada. Abrila para seguir.')

/**
 * Caja de quien pide: el cajero maneja la del frente y Caja Comedor la del comedor. El administrador (que no vende)
 * elige cuál mira con ?punto=; si no dice, la del frente.
 */
export function puntoDe(rol: Rol, pedido?: unknown): PuntoCaja {
  if (rol === 'caja_comedor') return 'comedor'
  if (rol === 'cajero') return 'frente'
  return pedido === 'comedor' ? 'comedor' : 'frente'
}

const puntoDelPedido = (c: Context<Entorno>) => puntoDe(c.get('usuario').rol, c.req.query('punto'))

/** Si quien pide es una de las cajas, solo toca lo de su propia caja. */
function soloSuCaja(rol: Rol, punto: PuntoCaja) {
  if ((rol === 'cajero' || rol === 'caja_comedor') && puntoDe(rol) !== punto) {
    throw prohibido(`Eso es de la ${NOMBRE_PUNTO_CAJA[punto].toLowerCase()}.`)
  }
}

/** La caja abierta de un punto (la del frente si no se dice), o null. Pagos a proveedores e I/E usan la del frente. */
export async function cajaAbierta(db: BaseD1, punto: PuntoCaja = 'frente'): Promise<{ id: string; dia: string } | null> {
  return una<{ id: string; dia: string }>(db, 'SELECT id, dia FROM cajas WHERE cerrada_en IS NULL AND punto = ? LIMIT 1', punto)
}

/** Movimiento de caja automático o manual (va en el mismo batch que lo que lo origina). */
export function sentenciaMovimientoCaja(db: BaseD1, m: {
  id: string; cajaId: string; tipo: 'ingreso' | 'retiro'; medio: MedioPago; importe: number; concepto: string
  origen: 'manual' | 'ie' | 'proveedor'; origenId: string | null; usuarioId: string; fecha: string; dia: string
}): SentenciaD1 {
  return sentencia(
    db,
    `INSERT INTO caja_movimientos (id, caja_id, tipo, medio, importe, concepto, origen, origen_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, m.cajaId, m.tipo, m.medio, m.importe, m.concepto, m.origen, m.origenId, m.usuarioId, m.fecha, m.dia,
  )
}

/**
 * Anula el movimiento de caja que generó otro módulo (pago a proveedor, gasto). Solo si esa caja sigue abierta: una
 * caja cerrada ya se contó.
 */
export async function sentenciasAnularMovimientoCaja(db: BaseD1, id: string | null, usuarioId: string, fecha: string): Promise<SentenciaD1[]> {
  if (!id) return []
  const f = await una<{ cerrada_en: string | null }>(db, 'SELECT c.cerrada_en FROM caja_movimientos m JOIN cajas c ON c.id = m.caja_id WHERE m.id = ?', id)
  if (f?.cerrada_en) {
    throw conflicto('caja_cerrada', 'Ese movimiento salió de una caja que ya se cerró: no se puede anular. Cargá un ajuste en Ingresos y egresos.')
  }
  return [sentencia(db, 'UPDATE caja_movimientos SET anulado_por = ?, anulado_en = ? WHERE id = ? AND anulado_en IS NULL', usuarioId, fecha, id)]
}

// ---------- Caja ----------

interface FilaCaja {
  id: string
  punto: PuntoCaja
  abierta_por_nombre: string
  abierta_en: string
  dia: string
  fondo_inicial: number
  cerrada_por_nombre: string | null
  cerrada_en: string | null
  contado_efectivo: number | null
  esperado_efectivo: number | null
  diferencia: number | null
  nota_cierre: string
}

const SQL_CAJA = `SELECT c.id, c.punto, a.nombre AS abierta_por_nombre, c.abierta_en, c.dia, c.fondo_inicial, z.nombre AS cerrada_por_nombre,
    c.cerrada_en, c.contado_efectivo, c.esperado_efectivo, c.diferencia, c.nota_cierre
  FROM cajas c JOIN usuarios a ON a.id = c.abierta_por LEFT JOIN usuarios z ON z.id = c.cerrada_por`

/** Totales por medio de varias cajas: fondo (efectivo) + ventas + ingresos − retiros. */
async function totalesDe(db: BaseD1, cajas: FilaCaja[]): Promise<Map<string, { totales: TotalesMedio[]; cantidad: number; ventas: number }>> {
  const ids = cajas.map((c) => c.id)
  const [ventas, cantidades, movs] = await Promise.all([
    // Por medio, con cada parte de un cobro híbrido en su medio.
    todasPorTrozos<{ caja_id: string; medio: MedioPago; total: number }>(
      db, ids,
      (m) => `SELECT v.caja_id, p.medio, SUM(p.importe) AS total
                FROM venta_pagos p JOIN ventas v ON v.id = p.venta_id
               WHERE v.anulada_en IS NULL AND v.caja_id IN (${m}) GROUP BY v.caja_id, p.medio`,
    ),
    todasPorTrozos<{ caja_id: string; cantidad: number; total: number }>(
      db, ids,
      (m) => `SELECT caja_id, COUNT(*) AS cantidad, SUM(total) AS total FROM ventas
               WHERE anulada_en IS NULL AND caja_id IN (${m}) GROUP BY caja_id`,
    ),
    todasPorTrozos<{ caja_id: string; medio: MedioPago; tipo: 'ingreso' | 'retiro'; total: number }>(
      db, ids,
      (m) => `SELECT caja_id, medio, tipo, SUM(importe) AS total FROM caja_movimientos
               WHERE anulado_en IS NULL AND caja_id IN (${m}) GROUP BY caja_id, medio, tipo`,
    ),
  ])
  const r = new Map<string, { totales: TotalesMedio[]; cantidad: number; ventas: number }>()
  for (const c of cajas) {
    const totales = MEDIOS_PAGO.map((medio) => {
      const v = ventas.find((x) => x.caja_id === c.id && x.medio === medio)?.total ?? 0
      const ing = movs.find((x) => x.caja_id === c.id && x.medio === medio && x.tipo === 'ingreso')?.total ?? 0
      const ret = movs.find((x) => x.caja_id === c.id && x.medio === medio && x.tipo === 'retiro')?.total ?? 0
      return { medio, ventas: v, ingresos: ing, retiros: ret, esperado: (medio === 'efectivo' ? c.fondo_inicial : 0) + v + ing - ret }
    })
    const propias = cantidades.find((x) => x.caja_id === c.id)
    r.set(c.id, { totales, cantidad: propias?.cantidad ?? 0, ventas: propias?.total ?? 0 })
  }
  return r
}

export async function leerCajas(db: BaseD1, where = '', ...params: ValorSQL[]): Promise<Caja[]> {
  const filas = await todas<FilaCaja>(db, `${SQL_CAJA} ${where} ORDER BY c.abierta_en DESC LIMIT 500`, ...params)
  const tot = await totalesDe(db, filas)
  return filas.map((f) => {
    const t = tot.get(f.id)!
    const esperado = t.totales.find((x) => x.medio === 'efectivo')!.esperado
    return {
      id: f.id,
      punto: f.punto,
      abierta: f.cerrada_en === null,
      abiertaPorNombre: f.abierta_por_nombre,
      abiertaEn: f.abierta_en,
      dia: f.dia,
      fondoInicial: f.fondo_inicial,
      cerradaPorNombre: f.cerrada_por_nombre,
      cerradaEn: f.cerrada_en,
      cantidadVentas: t.cantidad,
      totalVentas: t.ventas,
      totales: t.totales.filter((x) => x.medio === 'efectivo' || x.ventas || x.ingresos || x.retiros),
      esperadoEfectivo: f.esperado_efectivo ?? esperado,
      contadoEfectivo: f.contado_efectivo,
      diferencia: f.diferencia,
      notaCierre: f.nota_cierre,
    }
  })
}

async function detalleCaja(db: BaseD1, id: string): Promise<Caja> {
  const [caja] = await leerCajas(db, 'WHERE c.id = ?', id)
  if (!caja) throw noEncontrado('No se encontró esa caja.')
  const [movs, arqueos] = await Promise.all([
    todas<{ id: string; tipo: 'ingreso' | 'retiro'; medio: MedioPago; importe: number; concepto: string; origen: MovimientoCaja['origen']; usuario_nombre: string; fecha: string; anulado_en: string | null }>(
      db,
      `SELECT m.id, m.tipo, m.medio, m.importe, m.concepto, m.origen, u.nombre AS usuario_nombre, m.fecha, m.anulado_en
         FROM caja_movimientos m JOIN usuarios u ON u.id = m.usuario_id WHERE m.caja_id = ? ORDER BY m.fecha DESC`,
      id,
    ),
    todas<{ id: string; usuario_nombre: string; fecha: string; esperado: number; contado: number; diferencia: number; nota: string; es_cierre: number }>(
      db,
      `SELECT a.id, u.nombre AS usuario_nombre, a.fecha, a.esperado, a.contado, a.diferencia, a.nota, a.es_cierre
         FROM arqueos a JOIN usuarios u ON u.id = a.usuario_id WHERE a.caja_id = ? ORDER BY a.fecha DESC`,
      id,
    ),
  ])
  caja.movimientos = movs.map((m) => ({
    id: m.id, tipo: m.tipo, medio: m.medio, importe: m.importe, concepto: m.concepto, origen: m.origen, usuarioNombre: m.usuario_nombre,
    fecha: m.fecha, anulado: m.anulado_en !== null,
  }))
  caja.arqueos = arqueos.map((a): Arqueo => ({
    id: a.id, usuarioNombre: a.usuario_nombre, fecha: a.fecha, esperado: a.esperado, contado: a.contado, diferencia: a.diferencia,
    nota: a.nota, esCierre: !!a.es_cierre,
  }))
  return caja
}

async function cajaAbiertaObligatoria(db: BaseD1, punto: PuntoCaja) {
  const c = await cajaAbierta(db, punto)
  if (!c) throw cajaCerradaError()
  return c
}

const SOLO_CAJA = 'La caja la manejan el cajero, la caja del comedor y el administrador.'

/** La caja abierta con sus movimientos y arqueos, o null si está cerrada. */
rutasCaja.get('/caja', requiere('caja.operar', SOLO_CAJA), async (c) => {
  const abierta = await cajaAbierta(c.env.DB, puntoDelPedido(c))
  return c.json<Caja | null>(abierta ? await detalleCaja(c.env.DB, abierta.id) : null)
})

rutasCaja.post('/caja/abrir', requiere('caja.operar', SOLO_CAJA), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const fondo = importeGs(b.fondoInicial ?? 0, 'el fondo inicial', 0)
  const punto = puntoDelPedido(c)
  if (await cajaAbierta(db, punto)) throw conflicto('caja_abierta', 'La caja ya está abierta.')
  const id = nuevoId()
  const { fecha, dia } = ahora()
  try {
    await db.batch([
      sentencia(db, 'INSERT INTO cajas (id, punto, abierta_por, abierta_en, dia, fondo_inicial) VALUES (?, ?, ?, ?, ?, ?)', id, punto, u.id, fecha, dia, fondo),
    ])
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw conflicto('caja_abierta', 'La caja ya está abierta.')
    throw e
  }
  return c.json<Caja>(await detalleCaja(db, id))
})

rutasCaja.post('/caja/movimientos', requiere('caja.operar', SOLO_CAJA), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const caja = await cajaAbiertaObligatoria(db, puntoDelPedido(c))
  if (b.tipo !== 'ingreso' && b.tipo !== 'retiro') throw invalido('Elegí si es un ingreso o un retiro.')
  const importe = importeGs(b.importe, 'el importe')
  const medio = vacio(b.medio) ? 'efectivo' : medioPago(b.medio)
  const concepto = texto(b.concepto, 'el concepto', { max: 200 })
  const { fecha, dia } = ahora()
  try {
    await db.batch([sentenciaMovimientoCaja(db, {
      id: nuevoId(), cajaId: caja.id, tipo: b.tipo, medio, importe, concepto, origen: 'manual', origenId: null, usuarioId: u.id, fecha, dia,
    })])
  } catch (e) {
    if (esCajaCerrada(e)) throw cajaCerradaError()
    throw e
  }
  return c.json<Caja>(await detalleCaja(db, caja.id))
})

rutasCaja.post('/caja/movimientos/:id/anular', requiere('caja.operar', SOLO_CAJA), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const m = await una<{ caja_id: string; origen: string; anulado_en: string | null; cerrada_en: string | null; punto: PuntoCaja }>(
    db, 'SELECT m.caja_id, m.origen, m.anulado_en, c.cerrada_en, c.punto FROM caja_movimientos m JOIN cajas c ON c.id = m.caja_id WHERE m.id = ?', c.req.param('id'),
  )
  if (!m) throw noEncontrado('No se encontró ese movimiento.')
  soloSuCaja(u.rol, m.punto)
  if (m.origen !== 'manual') throw conflicto('movimiento_automatico', 'Ese movimiento viene de otro módulo: anulalo desde ahí (pago a proveedor o Ingresos y egresos).')
  if (m.cerrada_en) throw cajaCerradaError()
  if (m.anulado_en) throw conflicto('ya_anulado', 'Ese movimiento ya está anulado.')
  await db.batch([sentencia(db, 'UPDATE caja_movimientos SET anulado_por = ?, anulado_en = ? WHERE id = ?', u.id, ahora().fecha, c.req.param('id'))])
  return c.json<Caja>(await detalleCaja(db, m.caja_id))
})

/** Arqueo (o cierre): compara el efectivo contado con el esperado. */
async function arquear(db: BaseD1, punto: PuntoCaja, usuarioId: string, b: Record<string, unknown>, esCierre: boolean) {
  const caja = await cajaAbiertaObligatoria(db, punto)
  const contado = importeGs(b.contado, 'el efectivo contado', 0)
  const nota = textoOpcional(b.nota, 'La nota', 300) ?? ''
  const [actual] = await leerCajas(db, 'WHERE c.id = ?', caja.id)
  const esperado = actual.esperadoEfectivo
  const diferencia = contado - esperado
  const { fecha } = ahora()
  const sentencias: SentenciaD1[] = [
    sentencia(db, 'INSERT INTO arqueos (id, caja_id, usuario_id, fecha, esperado, contado, diferencia, nota, es_cierre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      nuevoId(), caja.id, usuarioId, fecha, esperado, contado, diferencia, nota, esCierre),
  ]
  if (esCierre) {
    sentencias.push(
      sentencia(db,
        `UPDATE cajas SET cerrada_por = ?, cerrada_en = ?, esperado_efectivo = ?, contado_efectivo = ?, diferencia = ?, resumen_cierre = ?, nota_cierre = ?
          WHERE id = ? AND cerrada_en IS NULL`,
        usuarioId, fecha, esperado, contado, diferencia, JSON.stringify(actual.totales), nota, caja.id),
      sentenciaAuditoria(db, { tabla: 'cajas', registroId: caja.id, accion: 'cerrar', usuarioId, antes: actual, despues: { esperado, contado, diferencia, nota } }),
    )
  }
  try {
    await db.batch(sentencias)
  } catch (e) {
    if (esCajaCerrada(e)) throw cajaCerradaError()
    throw e
  }
  return detalleCaja(db, caja.id)
}

rutasCaja.post('/caja/arqueos', requiere('caja.operar', SOLO_CAJA), async (c) => {
  return c.json<Caja>(await arquear(c.env.DB, puntoDelPedido(c), c.get('usuario').id, await cuerpo(c), false))
})

rutasCaja.post('/caja/cerrar', requiere('caja.operar', SOLO_CAJA), async (c) => {
  return c.json<Caja>(await arquear(c.env.DB, puntoDelPedido(c), c.get('usuario').id, await cuerpo(c), true))
})

/** Historial de cajas (administrador). */
rutasCaja.get('/cajas', requiere('reportes.detallados', 'El historial de cajas lo ve el administrador.'), async (c) => {
  const q = c.req.query()
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  const partes: string[] = []
  const params: ValorSQL[] = []
  if (desde) { partes.push('c.dia >= ?'); params.push(desde) }
  if (hasta) { partes.push('c.dia <= ?'); params.push(hasta) }
  return c.json<Caja[]>(await leerCajas(c.env.DB, partes.length ? `WHERE ${partes.join(' AND ')}` : '', ...params))
})

rutasCaja.get('/cajas/:id', requiere('caja.operar', SOLO_CAJA), async (c) => {
  return c.json<Caja>(await detalleCaja(c.env.DB, c.req.param('id')))
})

/** Caja abierta desde un día anterior: aviso para quien la maneja (el administrador ve las dos). */
export async function alertasCaja(db: BaseD1, rol: Rol): Promise<Alerta[]> {
  const puntos = rol === 'cajero' || rol === 'caja_comedor' ? [puntoDe(rol)] : PUNTOS_CAJA
  const hoy = ahora().dia
  const r: Alerta[] = []
  for (const punto of puntos) {
    const c = await cajaAbierta(db, punto)
    if (!c || c.dia >= hoy) continue
    const cual = rol === 'admin' ? NOMBRE_PUNTO_CAJA[punto] : 'La caja'
    r.push({
      tipo: 'caja_sin_cerrar', sector: null, texto: `${cual} está abierta desde el ${diaLegible(c.dia)}: arqueala y cerrala.`,
      enlace: punto === 'comedor' && rol === 'admin' ? '/caja?punto=comedor' : '/caja',
    })
  }
  return r
}

// ---------- Ventas (M11) ----------

interface FilaProductoVenta {
  id: string
  nombre: string
  sector: SectorId
  sector_nombre: string
  precio_venta: number | null
  iva: Iva
  activo: number
  con_lotes: number
  sin_stock: number
  /** Depósito del que sale al venderlo: Venta frente (o Venta comedor), o Materia prima para la materia prima que se vende (la leche). */
  deposito_id: string
  /** La caja del comedor vende solo las categorías de Venta comedor. */
  en_esta_caja: number
  categoria: string | null
  stock: number
}

// Cualquier producto con precio de venta se vende (Mati, 2026-11-21): también la materia prima, como la leche. La
// materia prima se compra al depósito Materia prima, así que al venderla sale de ahí; lo demás sale de Venta frente.
// En la caja del comedor, lo que no es materia prima sale de Venta comedor.
const depositoDeVenta = (punto: PuntoCaja) =>
  `CASE p.tipo WHEN 'materia_prima' THEN '${DEPOSITO.materiaPrima}' ELSE '${punto === 'comedor' ? DEPOSITO.comedor : DEPOSITO.venta}' END`
// La caja del comedor vende solo lo de las categorías que recibe Venta comedor (buffet, bebidas…); sin categoría
// cuenta como «Otros». La del frente vende todo lo que tiene precio, como siempre.
const sqlProductoVenta = (punto: PuntoCaja) => `SELECT p.id, p.nombre, p.sector, s.nombre AS sector_nombre, p.precio_venta, p.iva, p.activo, s.con_lotes, p.sin_stock,
    ${depositoDeVenta(punto)} AS deposito_id,
    ${punto === 'comedor'
      ? `EXISTS (SELECT 1 FROM deposito_categorias dc WHERE dc.deposito_id = '${DEPOSITO.comedor}'
           AND dc.categoria_id = COALESCE(p.categoria_id, (SELECT id FROM categorias WHERE sistema = 1 ORDER BY orden LIMIT 1)))`
      : '1'} AS en_esta_caja,
    (SELECT nombre FROM categorias WHERE id = p.categoria_id) AS categoria,
    COALESCE((SELECT SUM(m.cantidad) FROM movimientos m WHERE m.sector = p.sector AND m.producto_id = p.id AND m.deposito_id = ${depositoDeVenta(punto)}), 0) AS stock
  FROM productos p JOIN sectores s ON s.id = p.sector`

/** Ver las ventas: el cajero (las de la caja abierta) y quien ve los reportes detallados (el administrador). */
const verVentas: MiddlewareHandler<Entorno> = async (c, next) => {
  const rol = c.get('usuario').rol
  if (!puede(rol, 'ventas.registrar') && !puede(rol, 'reportes.detallados')) throw prohibido()
  await next()
}

rutasCaja.get('/ventas/productos', requiere('ventas.registrar'), async (c) => {
  const filas = await todas<FilaProductoVenta>(
    c.env.DB, `${sqlProductoVenta(puntoDelPedido(c))} WHERE p.activo = 1 AND p.precio_venta IS NOT NULL AND en_esta_caja ORDER BY s.orden, p.orden, p.nombre`,
  )
  return c.json<ProductoVenta[]>(filas.map((f) => ({
    id: f.id, nombre: f.nombre, sector: f.sector, sectorNombre: f.sector_nombre, precio: f.precio_venta!, iva: f.iva,
    stock: f.stock,
    sinStock: !!f.sin_stock,
  })))
})

interface FilaVenta {
  id: string
  numero: number
  caja_id: string
  cliente_nombre: string
  cliente_ruc: string
  cliente_direccion: string
  subtotal: number
  descuento: number
  total: number
  medio: MedioPago
  recibido: number | null
  usuario_nombre: string
  fecha: string
  dia: string
  anulada_en: string | null
  motivo_anulacion: string | null
}

const SQL_VENTA = `SELECT v.id, v.numero, v.caja_id, v.cliente_nombre, v.cliente_ruc, v.cliente_direccion, v.subtotal, v.descuento, v.total, v.medio, v.recibido,
    u.nombre AS usuario_nombre, v.fecha, v.dia, v.anulada_en, v.motivo_anulacion
  FROM ventas v JOIN usuarios u ON u.id = v.usuario_id`

export const numeroFactura = (prefijo: string, numero: number) => `${prefijo}-${String(numero).padStart(7, '0')}`

export async function leerVentas(db: BaseD1, where = '', ...params: ValorSQL[]): Promise<Venta[]> {
  const filas = await todas<FilaVenta>(db, `${SQL_VENTA} ${where} ORDER BY v.numero DESC LIMIT 2000`, ...params)
  const ids = filas.map((f) => f.id)
  const [items, facturas, pagos] = await Promise.all([
    todasPorTrozos<{ venta_id: string; producto_id: string; nombre: string; cantidad: number; precio_unitario: number; subtotal: number; iva: Iva; codigo: string | null }>(
      db, ids, (m) => `SELECT i.venta_id, i.producto_id, i.nombre, i.cantidad, i.precio_unitario, i.subtotal, i.iva, p.codigo
        FROM venta_items i LEFT JOIN productos p ON p.id = i.producto_id WHERE i.venta_id IN (${m}) ORDER BY i.orden`,
    ),
    todasPorTrozos<{ id: string; venta_id: string; prefijo: string; numero: number; timbrado: string; fecha: string; impresiones: number; anulada_en: string | null }>(
      db, ids, (m) => `SELECT id, venta_id, prefijo, numero, timbrado, fecha, impresiones, anulada_en FROM facturas WHERE venta_id IN (${m})`,
    ),
    todasPorTrozos<{ venta_id: string; medio: MedioPago; importe: number; banco: string; cheque_numero: string }>(
      db, ids, (m) => `SELECT venta_id, medio, importe, banco, cheque_numero FROM venta_pagos WHERE venta_id IN (${m}) ORDER BY venta_id, orden`,
    ),
  ])
  return filas.map((f) => {
    const fac = facturas.find((x) => x.venta_id === f.id)
    return {
      id: f.id,
      numero: f.numero,
      cajaId: f.caja_id,
      clienteNombre: f.cliente_nombre,
      clienteRuc: f.cliente_ruc,
      clienteDireccion: f.cliente_direccion,
      subtotal: f.subtotal,
      descuento: f.descuento,
      total: f.total,
      medio: f.medio,
      pagos: pagos.filter((x) => x.venta_id === f.id).map((x) => ({ medio: x.medio, importe: x.importe, banco: x.banco, chequeNumero: x.cheque_numero })),
      recibido: f.recibido,
      // El vuelto es sobre la parte en efectivo (en una venta de un solo medio, el total).
      vuelto: f.recibido !== null
        ? f.recibido - (pagos.some((x) => x.venta_id === f.id)
          ? pagos.filter((x) => x.venta_id === f.id && x.medio === 'efectivo').reduce((s, x) => s + x.importe, 0)
          : f.total)
        : null,
      usuarioNombre: f.usuario_nombre,
      fecha: f.fecha,
      dia: f.dia,
      anulada: f.anulada_en !== null,
      anuladaEn: f.anulada_en,
      motivoAnulacion: f.motivo_anulacion,
      items: items.filter((i) => i.venta_id === f.id).map((i): VentaItem => ({
        productoId: i.producto_id, nombre: i.nombre, cantidad: i.cantidad, precioUnitario: i.precio_unitario, subtotal: i.subtotal, iva: i.iva, codigo: i.codigo ?? '',
      })),
      factura: fac
        ? {
            id: fac.id, prefijo: fac.prefijo, numero: fac.numero, numeroCompleto: numeroFactura(fac.prefijo, fac.numero), timbrado: fac.timbrado,
            fecha: fac.fecha, impresiones: fac.impresiones, anulada: fac.anulada_en !== null,
          } satisfies Factura
        : null,
    }
  })
}

async function unaVenta(db: BaseD1, id: string): Promise<Venta> {
  const [v] = await leerVentas(db, 'WHERE v.id = ?', id)
  if (!v) throw noEncontrado('No se encontró esa venta.')
  return v
}

rutasCaja.get('/ventas', verVentas, async (c) => {
  const q = c.req.query()
  const db = c.env.DB
  const partes: string[] = []
  const params: ValorSQL[] = []
  if (!vacio(q.caja)) {
    partes.push('v.caja_id = ?')
    params.push(texto(q.caja, 'la caja', { max: 100 }))
  } else if (!puede(c.get('usuario').rol, 'reportes.detallados')) {
    // El cajero (o la caja del comedor) ve las ventas de su caja abierta.
    const abierta = await cajaAbierta(db, puntoDelPedido(c))
    if (!abierta) return c.json<Venta[]>([])
    partes.push('v.caja_id = ?')
    params.push(abierta.id)
  }
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde) { partes.push('v.dia >= ?'); params.push(desde) }
  if (hasta) { partes.push('v.dia <= ?'); params.push(hasta) }
  return c.json<Venta[]>(await leerVentas(db, partes.length ? `WHERE ${partes.join(' AND ')}` : '', ...params))
})

rutasCaja.get('/ventas/:id', verVentas, async (c) => c.json<Venta>(await unaVenta(c.env.DB, c.req.param('id'))))

rutasCaja.post('/ventas', requiere('ventas.registrar'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const punto = puntoDe(u.rol)
  const caja = await cajaAbiertaObligatoria(db, punto)
  if (!Array.isArray(b.items) || b.items.length === 0) throw invalido('Agregá al menos un producto a la venta.')
  if (b.items.length > MAX_RENGLONES) throw invalido('Son demasiados productos en una sola venta.')
  const crudos = (b.items as unknown[]).map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
  const ids = crudos.map((x) => texto(x.productoId, 'el producto', { max: 100 }))
  const productos = new Map((await todasPorTrozos<FilaProductoVenta>(db, ids, (m) => `${sqlProductoVenta(punto)} WHERE p.id IN (${m})`)).map((p) => [p.id, p]))
  // Un mismo producto en varias líneas se junta.
  const juntas = new Map<string, number>()
  crudos.forEach((x, i) => {
    const p = productos.get(ids[i])
    if (!p) throw invalido('Ese producto no existe. Recargá la página y probá de nuevo.')
    if (!p.activo) throw invalido(`${p.nombre} está desactivado.`)
    if (p.precio_venta === null) throw invalido(`${p.nombre} no tiene precio de venta. Pedile al administrador que lo cargue.`)
    if (!p.en_esta_caja) {
      throw invalido(`La caja del comedor no vende ${p.categoria ?? 'Otros'}, así que ${p.nombre} no va acá. ` +
        'Lo vende la caja del frente, o el administrador suma esa categoría a «Venta comedor» en Depósitos.')
    }
    const n = x.cantidad
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100_000) throw invalido(`La cantidad de ${p.nombre} tiene que ser un número entero mayor que cero.`)
    juntas.set(p.id, (juntas.get(p.id) ?? 0) + n)
  })
  const lineas = [...juntas.entries()].map(([id, cantidad]) => {
    const p = productos.get(id)!
    return { p, cantidad, subtotal: cantidad * p.precio_venta! }
  })
  const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0)
  const descuento = vacio(b.descuento) ? 0 : importeGs(b.descuento, 'el descuento', 0)
  if (descuento > subtotal) throw invalido('El descuento no puede ser mayor que el total.')
  const total = subtotal - descuento
  // Cobro: un solo medio por el total (`medio`) o varias partes (`pagos`, pago híbrido) que suman justo el total.
  const partes = total === 0
    ? []
    : vacio(b.pagos)
      ? partesPago([{ medio: medioPago(b.medio), importe: total }])
      : partesPago(b.pagos)
  const cobrado = partes.reduce((s, x) => s + x.importe, 0)
  if (cobrado !== total) {
    throw invalido(cobrado < total
      ? `Las partes del cobro suman ${gs(cobrado)}: faltan ${gs(total - cobrado)} para el total (${gs(total)}).`
      : `Las partes del cobro suman ${gs(cobrado)}: pasan el total (${gs(total)}) por ${gs(cobrado - total)}.`)
  }
  const medio: MedioPago = partes.length ? medioPrincipal(partes) : vacio(b.medio) ? 'efectivo' : medioPago(b.medio)
  const efectivo = partes.filter((x) => x.medio === 'efectivo').reduce((s, x) => s + x.importe, 0)
  let recibido: number | null = null
  if (efectivo > 0 && !vacio(b.recibido)) {
    recibido = importeGs(b.recibido, 'lo que entregó el cliente', 0)
    const que = efectivo === total ? 'el total' : 'la parte en efectivo'
    if (recibido < efectivo) throw invalido(`Lo que entregó el cliente (${gs(recibido)}) no alcanza para ${que} (${gs(efectivo)}).`)
  }
  const clienteNombre = textoOpcional(b.clienteNombre, 'El nombre del cliente', 120) ?? ''
  const clienteRuc = textoOpcional(b.clienteRuc, 'El RUC o CI del cliente', 30) ?? ''
  const clienteDireccion = textoOpcional(b.clienteDireccion, 'La dirección del cliente', 120) ?? ''

  const id = nuevoId()
  const { fecha, dia } = ahora()
  // Lo vendido sale de Venta frente (la materia prima, de Materia prima); en un sector con lotes, de los más viejos
  // primero. Lo «sin stock» (el buffet) solo queda en la venta.
  const salidas = (await Promise.all(lineas.filter((l) => !l.p.sin_stock).map(async (l) => (
    l.p.con_lotes ? await repartirPorLotes(db, l.p.sector, l.p.id, l.p.deposito_id, l.cantidad) : [{ lote: null, cantidad: l.cantidad }]
  ).map((parte) => ({ p: l.p, ...parte }))))).flat()
  const sentencias: SentenciaD1[] = [
    sentencia(
      db,
      `INSERT INTO ventas (id, numero, caja_id, cliente_nombre, cliente_ruc, cliente_direccion, subtotal, descuento, total, medio, recibido, usuario_id, fecha, dia)
       VALUES (?, (SELECT COALESCE(MAX(numero), 0) + 1 FROM ventas), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, caja.id, clienteNombre, clienteRuc, clienteDireccion, subtotal, descuento, total, medio, recibido, u.id, fecha, dia,
    ),
    ...partes.map((x, i) => sentencia(
      db,
      'INSERT INTO venta_pagos (id, venta_id, orden, medio, importe, banco, cheque_numero) VALUES (?, ?, ?, ?, ?, ?, ?)',
      nuevoId(), id, i, x.medio, x.importe, x.banco, x.chequeNumero,
    )),
    ...lineas.map((l, i) => sentencia(
      db,
      'INSERT INTO venta_items (id, venta_id, orden, producto_id, nombre, cantidad, precio_unitario, subtotal, iva) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      nuevoId(), id, i, l.p.id, l.p.nombre, l.cantidad, l.p.precio_venta, l.subtotal, l.p.iva,
    )),
    ...salidas.map((x) => sentenciaMovimiento(db, {
      id: nuevoId(), sector: x.p.sector, productoId: x.p.id, depositoId: x.p.deposito_id, lote: x.lote, tipo: 'venta', cantidad: -x.cantidad,
      motivo: 'Venta en caja', ventaId: id, usuarioId: u.id, fecha, dia,
    })),
  ]
  try {
    await db.batch(sentencias)
  } catch (e) {
    if (esCajaCerrada(e)) throw cajaCerradaError()
    throw e
  }
  return c.json<Venta>(await unaVenta(db, id))
})

rutasCaja.post('/ventas/:id/anular', requiere('ventas.anular'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const motivo = texto(b.motivo, 'el motivo', { max: 300 })
  const venta = await unaVenta(db, c.req.param('id'))
  if (venta.anulada) throw conflicto('venta_anulada', 'Esa venta ya está anulada.')
  const caja = await una<{ cerrada_en: string | null; punto: PuntoCaja }>(db, 'SELECT cerrada_en, punto FROM cajas WHERE id = ?', venta.cajaId)
  if (caja) soloSuCaja(u.rol, caja.punto)
  if (caja?.cerrada_en) throw conflicto('caja_cerrada', 'Esa venta es de una caja que ya se cerró: no se puede anular.')
  const movs = await todas<{ sector: SectorId; producto_id: string; deposito_id: string; lote: string | null; cantidad: number }>(
    db, `SELECT sector, producto_id, deposito_id, lote, cantidad FROM movimientos WHERE venta_id = ? AND tipo = 'venta'`, venta.id,
  )
  const { fecha, dia } = ahora()
  await db.batch([
    sentencia(db, 'UPDATE ventas SET anulada_por = ?, anulada_en = ?, motivo_anulacion = ? WHERE id = ? AND anulada_en IS NULL', u.id, fecha, motivo, venta.id),
    sentencia(db, 'UPDATE facturas SET anulada_en = ? WHERE venta_id = ? AND anulada_en IS NULL', fecha, venta.id),
    // Vuelve al stock lo que la venta había descontado (con el mismo tipo, en positivo).
    ...movs.filter((m) => m.cantidad < 0).map((m) => sentenciaMovimiento(db, {
      id: nuevoId(), sector: m.sector, productoId: m.producto_id, depositoId: m.deposito_id, lote: m.lote, tipo: 'venta', cantidad: -m.cantidad,
      motivo: `Anulación de la venta N° ${venta.numero}`, ventaId: venta.id, usuarioId: u.id, fecha, dia,
    })),
    sentenciaAuditoria(db, { tabla: 'ventas', registroId: venta.id, accion: 'anular', usuarioId: u.id, antes: venta, despues: { anulada: true, motivo } }),
  ])
  return c.json<Venta>(await unaVenta(db, venta.id))
})

// ---------- Factura preimpresa (M12) ----------

/**
 * Hoja de Chipa Tía E.A.S. (imprenta Kike): OFICIO (216 × 330 mm) con original arriba y duplicado abajo, cada copia en
 * media hoja (165 mm). Medidas sacadas de la foto de la hoja vacía enderezada (perspectiva corregida, líneas rectas) y
 * llevadas a oficio (Mati, 2026-11-24: la hoja es oficio, no A4): la tabla va de x 9,6 a 206,4 mm y de y 65,2 a 157,7 mm
 * en cada copia. Se afinan en Caja → Factura con una hoja de prueba.
 */
export const FACTURA_POR_DEFECTO: ConfigFactura = {
  version: 4,
  timbrado: '18980642',
  prefijo: '001-002',
  numeroInicial: 1775,
  numeroFinal: 2000,
  venceTimbrado: '2027-07-31',
  anchoHoja: 216,
  altoHoja: 330,
  margenIzquierdo: 0,
  margenSuperior: 0,
  tamanoLetra: 9,
  duplicado: { x: 0, y: 165 },
  contado: { x: 163, y: 41.6 },
  fecha: { x: 42.7, y: 41.8 },
  ruc: { x: 168.7, y: 51.1 },
  cliente: { x: 30.9, y: 50.9 },
  direccion: { x: 31.9, y: 58.4 },
  detalle: { x: 0, y: 76.3 },
  altoRenglon: 4.8,
  maxRenglones: 10,
  columnaCodigo: 11.1,
  columnaCantidad: 35.4,
  columnaDescripcion: 38.5,
  columnaPrecio: 145.7,
  columnaExentas: 165.6,
  columna5: 185.5,
  columna10: 204.9,
  subtotales: { x: 0, y: 125.1 },
  total: { x: 204.9, y: 132.3 },
  totalLetras: { x: 65.3, y: 132.3 },
  iva5: { x: 76.1, y: 140.1 },
  iva10: { x: 119.8, y: 140.1 },
  totalIva: { x: 176.4, y: 140.1 },
}

const CLAVE_FACTURA = 'factura'

export async function leerConfigFactura(db: BaseD1): Promise<ConfigFactura> {
  const f = await una<{ valor: string }>(db, 'SELECT valor FROM configuracion WHERE clave = ?', CLAVE_FACTURA)
  if (!f) return { ...FACTURA_POR_DEFECTO }
  try {
    const guardada = JSON.parse(f.valor) as Partial<ConfigFactura>
    if ((guardada.version ?? 1) >= FACTURA_POR_DEFECTO.version) return { ...FACTURA_POR_DEFECTO, ...guardada }
    // Formato viejo (genérico A5, oficio estimado sin enderezar la foto, o A4): las posiciones no sirven para la hoja
    // oficio; solo se respeta la numeración si se cargó.
    if (!guardada.timbrado) return { ...FACTURA_POR_DEFECTO }
    const numeracion = { timbrado: guardada.timbrado, prefijo: guardada.prefijo, numeroInicial: guardada.numeroInicial, numeroFinal: guardada.numeroFinal, venceTimbrado: guardada.venceTimbrado }
    return { ...FACTURA_POR_DEFECTO, ...Object.fromEntries(Object.entries(numeracion).filter(([, v]) => v !== undefined)) }
  } catch {
    return { ...FACTURA_POR_DEFECTO }
  }
}

/** El número que le tocaría a la próxima factura (sin reservarlo). */
async function proximoNumero(db: BaseD1, config: ConfigFactura): Promise<number> {
  const f = await una<{ n: number | null }>(db, 'SELECT MAX(numero) AS n FROM facturas WHERE prefijo = ?', config.prefijo)
  return Math.max(f?.n ?? 0, config.numeroInicial - 1) + 1
}

function mm(v: unknown, campo: string, max = 400): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -50 || v > max) throw invalido(`${campo} tiene que ser un número de milímetros entre -50 y ${max}.`)
  return Math.round(v * 10) / 10
}

function leerConfig(b: Record<string, unknown>, actual: ConfigFactura): ConfigFactura {
  const r: ConfigFactura = { ...actual }
  if (b.timbrado !== undefined) r.timbrado = textoOpcional(b.timbrado, 'El timbrado', 20) ?? ''
  if (b.prefijo !== undefined) {
    const p = texto(b.prefijo, 'el establecimiento y punto de expedición', { max: 7 })
    if (!/^\d{3}-\d{3}$/.test(p)) throw invalido('El establecimiento y punto de expedición va como 001-001.')
    r.prefijo = p
  }
  if (b.numeroInicial !== undefined) {
    if (typeof b.numeroInicial !== 'number' || !Number.isInteger(b.numeroInicial) || b.numeroInicial < 1 || b.numeroInicial > 9_999_999) {
      throw invalido('El número inicial tiene que estar entre 1 y 9.999.999.')
    }
    r.numeroInicial = b.numeroInicial
  }
  if (b.numeroFinal !== undefined) {
    if (typeof b.numeroFinal !== 'number' || !Number.isInteger(b.numeroFinal) || b.numeroFinal < 0 || b.numeroFinal > 9_999_999) {
      throw invalido('El último número del talonario tiene que estar entre 0 (sin límite) y 9.999.999.')
    }
    r.numeroFinal = b.numeroFinal
  }
  if (b.venceTimbrado !== undefined) {
    const v = textoOpcional(b.venceTimbrado, 'El vencimiento del timbrado', 10) ?? ''
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalido('El vencimiento del timbrado va como fecha (AAAA-MM-DD).')
    r.venceTimbrado = v
  }
  for (const k of ['anchoHoja', 'altoHoja', 'margenIzquierdo', 'margenSuperior', 'altoRenglon', 'columnaCodigo', 'columnaCantidad', 'columnaDescripcion',
    'columnaPrecio', 'columnaExentas', 'columna5', 'columna10'] as const) {
    if (b[k] !== undefined) r[k] = mm(b[k], k)
  }
  if (b.tamanoLetra !== undefined) r.tamanoLetra = mm(b.tamanoLetra, 'El tamaño de letra', 30)
  if (b.maxRenglones !== undefined) {
    if (typeof b.maxRenglones !== 'number' || !Number.isInteger(b.maxRenglones) || b.maxRenglones < 1 || b.maxRenglones > 60) throw invalido('Los renglones tienen que estar entre 1 y 60.')
    r.maxRenglones = b.maxRenglones
  }
  for (const k of ['duplicado', 'fecha', 'contado', 'cliente', 'ruc', 'direccion', 'detalle', 'subtotales', 'total', 'totalLetras', 'iva5', 'iva10', 'totalIva'] as const) {
    if (b[k] === undefined) continue
    const p = (b[k] && typeof b[k] === 'object' ? b[k] : {}) as Record<string, unknown>
    r[k] = { x: mm(p.x, `${k} x`), y: mm(p.y, `${k} y`) }
  }
  r.version = FACTURA_POR_DEFECTO.version
  return r
}

rutasCaja.get('/factura/config', requiere('facturas.generar'), async (c) => c.json<ConfigFactura>(await leerConfigFactura(c.env.DB)))

/** La próxima factura que va a salir, para que el administrador la compare con la hoja que sigue en el talonario. */
rutasCaja.get('/factura/proxima', requiere('facturas.configurar'), async (c) => {
  const config = await leerConfigFactura(c.env.DB)
  const numero = await proximoNumero(c.env.DB, config)
  return c.json({ numero, numeroCompleto: numeroFactura(config.prefijo, numero) })
})

rutasCaja.put('/factura/config', requiere('facturas.configurar', 'El formato de la factura lo configura el administrador.'), async (c) => {
  const db = c.env.DB
  const antes = await leerConfigFactura(db)
  const despues = leerConfig(await cuerpo(c), antes)
  await db.batch([
    sentencia(db, 'INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', CLAVE_FACTURA, JSON.stringify(despues)),
    sentenciaAuditoria(db, { tabla: 'configuracion', registroId: CLAVE_FACTURA, accion: 'editar', usuarioId: c.get('usuario').id, antes, despues }),
  ])
  return c.json<ConfigFactura>(despues)
})

/**
 * Factura de una venta: la primera vez le asigna el número siguiente (o el inicial configurado); las siguientes la
 * reimprimen con el mismo número.
 */
rutasCaja.post('/ventas/:id/factura', requiere('facturas.generar'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const venta = await unaVenta(db, c.req.param('id'))
  if (venta.anulada) throw conflicto('venta_anulada', 'Esa venta está anulada: no se le puede imprimir factura.')
  const config = await leerConfigFactura(db)
  if (venta.factura) {
    await db.batch([sentencia(db, 'UPDATE facturas SET impresiones = impresiones + 1 WHERE id = ?', venta.factura.id)])
  } else {
    const { fecha, dia } = ahora()
    if (config.venceTimbrado && dia > config.venceTimbrado) {
      throw conflicto('timbrado_vencido', `El timbrado ${config.timbrado} venció el ${diaLegible(config.venceTimbrado)}. Cargá el timbrado nuevo en Caja → Factura.`)
    }
    if (config.numeroFinal && (await proximoNumero(db, config)) > config.numeroFinal) {
      throw conflicto('talonario_agotado', `Se terminaron las facturas autorizadas (hasta la ${numeroFactura(config.prefijo, config.numeroFinal)}). Cargá el talonario nuevo en Caja → Factura.`)
    }
    for (let intento = 0; ; intento++) {
      try {
        await db.batch([sentencia(
          db,
          `INSERT INTO facturas (id, venta_id, prefijo, numero, timbrado, usuario_id, fecha)
           VALUES (?, ?, ?, MAX(COALESCE((SELECT MAX(numero) FROM facturas WHERE prefijo = ?), 0), ? - 1) + 1, ?, ?, ?)`,
          nuevoId(), venta.id, config.prefijo, config.prefijo, config.numeroInicial, config.timbrado, u.id, fecha,
        )])
        break
      } catch (e) {
        // Dos facturas a la vez: la segunda toma el número siguiente.
        if (intento < 2 && e instanceof Error && /UNIQUE/i.test(e.message) && !/venta_id/.test(e.message)) continue
        throw e
      }
    }
  }
  return c.json<{ venta: Venta; config: ConfigFactura }>({ venta: await unaVenta(db, venta.id), config })
})
