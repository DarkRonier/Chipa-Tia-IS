// Lecturas que comparten varios módulos (producción, stock, lotes, trazabilidad, reportes).
// Cada una arma el objeto de src/shared/tipos.ts listo para devolver por la API.
import { diaLegible, diaPY } from '../shared/hora'
import type { Finalidad, LoteChipa, LoteMP, Movimiento, Produccion, SectorId, TipoMovimiento, Turno } from '../shared/tipos'
import { todas, todasPorTrozos } from './db'
import type { BaseD1, ValorSQL } from './entorno'

/** Arma "WHERE a AND b" con sus parámetros, salteando los filtros vacíos. */
class Filtro {
  partes: string[] = []
  params: ValorSQL[] = []
  si(condicion: boolean, sql: string, ...params: ValorSQL[]) {
    if (condicion) {
      this.partes.push(sql)
      this.params.push(...params)
    }
    return this
  }
  get where() {
    return this.partes.length ? `WHERE ${this.partes.join(' AND ')}` : ''
  }
}

const lleno = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null && (v as unknown) !== ''

// ---------- Lotes de materia prima (E01, E07) ----------

interface FilaLoteMP {
  id: string
  insumo: string
  proveedor: string
  numero_lote: string
  fecha_ingreso: string
  cantidad: number
  unidad: string
  vencimiento: string
  bloqueado: number
  creado_en: string
  /** Suma de lote_chipa_mp.cantidad (E03); solo viene en las lecturas de leerLotesMP. */
  consumido?: number
}

/** Evita que 0,1 + 0,2 deje un saldo de 0,0000000001 en vez de cero. */
const redondear = (n: number) => Math.round(n * 1000) / 1000

/** "Queso · Lácteos Tatiana · lote 0210", o con la fecha de ingreso si no hay número (como en la planilla). */
export function descripcionLoteMP(f: Pick<FilaLoteMP, 'insumo' | 'proveedor' | 'numero_lote' | 'fecha_ingreso'>): string {
  const lote = f.numero_lote ? `lote ${f.numero_lote}` : `ingreso ${diaLegible(f.fecha_ingreso)}`
  return `${f.insumo} · ${f.proveedor} · ${lote}`
}

function aLoteMP(f: FilaLoteMP, hoy: string): LoteMP {
  const bloqueado = !!f.bloqueado
  const consumido = redondear(f.consumido ?? 0)
  const saldo = Math.max(0, redondear(f.cantidad - consumido))
  return {
    id: f.id,
    insumo: f.insumo,
    proveedor: f.proveedor,
    numeroLote: f.numero_lote,
    fechaIngreso: f.fecha_ingreso,
    cantidad: f.cantidad,
    unidad: f.unidad,
    vencimiento: f.vencimiento,
    bloqueado,
    consumido,
    saldo,
    agotado: saldo <= 0,
    disponible: !bloqueado && f.vencimiento >= hoy && saldo > 0,
    descripcion: descripcionLoteMP(f),
    creadoEn: f.creado_en,
  }
}

/** Cada lote de materia prima con lo que ya consumieron las amasadas (E03). */
const COLUMNAS_LOTE_MP = `SELECT mp.*, COALESCE((SELECT SUM(r.cantidad) FROM lote_chipa_mp r WHERE r.lote_mp_id = mp.id), 0) AS consumido
    FROM lotes_mp mp`

