// E01, E05–E07: lotes de materia prima, lotes de chipa y trazabilidad (Chipería y el administrador).
// Un lote de materia prima se identifica por insumo, proveedor y número de lote o fecha de ingreso,
// como en la planilla de producción de chipas. Nunca se borra: el administrador lo bloquea (E07).
// La trazabilidad sigue la cadena lote de materia prima → lotes de chipa (lote_chipa_mp) → envíos a
// sucursales (movimientos con el código del lote), y al revés.
import { Hono, type MiddlewareHandler } from 'hono'
import { diaPY } from '../../shared/hora'
import type { Alerta } from '../../shared/alertas'
import type {
  LoteChipa, LoteMP, Movimiento, Sucursal, TrazabilidadLote, TrazabilidadMP, TrazabilidadSucursal,
} from '../../shared/tipos'
import { alertasLotes } from '../alertasLotes'
import { sentenciaAuditoria } from '../auditoria'
import { leerLotesChipa, leerLotesMP, leerMovimientos, leerProducciones } from '../consultas'
import { ahora, nuevoId, sentencia, una } from '../db'
import type { BaseD1, Entorno } from '../entorno'
import { invalido, noEncontrado, prohibido } from '../errores'
import { soloAdmin } from '../sesion'
import { booleano, cuerpo, dia, diaOpcional, numero, texto, textoOpcional } from '../validar'

export const rutasLotes = new Hono<Entorno>()

/** El único sector con lotes y trazabilidad. */
const CHIPERIA = 'chiperia'
const MAX_CANTIDAD = 1_000_000

/** Solo Chipería y el administrador; los otros sectores reciben 403. */
const soloChiperia: MiddlewareHandler<Entorno> = async (c, next) => {
  const rol = c.get('usuario').rol
  if (rol !== 'admin' && rol !== CHIPERIA) throw prohibido('Los lotes y la trazabilidad son solo de Chipería.')
  await next()
}

const vacio = (v: unknown) => v === undefined || v === null || v === ''

/** `?disponibles=1` (o `true`). */
const siFiltro = (v: string | undefined) => v === '1' || v === 'true'

function rango(q: Record<string, string>): { desde: string | null; hasta: string | null } {
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  return { desde, hasta }
}

async function unLoteMP(db: BaseD1, id: string): Promise<LoteMP> {
  const [l] = await leerLotesMP(db, { ids: [id] })
  if (!l) throw noEncontrado('No se encontró ese lote de materia prima.')
  return l
}

const deChipa = (m: Movimiento) => m.sector === CHIPERIA

// ---------- Lotes de materia prima (E01, E07) ----------

rutasLotes.get('/lotes-mp', soloChiperia, async (c) => {
  return c.json<LoteMP[]>(await leerLotesMP(c.env.DB, { disponibles: siFiltro(c.req.query('disponibles')) }))
})

