// M14: ingresos y egresos, gastos fijos (sueldos incluidos) y el reporte detallado del administrador.
// - Lo que viene de otros módulos entra solo y no se carga a mano: las ventas (ingreso, por día y medio de pago) y los
//   pagos a proveedores (egreso). Así nada se cuenta dos veces.
// - A mano (solo el administrador) se cargan los demás movimientos: fecha, concepto, categoría, importe y medio. Si
//   el dinero sale de la caja abierta (o entra a ella), queda también como movimiento de esa caja, en el mismo paso.
// - Gastos fijos: el administrador define cada uno (alquiler, luz, cada sueldo…) con su importe y el día del mes en
//   que vence. Cada mes se marca como pagado y queda como un egreso. Los sueldos son gastos fijos con la marca
//   «sueldo»; no hay módulo de sueldos (Mati, 2026-11-14).
// - El supervisor solo ve los egresos por pagos a proveedores.
import { Hono } from 'hono'
import type { Alerta } from '../../shared/alertas'
import { diaLegible, inicioDeMes } from '../../shared/hora'
import { puede } from '../../shared/permisos'
import {
  MEDIOS_PAGO, describirParte,
  type GastoFijo, type GastoFijoMes, type MedioPago, type MovimientoIE, type ReporteDetallado, type ResumenIE,
} from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { ahora, nuevoId, sentencia, todas, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1 } from '../entorno'
import { conflicto, invalido, noEncontrado, prohibido } from '../errores'
import { requiere } from '../sesion'
import { booleano, cuerpo, dia, diaOpcional, texto } from '../validar'
import {
  cajaAbierta, cajaCerradaError, esCajaCerrada, importeGs, leerCajas, leerVentas, medioPago, sentenciaMovimientoCaja,
  sentenciasAnularMovimientoCaja,
} from './caja'
import { reporteCompras } from './compras'

export const rutasFinanzas = new Hono<Entorno>()

const SOLO_ADMIN = 'Ingresos y egresos los maneja el administrador.'
const vacio = (v: unknown) => v === undefined || v === null || v === ''

/** Categorías que se proponen al cargar (se puede escribir otra). */
export const CATEGORIAS_IE = {
  ingreso: ['Otros ingresos', 'Aporte de socios', 'Devolución', 'Intereses'],
  egreso: ['Servicios (luz, agua, internet)', 'Alquiler', 'Impuestos', 'Mantenimiento', 'Limpieza', 'Transporte', 'Sueldos', 'Otros gastos'],
}