/** Lotes de materia prima, el ingreso más nuevo primero. `disponibles`: ni bloqueados, ni vencidos hoy, ni agotados (E07). */
export async function leerLotesMP(db: BaseD1, filtro: {
  ids?: string[]
  disponibles?: boolean
  /** Sin bloquear, con saldo y que vencen hasta este día inclusive (incluye los ya vencidos): para las alertas (E10). */
  venceHasta?: string
} = {}): Promise<LoteMP[]> {
  const hoy = diaPY()
  if (filtro.ids) {
    if (!filtro.ids.length) return []
    const filas = await todasPorTrozos<FilaLoteMP>(db, filtro.ids, (m) => `${COLUMNAS_LOTE_MP} WHERE mp.id IN (${m})`)
    return filas.map((f) => aLoteMP(f, hoy)).filter((l) => !filtro.disponibles || l.disponible)
      .sort((a, b) => b.fechaIngreso.localeCompare(a.fechaIngreso) || b.creadoEn.localeCompare(a.creadoEn))
  }
  const w = new Filtro()
    .si(!!filtro.disponibles, 'mp.bloqueado = 0 AND mp.vencimiento >= ?', hoy)
    .si(lleno(filtro.venceHasta), 'mp.bloqueado = 0 AND mp.vencimiento <= ?', filtro.venceHasta ?? null)
  const filas = await todas<FilaLoteMP>(db, `${COLUMNAS_LOTE_MP} ${w.where} ORDER BY mp.fecha_ingreso DESC, mp.creado_en DESC`, ...w.params)
  return filas.map((f) => aLoteMP(f, hoy)).filter((l) => (!filtro.disponibles || l.disponible) && (!filtro.venceHasta || !l.agotado))
}

// ---------- Lotes de chipa (E03–E05) ----------

interface FilaLoteChipa {
  id: string
  codigo: string
  produccion_id: string | null
  amasada: number
  dia: string
  horno: number
  congelador: number
  stock: number
}

/**
 * Lotes de chipa con lo que fue al horno (cocinado), al congelador (guardado), lo que queda en stock
 * y los lotes de materia prima usados. El más nuevo primero.
 */
export async function leerLotesChipa(db: BaseD1, filtro: {
  ids?: string[]
  codigos?: string[]
  produccionIds?: string[]
  /** Lotes que usaron este lote de materia prima. */
  loteMpId?: string
  desde?: string | null
  hasta?: string | null
} = {}): Promise<LoteChipa[]> {
  const columnas = `SELECT l.id, l.codigo, l.produccion_id, l.amasada, l.dia,
      COALESCE((SELECT SUM(i.cocinado) FROM produccion_items i WHERE i.produccion_id = l.produccion_id), 0) AS horno,
      COALESCE((SELECT SUM(i.guardado) FROM produccion_items i WHERE i.produccion_id = l.produccion_id), 0) AS congelador,
      COALESCE((SELECT SUM(m.cantidad) FROM movimientos m WHERE m.sector = 'chiperia' AND m.lote = l.codigo), 0) AS stock
    FROM lotes_chipa l`
  const orden = 'ORDER BY l.dia DESC, l.amasada DESC'
  let filas: FilaLoteChipa[]
  const lista = filtro.ids ? ['l.id', filtro.ids] : filtro.codigos ? ['l.codigo', filtro.codigos] : filtro.produccionIds ? ['l.produccion_id', filtro.produccionIds] : null
  if (lista) {
    const [col, ids] = lista as [string, string[]]
    if (!ids.length) return []
    filas = await todasPorTrozos<FilaLoteChipa>(db, ids, (m) => `${columnas} WHERE ${col} IN (${m})`)
    filas.sort((a, b) => b.dia.localeCompare(a.dia) || b.amasada - a.amasada)
  } else {
    const w = new Filtro()
      .si(lleno(filtro.loteMpId), 'l.id IN (SELECT lote_chipa_id FROM lote_chipa_mp WHERE lote_mp_id = ?)', filtro.loteMpId ?? null)
      .si(lleno(filtro.desde), 'l.dia >= ?', filtro.desde ?? null)
      .si(lleno(filtro.hasta), 'l.dia <= ?', filtro.hasta ?? null)
    filas = await todas<FilaLoteChipa>(db, `${columnas} ${w.where} ${orden}`, ...w.params)
  }
  if (!filas.length) return []
  const usados = await todasPorTrozos<FilaLoteMP & { lote_chipa_id: string; uso: number | null }>(
    db, filas.map((f) => f.id),
    (m) => `SELECT r.lote_chipa_id, r.cantidad AS uso, mp.* FROM lote_chipa_mp r JOIN lotes_mp mp ON mp.id = r.lote_mp_id
             WHERE r.lote_chipa_id IN (${m}) ORDER BY mp.insumo, mp.fecha_ingreso`,
  )
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    produccionId: f.produccion_id,
    amasada: f.amasada,
    dia: f.dia,
    horno: f.horno,
    congelador: f.congelador,
    stock: f.stock,
    lotesMP: usados.filter((u) => u.lote_chipa_id === f.id)
      .map((u) => ({ id: u.id, descripcion: descripcionLoteMP(u), cantidad: u.uso, unidad: u.unidad })),
  }))
}