rutasLotes.post('/lotes-mp', soloChiperia, async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const hoy = diaPY()

  const insumo = texto(b.insumo, 'el insumo', { max: 60 })
  const proveedor = texto(b.proveedor, 'el proveedor', { max: 100 })
  const numeroLote = textoOpcional(b.numeroLote, 'El número de lote', 60) ?? ''
  if (vacio(b.fechaIngreso)) throw invalido('Falta la fecha de ingreso.')
  const fechaIngreso = dia(b.fechaIngreso, 'La fecha de ingreso')
  if (fechaIngreso > hoy) throw invalido('La fecha de ingreso no puede ser posterior a hoy.')
  if (vacio(b.cantidad)) throw invalido('Cargá la cantidad que ingresó.')
  if (typeof b.cantidad === 'number' && b.cantidad <= 0) throw invalido('La cantidad tiene que ser mayor que cero.')
  const cantidad = numero(b.cantidad, 'La cantidad', { min: 0, max: MAX_CANTIDAD })
  const unidad = textoOpcional(b.unidad, 'La unidad', 20) ?? 'kg'
  if (vacio(b.vencimiento)) throw invalido('Falta la fecha de vencimiento.')
  const vencimiento = dia(b.vencimiento, 'El vencimiento')
  if (vencimiento < fechaIngreso) throw invalido('El vencimiento no puede ser anterior a la fecha de ingreso.')
  if (vencimiento < hoy) throw invalido('Ese lote ya está vencido: revisá la fecha de vencimiento.')

  const id = nuevoId()
  await sentencia(
    db,
    `INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id, insumo, proveedor, numeroLote, fechaIngreso, cantidad, unidad, vencimiento, u.id, ahora().fecha,
  ).run()
  return c.json<LoteMP>(await unLoteMP(db, id))
})

// E07: el administrador bloquea o desbloquea un lote; queda en la auditoría.
rutasLotes.patch('/lotes-mp/:id', soloChiperia, soloAdmin, async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const antes = await unLoteMP(db, c.req.param('id'))
  if (b.bloqueado === undefined) throw invalido('No hay nada para cambiar.')
  const bloqueado = booleano(b.bloqueado, 'El bloqueo')
  if (bloqueado === antes.bloqueado) return c.json<LoteMP>(antes)
  await db.batch([
    sentencia(db, 'UPDATE lotes_mp SET bloqueado = ? WHERE id = ?', bloqueado, antes.id),
    sentenciaAuditoria(db, {
      tabla: 'lotes_mp',
      registroId: antes.id,
      accion: bloqueado ? 'bloquear' : 'desbloquear',
      usuarioId: u.id,
      antes: { lote: antes.descripcion, bloqueado: antes.bloqueado },
      despues: { lote: antes.descripcion, bloqueado },
    }),
  ])
  return c.json<LoteMP>(await unLoteMP(db, antes.id))
})

// E10: lotes vencidos con saldo y lotes por vencer.
rutasLotes.get('/lotes/alertas', soloChiperia, async (c) => c.json<Alerta[]>(await alertasLotes(c.env.DB)))

// ---------- Lotes de chipa (E03–E05) ----------

rutasLotes.get('/lotes-chipa', soloChiperia, async (c) => {
  return c.json<LoteChipa[]>(await leerLotesChipa(c.env.DB, rango(c.req.query())))
})

// ---------- Trazabilidad (E06) ----------

/** Hacia adelante: el lote de materia prima, los lotes de chipa que lo usaron y sus envíos. */
rutasLotes.get('/trazabilidad/mp/:id', soloChiperia, async (c) => {
  const db = c.env.DB
  const loteMP = await unLoteMP(db, c.req.param('id'))
  const lotesChipa = await leerLotesChipa(db, { loteMpId: loteMP.id })
  const movimientos = await leerMovimientos(db, { lotes: lotesChipa.map((l) => l.codigo) })
  return c.json<TrazabilidadMP>({
    loteMP,
    lotesChipa,
    envios: movimientos.filter((m) => deChipa(m) && m.tipo === 'envio'),
  })
})

/** Un lote de chipa: su producción y materia prima (hacia atrás) y adónde fue (hacia adelante). */
rutasLotes.get('/trazabilidad/lote/:codigo', soloChiperia, async (c) => {
  const db = c.env.DB
  const pedido = c.req.param('codigo').trim()
  if (!pedido) throw invalido('Escribí el código del lote.')
  const codigos = [...new Set([pedido, pedido.toUpperCase()])]
  const [encontrado] = await leerLotesChipa(db, { codigos })
  const codigo = encontrado?.codigo ?? pedido
  const movimientos = (await leerMovimientos(db, { lotes: encontrado ? [codigo] : codigos })).filter(deChipa)
  let lote = encontrado
  if (!lote) {
    // Lote que solo existe en el stock (por ejemplo, cargado como stock inicial): sin producción ni materia prima.
    if (!movimientos.length) throw noEncontrado(`No hay ningún lote de chipa con el código ${pedido}.`)
    const primero = movimientos[movimientos.length - 1]
    lote = {
      id: '',
      codigo: primero.lote ?? pedido,
      produccionId: null,
      amasada: 0,
      dia: primero.dia,
      horno: 0,
      congelador: 0,
      stock: movimientos.reduce((s, m) => s + m.cantidad, 0),
      lotesMP: [],
    }
  }
  const [produccion] = lote.produccionId ? await leerProducciones(db, { ids: [lote.produccionId] }) : []
  return c.json<TrazabilidadLote>({
    lote,
    produccion: produccion ?? null,
    envios: movimientos.filter((m) => m.tipo === 'envio'),
    otrosMovimientos: movimientos.filter((m) => m.tipo !== 'envio' && m.tipo !== 'produccion'),
  })
})

/** Hacia atrás: lo que recibió una sucursal de Chipería, de qué lotes de chipa y de qué materia prima. */
rutasLotes.get('/trazabilidad/sucursal/:id', soloChiperia, async (c) => {
  const db = c.env.DB
  const { desde, hasta } = rango(c.req.query())
  const fila = await una<{ id: string; nombre: string; activo: number }>(
    db, 'SELECT id, nombre, activo FROM sucursales WHERE id = ?', c.req.param('id'),
  )
  if (!fila) throw noEncontrado('No se encontró esa sucursal.')
  const sucursal: Sucursal = { id: fila.id, nombre: fila.nombre, activo: !!fila.activo }
  const envios = await leerMovimientos(db, { sector: CHIPERIA, sucursal: sucursal.id, tipos: ['envio'], desde, hasta })
  const codigos = [...new Set(envios.map((m) => m.lote).filter((l): l is string => !!l))]
  const lotesChipa = await leerLotesChipa(db, { codigos })
  const idsMP = [...new Set(lotesChipa.flatMap((l) => l.lotesMP.map((mp) => mp.id)))]
  const lotesMP = await leerLotesMP(db, { ids: idsMP })
  return c.json<TrazabilidadSucursal>({ sucursal, envios, lotesChipa, lotesMP })
})