/** Rango de fechas de la consulta; por defecto, el mes actual hasta hoy. */
function rango(q: Record<string, string>) {
  const hoy = ahora().dia
  const desde = vacio(q.desde) ? inicioDeMes(hoy) : dia(q.desde, 'La fecha desde')
  const hasta = vacio(q.hasta) ? hoy : dia(q.hasta, 'La fecha hasta')
  if (desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  return { desde, hasta }
}

// ---------- Gastos fijos y sueldos ----------

interface FilaGasto { id: string; nombre: string; categoria: string; importe: number; dia_del_mes: number; es_sueldo: number; activo: number }
const aGasto = (f: FilaGasto): GastoFijo => ({
  id: f.id, nombre: f.nombre, categoria: f.categoria, importe: f.importe, diaDelMes: f.dia_del_mes, esSueldo: !!f.es_sueldo, activo: !!f.activo,
})

function periodoDe(v: unknown): string {
  if (vacio(v)) return ahora().dia.slice(0, 7)
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw invalido('El mes va como AAAA-MM.')
  return v
}

/** Día en que vence un gasto fijo en un mes (el 31 en un mes de 30 días pasa al último día). */
function venceEn(periodo: string, diaDelMes: number): string {
  const [a, m] = periodo.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return `${periodo}-${String(Math.min(diaDelMes, ultimo)).padStart(2, '0')}`
}

export async function gastosDelMes(db: BaseD1, periodo: string): Promise<GastoFijoMes[]> {
  const filas = await todas<FilaGasto & { movimiento_id: string | null; importe_pagado: number | null }>(
    db,
    `SELECT g.*, m.id AS movimiento_id, m.importe AS importe_pagado
       FROM gastos_fijos g
       LEFT JOIN ie_movimientos m ON m.gasto_fijo_id = g.id AND m.periodo = ? AND m.anulado_en IS NULL
      WHERE g.activo = 1 OR m.id IS NOT NULL
      ORDER BY g.es_sueldo DESC, g.dia_del_mes, g.nombre`,
    periodo,
  )
  return filas.map((f) => ({
    ...aGasto(f), periodo, pagado: f.movimiento_id !== null, movimientoId: f.movimiento_id, importePagado: f.importe_pagado,
    vence: venceEn(periodo, f.dia_del_mes),
  }))
}

function datosGasto(b: Record<string, unknown>, antes?: GastoFijo): Omit<GastoFijo, 'id' | 'activo'> {
  const esSueldo = b.esSueldo !== undefined ? booleano(b.esSueldo, 'Sueldo') : antes?.esSueldo ?? false
  const diaDelMes = b.diaDelMes !== undefined ? b.diaDelMes : antes?.diaDelMes ?? 1
  if (typeof diaDelMes !== 'number' || !Number.isInteger(diaDelMes) || diaDelMes < 1 || diaDelMes > 31) throw invalido('El día del mes tiene que estar entre 1 y 31.')
  return {
    nombre: b.nombre !== undefined ? texto(b.nombre, 'el nombre', { max: 100 }) : antes!.nombre,
    categoria: b.categoria !== undefined ? texto(b.categoria, 'la categoría', { max: 60 }) : antes?.categoria ?? (esSueldo ? 'Sueldos' : 'Otros gastos'),
    importe: b.importe !== undefined ? importeGs(b.importe, 'el importe', 0) : antes!.importe,
    diaDelMes,
    esSueldo,
  }
}

rutasFinanzas.get('/gastos-fijos', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  return c.json<GastoFijoMes[]>(await gastosDelMes(c.env.DB, periodoDe(c.req.query('periodo'))))
})

rutasFinanzas.post('/gastos-fijos', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const db = c.env.DB
  const b = await cuerpo(c)
  if (b.esSueldo && vacio(b.categoria)) b.categoria = 'Sueldos'
  const nuevo: GastoFijo = { id: nuevoId(), ...datosGasto(b), activo: true }
  await db.batch([
    sentencia(db, 'INSERT INTO gastos_fijos (id, nombre, categoria, importe, dia_del_mes, es_sueldo, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      nuevo.id, nuevo.nombre, nuevo.categoria, nuevo.importe, nuevo.diaDelMes, nuevo.esSueldo, ahora().fecha),
    sentenciaAuditoria(db, { tabla: 'gastos_fijos', registroId: nuevo.id, accion: 'crear', usuarioId: c.get('usuario').id, despues: nuevo }),
  ])
  return c.json<GastoFijo>(nuevo)
})

rutasFinanzas.patch('/gastos-fijos/:id', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const db = c.env.DB
  const b = await cuerpo(c)
  const f = await una<FilaGasto>(db, 'SELECT * FROM gastos_fijos WHERE id = ?', c.req.param('id'))
  if (!f) throw noEncontrado('No se encontró ese gasto fijo.')
  const antes = aGasto(f)
  const despues: GastoFijo = { ...antes, ...datosGasto(b, antes) }
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  await db.batch([
    sentencia(db, 'UPDATE gastos_fijos SET nombre = ?, categoria = ?, importe = ?, dia_del_mes = ?, es_sueldo = ?, activo = ? WHERE id = ?',
      despues.nombre, despues.categoria, despues.importe, despues.diaDelMes, despues.esSueldo, despues.activo, antes.id),
    sentenciaAuditoria(db, { tabla: 'gastos_fijos', registroId: antes.id, accion: 'editar', usuarioId: c.get('usuario').id, antes, despues }),
  ])
  return c.json<GastoFijo>(despues)
})

