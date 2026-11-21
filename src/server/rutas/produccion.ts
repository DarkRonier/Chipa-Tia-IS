// C01–C04, E02–E04: registros de producción. Un registro junta todos los productos de una carga;
// lo cocinado entra en un depósito de venta (Venta frente si no se elige), lo guardado en el almacén elegido (si no, Frío) y, en Chipería, cada registro es una amasada con su lote CH-AAMMDD-N.
import { Hono } from 'hono'
import { DEPOSITO, type Produccion, type ProduccionItem, type SectorId, type Turno } from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { leerLotesMP, leerProducciones } from '../consultas'
import { ahora, nuevoId, sentencia, todasPorTrozos } from '../db'
import type { BaseD1, Entorno, SentenciaD1 } from '../entorno'
import { conflicto, esSaldoLoteInsuficiente, esStockInsuficiente, invalido, noEncontrado } from '../errores'
import { requiere, sectorPara } from '../sesion'
import { cuerpo, diaOpcional, entero, numero, opcion, texto } from '../validar'
import { almacenPorDefecto, leerDeposito } from './stock'

export const rutasProduccion = new Hono<Entorno>()

const SECTOR_CON_LOTES: SectorId = 'chiperia'
const TURNOS: readonly Turno[] = ['dia', 'noche']
const MAX_ITEMS = 300
const MAX_CANTIDAD_MP = 1_000_000
const MOTIVO_CORRECCION = 'Corrección de producción'

interface ItemPedido {
  productoId: string
  cocinado: number
  guardado: number
  /** Depósito al que va lo guardado. null = no lo indicaron (al registrar, Frío). */
  depositoId: string | null
}

/** Valida la lista de productos con sus cantidades (enteros ≥ 0, cada producto una sola vez). */
function leerItems(v: unknown): ItemPedido[] {
  if (!Array.isArray(v) || v.length === 0) throw invalido('Cargá al menos una cantidad.')
  if (v.length > MAX_ITEMS) throw invalido('Son demasiados productos en un solo registro.')
  const vistos = new Set<string>()
  return v.map((x) => {
    const it = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const productoId = texto(it.productoId, 'el producto', { max: 100 })
    if (vistos.has(productoId)) throw invalido('Cada producto va una sola vez en el registro.')
    vistos.add(productoId)
    return {
      productoId,
      cocinado: entero(it.cocinado ?? 0, 'La cantidad cocinada'),
      guardado: entero(it.guardado ?? 0, 'La cantidad guardada'),
      depositoId: it.depositoId === undefined || it.depositoId === null || it.depositoId === '' ? null : texto(it.depositoId, 'el depósito', { max: 100 }),
    }
  })
}

interface FilaProducto {
  id: string
  sector: SectorId
  nombre: string
  activo: number
  tipo: string
  sin_stock: number
}

/** Cada depósito elegido para lo guardado tiene que existir, no estar borrado y ser un almacén. */
async function controlarDepositos(db: BaseD1, ids: string[]) {
  const unicos = [...new Set(ids)]
  if (!unicos.length) return
  const filas = await todasPorTrozos<{ id: string; nombre: string; activo: number; tipo: string }>(
    db, unicos, (m) => `SELECT id, nombre, activo, tipo FROM depositos WHERE id IN (${m})`,
  )
  for (const id of unicos) {
    const d = filas.find((f) => f.id === id)
    if (!d) throw invalido('Ese depósito no existe. Recargá la página y probá de nuevo.')
    if (!d.activo) throw invalido(`El depósito ${d.nombre} ya no existe. Elegí otro.`)
    if (d.tipo !== 'almacen') throw invalido(`Lo guardado va a un almacén, no a «${d.nombre}».`)
  }
}

async function leerProductos(db: BaseD1, ids: string[]): Promise<Map<string, FilaProducto>> {
  const filas = await todasPorTrozos<FilaProducto>(db, ids, (m) => `SELECT id, sector, nombre, activo, tipo, sin_stock FROM productos WHERE id IN (${m})`)
  return new Map(filas.map((f) => [f.id, f]))
}

/** Exige que cada producto exista, sea del sector y esté activo (salvo los que ya estaban en el registro). */
function controlarProductos(items: ItemPedido[], productos: Map<string, FilaProducto>, sector: SectorId, yaEstaban = new Set<string>()) {
  for (const i of items) {
    const p = productos.get(i.productoId)
    if (!p) throw invalido('Uno de los productos no existe. Recargá la página y probá de nuevo.')
    if (p.sector !== sector) throw invalido(`${p.nombre} no es un producto de este sector.`)
    if (!p.activo && !yaEstaban.has(p.id)) throw invalido(`${p.nombre} está desactivado y no se puede cargar.`)
    if (p.tipo !== 'elaborado' && !yaEstaban.has(p.id)) throw invalido(`${p.nombre} no se produce: es de compra.`)
  }
}