// ---------- Producciones (C01–C04) ----------

interface FilaProduccion {
  id: string
  sector: SectorId
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia: string
  turno: Turno
  corregido_por: string | null
  corregido_por_nombre: string | null
  corregido_en: string | null
}

/** Registros de producción con sus productos y, en Chipería, su lote. El más nuevo primero. */
export async function leerProducciones(db: BaseD1, filtro: {
  ids?: string[]
  sector?: SectorId | null
  desde?: string | null
  hasta?: string | null
  limite?: number
} = {}): Promise<Produccion[]> {
  const columnas = `SELECT p.id, p.sector, p.usuario_id, u.nombre AS usuario_nombre, p.fecha, p.dia, p.turno,
      p.corregido_por, c.nombre AS corregido_por_nombre, p.corregido_en
    FROM producciones p JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN usuarios c ON c.id = p.corregido_por`
  let filas: FilaProduccion[]
  if (filtro.ids) {
    if (!filtro.ids.length) return []
    filas = await todasPorTrozos<FilaProduccion>(db, filtro.ids, (m) => `${columnas} WHERE p.id IN (${m})`)
    filas.sort((a, b) => b.fecha.localeCompare(a.fecha))
  } else {
    const w = new Filtro()
      .si(lleno(filtro.sector), 'p.sector = ?', filtro.sector ?? null)
      .si(lleno(filtro.desde), 'p.dia >= ?', filtro.desde ?? null)
      .si(lleno(filtro.hasta), 'p.dia <= ?', filtro.hasta ?? null)
    filas = await todas<FilaProduccion>(db, `${columnas} ${w.where} ORDER BY p.fecha DESC LIMIT ?`, ...w.params, filtro.limite ?? 1000)
  }
  if (!filas.length) return []
  const ids = filas.map((f) => f.id)
  const items = await todasPorTrozos<{ produccion_id: string; producto_id: string; nombre: string; cocinado: number; guardado: number; finalidad: Finalidad }>(
    db, ids,
    (m) => `SELECT i.produccion_id, i.producto_id, pr.nombre, i.cocinado, i.guardado, i.finalidad
              FROM produccion_items i JOIN productos pr ON pr.id = i.producto_id
             WHERE i.produccion_id IN (${m}) ORDER BY pr.orden, pr.nombre`,
  )
  const lotes = filas.some((f) => f.sector === 'chiperia')
    ? await leerLotesChipa(db, { produccionIds: filas.filter((f) => f.sector === 'chiperia').map((f) => f.id) })
    : []
  return filas.map((f) => ({
    id: f.id,
    sector: f.sector,
    usuarioId: f.usuario_id,
    usuarioNombre: f.usuario_nombre,
    fecha: f.fecha,
    dia: f.dia,
    turno: f.turno,
    items: items.filter((i) => i.produccion_id === f.id).map((i) => ({
      productoId: i.producto_id, productoNombre: i.nombre, cocinado: i.cocinado, guardado: i.guardado, finalidad: i.finalidad,
    })),
    lote: lotes.find((l) => l.produccionId === f.id) ?? null,
    corregidoPor: f.corregido_por,
    corregidoPorNombre: f.corregido_por_nombre,
    corregidoEn: f.corregido_en,
  }))
}