/** Sentencias de un movimiento de I/E y, si sale de (o entra a) la caja abierta, su movimiento de caja. */
async function sentenciasIE(db: BaseD1, m: {
  id: string; tipo: 'ingreso' | 'egreso'; diaMov: string; concepto: string; categoria: string; importe: number; medio: MedioPago
  gastoFijoId: string | null; periodo: string | null; desdeCaja: boolean; usuarioId: string
}): Promise<SentenciaD1[]> {
  const { fecha, dia: hoy } = ahora()
  let cajaMovId: string | null = null
  const extra: SentenciaD1[] = []
  if (m.desdeCaja) {
    const caja = await cajaAbierta(db)
    if (!caja) throw conflicto('caja_cerrada', 'La caja está cerrada: no puede salir (ni entrar) dinero de ella. Desmarcá «desde la caja» o abrila.')
    cajaMovId = nuevoId()
    extra.push(sentenciaMovimientoCaja(db, {
      id: cajaMovId, cajaId: caja.id, tipo: m.tipo === 'egreso' ? 'retiro' : 'ingreso', medio: m.medio, importe: m.importe,
      concepto: m.concepto, origen: 'ie', origenId: m.id, usuarioId: m.usuarioId, fecha, dia: hoy,
    }))
  }
  return [
    ...extra,
    sentencia(
      db,
      `INSERT INTO ie_movimientos (id, tipo, dia_mov, concepto, categoria, importe, medio, gasto_fijo_id, periodo, caja_movimiento_id, usuario_id, fecha, dia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.id, m.tipo, m.diaMov, m.concepto, m.categoria, m.importe, m.medio, m.gastoFijoId, m.periodo, cajaMovId, m.usuarioId, fecha, hoy,
    ),
  ]
}

async function correr(db: BaseD1, sentencias: SentenciaD1[]) {
  try {
    await db.batch(sentencias)
  } catch (e) {
    if (esCajaCerrada(e)) throw cajaCerradaError()
    if (e instanceof Error && /UNIQUE/i.test(e.message) && /ie_movimientos/.test(e.message)) {
      throw conflicto('ya_pagado', 'Ese gasto fijo ya está pagado en ese mes.')
    }
    throw e
  }
}

rutasFinanzas.post('/gastos-fijos/:id/pagar', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const f = await una<FilaGasto>(db, 'SELECT * FROM gastos_fijos WHERE id = ?', c.req.param('id'))
  if (!f) throw noEncontrado('No se encontró ese gasto fijo.')
  const periodo = periodoDe(b.periodo)
  const ya = await una<{ id: string }>(db, 'SELECT id FROM ie_movimientos WHERE gasto_fijo_id = ? AND periodo = ? AND anulado_en IS NULL', f.id, periodo)
  if (ya) throw conflicto('ya_pagado', 'Ese gasto fijo ya está pagado en ese mes.')
  const importe = vacio(b.importe) ? f.importe : importeGs(b.importe, 'el importe')
  if (importe <= 0) throw invalido('El importe tiene que ser mayor que cero.')
  const hoy = ahora().dia
  const diaMov = diaOpcional(b.dia, 'La fecha') ?? hoy
  const [a, m] = periodo.split('-')
  await correr(db, await sentenciasIE(db, {
    id: nuevoId(), tipo: 'egreso', diaMov, concepto: `${f.nombre} (${m}/${a})`, categoria: f.es_sueldo ? 'Sueldos' : f.categoria, importe,
    medio: medioPago(b.medio ?? 'transferencia'), gastoFijoId: f.id, periodo, desdeCaja: b.desdeCaja === true, usuarioId: u.id,
  }))
  return c.json<GastoFijoMes[]>(await gastosDelMes(db, periodo))
})

/** Gastos fijos del mes actual ya vencidos y sin pagar (aviso para el administrador). */
export async function alertasGastosFijos(db: BaseD1): Promise<Alerta[]> {
  const hoy = ahora().dia
  return (await gastosDelMes(db, hoy.slice(0, 7)))
    .filter((g) => g.activo && !g.pagado && g.vence <= hoy && g.importe > 0)
    .map((g) => ({
      tipo: 'gasto_fijo_pendiente' as const,
      sector: null,
      texto: `${g.nombre} venció el ${diaLegible(g.vence)} y no está marcado como pagado.`,
      enlace: '/finanzas?ver=fijos',
    }))
}

// ---------- Movimientos manuales ----------

rutasFinanzas.post('/ie', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const db = c.env.DB
  const b = await cuerpo(c)
  if (b.tipo !== 'ingreso' && b.tipo !== 'egreso') throw invalido('Elegí si es un ingreso o un egreso.')
  const hoy = ahora().dia
  const diaMov = diaOpcional(b.dia, 'La fecha') ?? hoy
  if (diaMov > hoy) throw invalido('La fecha no puede ser posterior a hoy.')
  const id = nuevoId()
  await correr(db, await sentenciasIE(db, {
    id, tipo: b.tipo, diaMov, concepto: texto(b.concepto, 'el concepto', { max: 200 }), categoria: texto(b.categoria, 'la categoría', { max: 60 }),
    importe: importeGs(b.importe, 'el importe'), medio: medioPago(b.medio), gastoFijoId: null, periodo: null, desdeCaja: b.desdeCaja === true,
    usuarioId: c.get('usuario').id,
  }))
  return c.json({ id })
})

rutasFinanzas.post('/ie/:id/anular', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const motivo = texto(b.motivo, 'el motivo', { max: 300 })
  const f = await una<{ id: string; anulado_en: string | null; caja_movimiento_id: string | null }>(
    db, 'SELECT id, anulado_en, caja_movimiento_id FROM ie_movimientos WHERE id = ?', c.req.param('id'),
  )
  if (!f) throw noEncontrado('No se encontró ese movimiento.')
  if (f.anulado_en) throw conflicto('ya_anulado', 'Ese movimiento ya está anulado.')
  const { fecha } = ahora()
  await db.batch([
    ...(await sentenciasAnularMovimientoCaja(db, f.caja_movimiento_id, u.id, fecha)),
    sentencia(db, 'UPDATE ie_movimientos SET anulado_por = ?, anulado_en = ?, motivo_anulacion = ? WHERE id = ?', u.id, fecha, motivo, f.id),
  ])
  return c.json({ id: f.id })
})

// ---------- Consulta y resumen ----------

export async function resumenIE(db: BaseD1, desde: string, hasta: string, soloProveedores: boolean): Promise<ResumenIE> {
  const proveedores = await todas<{ id: string; dia_pago: string; importe: number; medio: MedioPago; banco: string; cheque_numero: string; proveedor: string; comprobante: string; usuario: string }>(
    db,
    `SELECT g.id, g.dia_pago, g.importe, g.medio, g.banco, g.cheque_numero, p.nombre AS proveedor, c.comprobante, u.nombre AS usuario
       FROM pagos_proveedor g JOIN compras c ON c.id = g.compra_id JOIN proveedores p ON p.id = g.proveedor_id JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.anulado_en IS NULL AND c.anulada_en IS NULL AND g.dia_pago >= ? AND g.dia_pago <= ?`,
    desde, hasta,
  )
  const movimientos: MovimientoIE[] = proveedores.map((g) => ({
    id: g.id, tipo: 'egreso', dia: g.dia_pago, concepto: `Pago a ${g.proveedor}${g.comprobante ? ` (${g.comprobante})` : ''}${g.banco ? ` · ${describirParte({ medio: g.medio, banco: g.banco, chequeNumero: g.cheque_numero })}` : ''}`,
    categoria: 'Pagos a proveedores', importe: g.importe, medio: g.medio, origen: 'proveedor', usuarioNombre: g.usuario, anulado: false, desdeCaja: false,
  }))
  if (!soloProveedores) {
    const [ventas, manuales] = await Promise.all([
      todas<{ dia: string; medio: MedioPago; total: number; cantidad: number }>(
        db,
        `SELECT v.dia, p.medio, SUM(p.importe) AS total, COUNT(DISTINCT v.id) AS cantidad
           FROM venta_pagos p JOIN ventas v ON v.id = p.venta_id
          WHERE v.anulada_en IS NULL AND v.dia >= ? AND v.dia <= ? GROUP BY v.dia, p.medio`,
        desde, hasta,
      ),
      todas<{ id: string; tipo: 'ingreso' | 'egreso'; dia_mov: string; concepto: string; categoria: string; importe: number; medio: MedioPago; gasto_fijo_id: string | null; usuario: string; anulado_en: string | null; caja_movimiento_id: string | null }>(
        db,
        `SELECT m.id, m.tipo, m.dia_mov, m.concepto, m.categoria, m.importe, m.medio, m.gasto_fijo_id, u.nombre AS usuario, m.anulado_en, m.caja_movimiento_id
           FROM ie_movimientos m JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.dia_mov >= ? AND m.dia_mov <= ?`,
        desde, hasta,
      ),
    ])
    movimientos.push(
      ...ventas.map((v): MovimientoIE => ({
        id: `ventas-${v.dia}-${v.medio}`, tipo: 'ingreso', dia: v.dia,
        concepto: `Ventas del día (${v.cantidad} ${v.cantidad === 1 ? 'venta' : 'ventas'})`, categoria: 'Ventas', importe: v.total, medio: v.medio,
        origen: 'venta', usuarioNombre: null, anulado: false, desdeCaja: false,
      })),
      ...manuales.map((m): MovimientoIE => ({
        id: m.id, tipo: m.tipo, dia: m.dia_mov, concepto: m.concepto, categoria: m.categoria, importe: m.importe, medio: m.medio,
        origen: m.gasto_fijo_id ? 'gasto_fijo' : 'manual', usuarioNombre: m.usuario, anulado: m.anulado_en !== null, desdeCaja: m.caja_movimiento_id !== null,
      })),
    )
  }
  movimientos.sort((a, b) => b.dia.localeCompare(a.dia) || a.tipo.localeCompare(b.tipo))
  const vigentes = movimientos.filter((m) => !m.anulado)
  const suma = (t: 'ingreso' | 'egreso') => vigentes.filter((m) => m.tipo === t).reduce((s, m) => s + m.importe, 0)
  const categorias = new Map<string, { tipo: 'ingreso' | 'egreso'; categoria: string; importe: number }>()
  for (const m of vigentes) {
    const k = `${m.tipo}|${m.categoria}`
    if (!categorias.has(k)) categorias.set(k, { tipo: m.tipo, categoria: m.categoria, importe: 0 })
    categorias.get(k)!.importe += m.importe
  }
  const ingresos = suma('ingreso')
  const egresos = suma('egreso')
  return {
    desde, hasta, soloProveedores, ingresos, egresos, resultado: ingresos - egresos,
    porCategoria: [...categorias.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || b.importe - a.importe),
    porMedio: MEDIOS_PAGO.map((medio) => ({
      medio,
      ingresos: vigentes.filter((m) => m.medio === medio && m.tipo === 'ingreso').reduce((s, m) => s + m.importe, 0),
      egresos: vigentes.filter((m) => m.medio === medio && m.tipo === 'egreso').reduce((s, m) => s + m.importe, 0),
    })).filter((x) => x.ingresos || x.egresos),
    movimientos,
  }
}

rutasFinanzas.get('/ie', async (c) => {
  const u = c.get('usuario')
  const completo = puede(u.rol, 'ie.completo')
  if (!completo && !puede(u.rol, 'ie.egresos_proveedores')) throw prohibido(SOLO_ADMIN)
  const { desde, hasta } = rango(c.req.query())
  return c.json<ResumenIE>(await resumenIE(c.env.DB, desde, hasta, !completo))
})

rutasFinanzas.get('/ie/categorias', requiere('ie.completo', SOLO_ADMIN), async (c) => {
  const usadas = await todas<{ tipo: 'ingreso' | 'egreso'; categoria: string }>(c.env.DB, 'SELECT DISTINCT tipo, categoria FROM ie_movimientos')
  const de = (t: 'ingreso' | 'egreso') => [...new Set([...CATEGORIAS_IE[t], ...usadas.filter((x) => x.tipo === t).map((x) => x.categoria)])]
  return c.json({ ingreso: de('ingreso'), egreso: de('egreso') })
})

// ---------- Reporte detallado (administrador) ----------

/** Meses (AAAA-MM) que toca el rango. */
function mesesEntre(desde: string, hasta: string): string[] {
  const r: string[] = []
  let [a, m] = desde.slice(0, 7).split('-').map(Number)
  const fin = hasta.slice(0, 7)
  for (;;) {
    const p = `${a}-${String(m).padStart(2, '0')}`
    r.push(p)
    if (p >= fin || r.length > 36) return r
    m++
    if (m > 12) { m = 1; a++ }
  }
}

rutasFinanzas.get('/reportes/detallado', requiere('reportes.detallados', 'El reporte detallado lo ve el administrador.'), async (c) => {
  const db = c.env.DB
  const { desde, hasta } = rango(c.req.query())
  const [ventas, cajas, ie, compras] = await Promise.all([
    leerVentas(db, 'WHERE v.dia >= ? AND v.dia <= ?', desde, hasta),
    leerCajas(db, 'WHERE c.dia >= ? AND c.dia <= ?', desde, hasta),
    resumenIE(db, desde, hasta, false),
    reporteCompras(db, desde, hasta),
  ])
  const vigentes = ventas.filter((v) => !v.anulada)
  const total = vigentes.reduce((s, v) => s + v.total, 0)
  const productos = new Map<string, { productoId: string; nombre: string; cantidad: number; importe: number }>()
  for (const v of vigentes) {
    for (const i of v.items) {
      if (!productos.has(i.productoId)) productos.set(i.productoId, { productoId: i.productoId, nombre: i.nombre, cantidad: 0, importe: 0 })
      const p = productos.get(i.productoId)!
      p.cantidad += i.cantidad
      p.importe += i.subtotal
    }
  }
  const dias = new Map<string, { dia: string; cantidad: number; importe: number }>()
  for (const v of vigentes) {
    if (!dias.has(v.dia)) dias.set(v.dia, { dia: v.dia, cantidad: 0, importe: 0 })
    dias.get(v.dia)!.cantidad++
    dias.get(v.dia)!.importe += v.total
  }
  // Sueldos y gastos fijos de los meses del rango.
  const gastos = (await Promise.all(mesesEntre(desde, hasta).map((p) => gastosDelMes(db, p)))).flat()
  const sueldos = gastos.filter((g) => g.esSueldo)
  const fijos = gastos.filter((g) => !g.esSueldo)
  const pagadoDe = (l: GastoFijoMes[]) => l.filter((g) => g.pagado).reduce((s, g) => s + (g.importePagado ?? 0), 0)
  const pendienteDe = (l: GastoFijoMes[]) => l.filter((g) => !g.pagado && g.activo).reduce((s, g) => s + g.importe, 0)
  const { movimientos: _m, soloProveedores: _s, desde: _d, hasta: _h, ...resumen } = ie
  return c.json<ReporteDetallado>({
    desde,
    hasta,
    ventas: {
      cantidad: vigentes.length,
      bruto: vigentes.reduce((s, v) => s + v.subtotal, 0),
      descuentos: vigentes.reduce((s, v) => s + v.descuento, 0),
      total,
      anuladas: ventas.length - vigentes.length,
      ticketPromedio: vigentes.length ? Math.round(total / vigentes.length) : 0,
      porMedio: MEDIOS_PAGO.map((medio) => {
        // Una venta con pago híbrido cuenta en cada medio que usó, con el importe de esa parte.
        const l = vigentes.filter((v) => v.pagos.some((x) => x.medio === medio))
        return { medio, cantidad: l.length, importe: l.reduce((s, v) => s + v.pagos.filter((x) => x.medio === medio).reduce((t, x) => t + x.importe, 0), 0) }
      }).filter((x) => x.cantidad),
      porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
      porProducto: [...productos.values()].sort((a, b) => b.importe - a.importe),
      facturas: vigentes.filter((v) => v.factura).length,
    },
    cajas,
    diferenciasCaja: cajas.reduce((s, x) => s + (x.diferencia ?? 0), 0),
    ie: resumen,
    sueldos: { pagados: pagadoDe(sueldos), pendientes: pendienteDe(sueldos), detalle: sueldos },
    gastosFijos: { pagados: pagadoDe(fijos), pendientes: pendienteDe(fijos) },
    compras: { total: compras.totalComprado, pagado: compras.totalPagado, deudaTotal: compras.deudaTotal },
  })
})