interface UsoPedido {
  id: string
  cantidad: number
  /** Si el lote entró con una compra: su producto, para descontarlo del depósito Materia prima. */
  productoId: string | null
  numeroLote: string
  unidad: string
}

const formatoCantidad = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 })
const conUnidad = (n: number, unidad: string) => `${formatoCantidad.format(n)} ${unidad}`

/**
 * Valida los lotes de materia prima del pedido, cada uno con su cantidad (> 0, en la unidad del lote): que existan,
 * estén disponibles y alcance el saldo. Cada lote va una sola vez.
 */
async function leerUsos(db: BaseD1, v: unknown): Promise<UsoPedido[]> {
  if (v !== undefined && v !== null && !Array.isArray(v)) throw invalido('Los lotes de materia prima no son válidos.')
  const lista = (v ?? []) as unknown[]
  if (!lista.length) throw invalido('Elegí los lotes de materia prima usados.')
  if (lista.length > 50) throw invalido('Son demasiados lotes de materia prima.')
  const vistos = new Set<string>()
  const usos = lista.map((x) => {
    const it = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const id = texto(it.id, 'el lote de materia prima', { max: 100 })
    if (vistos.has(id)) throw invalido('Cada lote de materia prima va una sola vez en el registro.')
    vistos.add(id)
    if (it.cantidad === undefined || it.cantidad === null || it.cantidad === '') throw invalido('Cargá cuánto usaste de cada lote de materia prima.')
    if (typeof it.cantidad === 'number' && it.cantidad <= 0) throw invalido('La cantidad usada de cada lote tiene que ser mayor que cero.')
    return { id, cantidad: numero(it.cantidad, 'La cantidad usada de un lote de materia prima', { min: 0, max: MAX_CANTIDAD_MP }) }
  })
  const encontrados = new Map((await leerLotesMP(db, { ids: usos.map((u) => u.id) })).map((l) => [l.id, l]))
  if (encontrados.size !== usos.length) {
    throw conflicto('lote_mp_no_disponible', 'Uno de los lotes de materia prima ya no existe. Recargá la página y elegí de nuevo.')
  }
  return usos.map((u) => {
    const lote = encontrados.get(u.id)!
    if (!lote.disponible) {
      const porque = lote.bloqueado ? 'está bloqueado' : lote.agotado ? 'ya no tiene saldo' : 'está vencido'
      throw conflicto('lote_mp_no_disponible', `El lote ${lote.descripcion} ${porque}. Elegí otro.`)
    }
    if (u.cantidad > lote.saldo + 0.0005) {
      throw invalido(`Del lote ${lote.descripcion} solo quedan ${conUnidad(lote.saldo, lote.unidad)} y cargaste ${conUnidad(u.cantidad, lote.unidad)}.`)
    }
    return { id: lote.id, cantidad: u.cantidad, productoId: lote.productoId, numeroLote: lote.numeroLote, unidad: lote.unidad }
  })
}

const sentenciaMovimiento = (db: BaseD1, m: {
  sector: SectorId
  productoId: string
  lote: string | null
  tipo: 'produccion' | 'ajuste'
  cantidad: number
  depositoId: string
  motivo: string | null
  produccionId: string
  usuarioId: string
  fecha: string
  dia: string
}) =>
  sentencia(
    db,
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, deposito_id, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    nuevoId(), m.sector, m.productoId, m.lote, m.tipo, m.cantidad, m.depositoId, m.motivo, m.produccionId, m.usuarioId, m.fecha, m.dia,
  )

async function unaProduccion(db: BaseD1, id: string): Promise<Produccion> {
  const [p] = await leerProducciones(db, { ids: [id] })
  if (!p) throw noEncontrado('No se encontró ese registro de producción.')
  return p
}

// ---------- Listado ----------

rutasProduccion.get('/producciones', requiere('produccion.ver'), async (c) => {
  const u = c.get('usuario')
  const q = c.req.query()
  const sector = sectorPara(u, q.sector)
  const desde = diaOpcional(q.desde, 'La fecha desde')
  const hasta = diaOpcional(q.hasta, 'La fecha hasta')
  if (desde && hasta && desde > hasta) throw invalido('La fecha desde no puede ser posterior a la fecha hasta.')
  return c.json<Produccion[]>(await leerProducciones(c.env.DB, { sector, desde, hasta }))
})

// ---------- Registrar (C01–C03, E02–E04) ----------