// ---------- Movimientos de stock (D01–D07) ----------

interface FilaMovimiento {
  id: string
  sector: SectorId
  producto_id: string
  producto_nombre: string
  lote: string | null
  tipo: TipoMovimiento
  cantidad: number
  finalidad: Finalidad
  motivo: string | null
  sucursal_id: string | null
  sucursal_nombre: string | null
  envio_id: string | null
  produccion_id: string | null
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia: string
}

export interface FiltroMovimientos {
  ids?: string[]
  sector?: SectorId | null
  desde?: string | null
  hasta?: string | null
  sucursal?: string | null
  producto?: string | null
  tipos?: TipoMovimiento[]
  lote?: string | null
  /** Movimientos de cualquiera de estos lotes de chipa. */
  lotes?: string[]
  envioId?: string | null
  produccionId?: string | null
  limite?: number
}

const aMovimiento = (f: FilaMovimiento): Movimiento => ({
  id: f.id,
  sector: f.sector,
  productoId: f.producto_id,
  productoNombre: f.producto_nombre,
  lote: f.lote,
  tipo: f.tipo,
  cantidad: f.cantidad,
  finalidad: f.finalidad,
  motivo: f.motivo,
  sucursalId: f.sucursal_id,
  sucursalNombre: f.sucursal_nombre,
  envioId: f.envio_id,
  produccionId: f.produccion_id,
  usuarioId: f.usuario_id,
  usuarioNombre: f.usuario_nombre,
  fecha: f.fecha,
  dia: f.dia,
})

/** Movimientos del libro de stock con nombres de producto, sucursal y usuario. El más nuevo primero. */
export async function leerMovimientos(db: BaseD1, filtro: FiltroMovimientos = {}): Promise<Movimiento[]> {
  const columnas = `SELECT m.id, m.sector, m.producto_id, p.nombre AS producto_nombre, m.lote, m.tipo, m.cantidad, m.finalidad, m.motivo,
      m.sucursal_id, s.nombre AS sucursal_nombre, m.envio_id, m.produccion_id, m.usuario_id, u.nombre AS usuario_nombre,
      m.fecha, m.dia
    FROM movimientos m
    JOIN productos p ON p.id = m.producto_id
    JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN sucursales s ON s.id = m.sucursal_id`
  if (filtro.ids || filtro.lotes) {
    const [col, ids] = filtro.ids ? ['m.id', filtro.ids] : ['m.lote', filtro.lotes!]
    if (!ids.length) return []
    const filas = await todasPorTrozos<FilaMovimiento>(db, ids, (m) => `${columnas} WHERE ${col} IN (${m})`)
    return filas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(aMovimiento)
  }
  const tipos = filtro.tipos ?? []
  const w = new Filtro()
    .si(lleno(filtro.sector), 'm.sector = ?', filtro.sector ?? null)
    .si(lleno(filtro.desde), 'm.dia >= ?', filtro.desde ?? null)
    .si(lleno(filtro.hasta), 'm.dia <= ?', filtro.hasta ?? null)
    .si(lleno(filtro.sucursal), 'm.sucursal_id = ?', filtro.sucursal ?? null)
    .si(lleno(filtro.producto), 'm.producto_id = ?', filtro.producto ?? null)
    .si(tipos.length > 0, `m.tipo IN (${tipos.map(() => '?').join(', ')})`, ...tipos)
    .si(lleno(filtro.lote), 'm.lote = ?', filtro.lote ?? null)
    .si(lleno(filtro.envioId), 'm.envio_id = ?', filtro.envioId ?? null)
    .si(lleno(filtro.produccionId), 'm.produccion_id = ?', filtro.produccionId ?? null)
  const filas = await todas<FilaMovimiento>(
    db, `${columnas} ${w.where} ORDER BY m.fecha DESC, m.id LIMIT ?`, ...w.params, filtro.limite ?? 2000,
  )
  return filas.map(aMovimiento)
}