rutasProduccion.post('/producciones', requiere('produccion.cargar'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const b = await cuerpo(c)
  const sector = sectorPara(u, b.sector, true)
  if (b.turno === undefined || b.turno === null || b.turno === '') throw invalido('Elegí el turno.')
  const turno = opcion(b.turno, TURNOS, 'El turno')
  // Lo que viene vacío (0 y 0) no se registra.
  const almacen = await almacenPorDefecto(db)
  const items = leerItems(b.items)
    .filter((i) => i.cocinado + i.guardado > 0)
    .map((i) => ({ ...i, depositoId: i.depositoId ?? almacen }))
  if (!items.length) throw invalido('Cargá al menos una cantidad.')
  const venta = await leerDeposito(db, b.depositoVentaId, DEPOSITO.venta, 'a qué venta va lo del horno', 'venta')
  await controlarDepositos(db, items.filter((i) => i.guardado > 0).map((i) => i.depositoId))

  const productos = await leerProductos(db, items.map((i) => i.productoId))
  controlarProductos(items, productos, sector)

  // E02/E03: Chipería elige los lotes de materia prima usados y cuánto de cada uno; tienen que estar disponibles (E07)
  // y la cantidad no puede pasar del saldo que le queda al lote.
  const conLotes = sector === SECTOR_CON_LOTES
  let usos: UsoPedido[] = []
  if (conLotes) {
    usos = await leerUsos(db, b.lotesMP)
  }

  const id = nuevoId()
  const { fecha, dia } = ahora()
  const sentencias: SentenciaD1[] = [
    sentencia(db, 'INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno, deposito_venta_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, sector, u.id, fecha, dia, turno, venta.id),
    ...items.map((i) =>
      sentencia(db, 'INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado, deposito_id) VALUES (?, ?, ?, ?, ?)',
        id, i.productoId, i.cocinado, i.guardado, i.depositoId)),
  ]

  // E03: el lote CH-AAMMDD-N se numera dentro de la misma transacción (N = amasada del día),
  // así dos cargas simultáneas no pueden tomar el mismo número.
  const loteId = conLotes ? nuevoId() : null
  if (loteId) {
    const prefijo = `CH-${dia.slice(2).replaceAll('-', '')}-`
    sentencias.push(
      sentencia(db,
        `INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia)
         SELECT ?, ? || n, ?, n, ? FROM (SELECT COALESCE(MAX(amasada), 0) + 1 AS n FROM lotes_chipa WHERE dia = ?)`,
        loteId, prefijo, id, dia, dia),
      ...usos.map((u) => sentencia(db, 'INSERT INTO lote_chipa_mp (lote_chipa_id, lote_mp_id, cantidad) VALUES (?, ?, ?)', loteId, u.id, u.cantidad)),
      // La materia prima que entró con una compra sale del depósito Materia prima (con su número de lote, como entró).
      // No se frena si el depósito no alcanza (ver la migración 0016): el saldo del lote ya se controló.
      ...usos.filter((x) => x.productoId).map((x) => sentencia(db,
        `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, deposito_id, motivo, produccion_id, usuario_id, fecha, dia)
         SELECT ?, p.sector, p.id, ?, 'produccion', ?, '${DEPOSITO.materiaPrima}',
                'Usado en la amasada ' || (SELECT codigo FROM lotes_chipa WHERE id = ?), ?, ?, ?, ?
           FROM productos p WHERE p.id = ?`,
        nuevoId(), x.numeroLote || null, -x.cantidad, loteId, id, u.id, fecha, dia, x.productoId)),
    )
  }

  // D01/E05: lo cocinado (en Chipería, lo que va al horno) va directo a la venta: entra en el depósito de venta elegido
  // (Venta frente si no se elige; la cocina puede mandarlo a Venta comedor), de donde lo descuenta la caja. Lo guardado
  // entra en el almacén elegido (por defecto, Frío). En Chipería, los dos con el código de su lote. Los productos «sin
  // stock» (el buffet por kilo) no tienen movimientos.
  const entrada = (productoId: string, cantidad: number, depositoId: string) =>
    sentencia(db,
      `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, deposito_id, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
       VALUES (?, ?, ?, ${loteId ? '(SELECT codigo FROM lotes_chipa WHERE id = ?)' : '?'}, 'produccion', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
      nuevoId(), sector, productoId, loteId, cantidad, depositoId, id, u.id, fecha, dia)
  for (const i of items) {
    if (productos.get(i.productoId)!.sin_stock) continue
    if (i.cocinado > 0) sentencias.push(entrada(i.productoId, i.cocinado, venta.id))
    if (i.guardado > 0) sentencias.push(entrada(i.productoId, i.guardado, i.depositoId))
  }

  try {
    await db.batch(sentencias)
  } catch (e) {
    // Otra carga se llevó el saldo entre el control y el guardado: el trigger de la base lo frena.
    if (esSaldoLoteInsuficiente(e)) {
      throw conflicto('lote_mp_sin_saldo', 'Otra carga acaba de usar parte de ese lote y ya no alcanza. Recargá la página y revisá las cantidades.')
    }
    throw e
  }
  return c.json<Produccion>(await unaProduccion(db, id))
})

// ---------- Corregir (C04) · solo admin ----------

rutasProduccion.patch('/producciones/:id', requiere('produccion.corregir', 'Solo el administrador puede hacer esto.'), async (c) => {
  const db = c.env.DB
  const u = c.get('usuario')
  const id = c.req.param('id')
  const b = await cuerpo(c)
  const original = await unaProduccion(db, id)
  const pedidos = leerItems(b.items)

  const antes = new Map(original.items.map((i) => [i.productoId, i]))
  const productos = await leerProductos(db, pedidos.map((i) => i.productoId))
  controlarProductos(pedidos, productos, original.sector, new Set(antes.keys()))

  // El depósito de lo que ya estaba guardado no se cambia desde acá (para eso está «Transferir» en Stock).
  // Solo cuenta el del pedido cuando no había nada guardado todavía.
  const depositoFinal = (i: ItemPedido): string => {
    const a = antes.get(i.productoId)
    return a && a.guardado > 0 ? a.depositoId : (i.depositoId ?? a?.depositoId ?? almacen)
  }
  const almacen = await almacenPorDefecto(db)
  await controlarDepositos(db, pedidos.filter((i) => !(antes.get(i.productoId)?.guardado)).filter((i) => i.guardado > 0).map(depositoFinal))

  // Los productos que no vienen en el pedido quedan como estaban.
  const despues = new Map<string, ProduccionItem>(antes)
  for (const i of pedidos) {
    despues.set(i.productoId, {
      productoId: i.productoId,
      productoNombre: productos.get(i.productoId)!.nombre,
      cocinado: i.cocinado,
      guardado: i.guardado,
      depositoId: depositoFinal(i),
    })
  }
  const cambios = pedidos.filter((i) => {
    const a = antes.get(i.productoId)
    return a ? a.cocinado !== i.cocinado || a.guardado !== i.guardado : i.cocinado + i.guardado > 0
  })
  if (!cambios.length) throw invalido('No hay cambios para guardar.')
  if (![...despues.values()].some((i) => i.cocinado + i.guardado > 0)) {
    throw invalido('El registro tiene que quedar con al menos una cantidad.')
  }

  const { fecha, dia } = ahora()
  const lote = original.lote?.codigo ?? null
  const sentencias: SentenciaD1[] = []
  for (const i of cambios) {
    const a = antes.get(i.productoId)
    sentencias.push(a
      ? sentencia(db, 'UPDATE produccion_items SET cocinado = ?, guardado = ?, deposito_id = ? WHERE produccion_id = ? AND producto_id = ?',
        i.cocinado, i.guardado, depositoFinal(i), id, i.productoId)
      : sentencia(db, 'INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado, deposito_id) VALUES (?, ?, ?, ?, ?)',
        id, i.productoId, i.cocinado, i.guardado, depositoFinal(i)))
    // La diferencia corrige el stock con un movimiento compensatorio: la de lo cocinado en su depósito de venta y la de lo
    // guardado en su depósito.
    const diferencias: [number, string][] = [
      [i.cocinado - (a?.cocinado ?? 0), original.depositoVentaId],
      [i.guardado - (a?.guardado ?? 0), depositoFinal(i)],
    ]
    for (const [diferencia, depositoId] of diferencias) {
      if (diferencia === 0 || productos.get(i.productoId)?.sin_stock) continue
      sentencias.push(sentenciaMovimiento(db, {
        sector: original.sector, productoId: i.productoId, lote, tipo: 'ajuste', cantidad: diferencia, depositoId,
        motivo: MOTIVO_CORRECCION, produccionId: id, usuarioId: u.id, fecha, dia,
      }))
    }
  }
  sentencias.push(
    sentencia(db, 'UPDATE producciones SET corregido_por = ?, corregido_en = ? WHERE id = ?', u.id, fecha, id),
    sentenciaAuditoria(db, {
      tabla: 'producciones',
      registroId: id,
      accion: 'corregir',
      usuarioId: u.id,
      antes: { items: original.items },
      despues: { items: [...despues.values()] },
    }),
  )

  try {
    await db.batch(sentencias)
  } catch (e) {
    if (esStockInsuficiente(e)) {
      throw conflicto('stock_insuficiente',
        'No se puede bajar esa cantidad: parte de esa producción ya salió del stock (se vendió, se envió o se pasó a otro depósito). Revisá el stock antes de corregir.')
    }
    throw e
  }
  return c.json<Produccion>(await unaProduccion(db, id))
})
