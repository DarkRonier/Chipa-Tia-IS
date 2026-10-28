// E01, E05–E07: lotes de materia prima, lotes de chipa y trazabilidad (Chipería y el administrador).
// Las producciones, lotes de chipa y envíos se cargan directo en la base: los registra otro módulo.
import { describe, expect, it } from 'vitest'
import { diaLegible, diaPY, sumarDias } from '../src/shared/hora'
import type {
  LoteChipa, LoteMP, TrazabilidadLote, TrazabilidadMP, TrazabilidadSucursal,
} from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const QUESU = 'prod-chiperia-03' // Chipa quesú
const EMPANADA = 'prod-cocina-10'
const hoy = () => diaPY()

/** Lote de materia prima por la API, con valores válidos por defecto. */
async function loteMP(p: Prueba, token: string, o: Record<string, unknown> = {}) {
  return p.pedir<LoteMP>(token, 'POST', '/lotes-mp', {
    insumo: 'Harina',
    proveedor: 'Molinos del Sur',
    fechaIngreso: hoy(),
    cantidad: 25,
    vencimiento: sumarDias(hoy(), 90),
    ...o,
  })
}

/** Lote de materia prima cargado directo (por ejemplo, ya vencido). */
async function loteMPDirecto(p: Prueba, id: string, o: { insumo?: string; vencimiento: string; ingreso?: string }) {
  await p.sql(
    `INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
     VALUES (?, ?, 'Codipsa', '', ?, 10, 'kg', ?, 0, 'usr-chiperia', ?)`,
    id, o.insumo ?? 'Almidón', o.ingreso ?? sumarDias(hoy(), -60), o.vencimiento, new Date().toISOString(),
  )
}

let n = 0
/** Amasada de Chipería como la deja el módulo de producción: producción, ítems, lote, lotes MP y stock guardado. */
async function amasada(p: Prueba, o: {
  codigo: string; dia?: string; amasada?: number; mp: string[]
  items?: { producto: string; cocinado: number; guardado: number }[]
}) {
  const dia = o.dia ?? hoy()
  const prod = `prod-${o.codigo}`
  const items = o.items ?? [{ producto: CHIPA, cocinado: 200, guardado: 300 }]
  await p.sql(`INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, 'chiperia', 'usr-chiperia', ?, ?, 'dia')`,
    prod, `${dia}T12:00:00.000Z`, dia)
  for (const i of items) {
    await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, ?)', prod, i.producto, i.cocinado, i.guardado)
  }
  await p.sql('INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia) VALUES (?, ?, ?, ?, ?)',
    `lc-${o.codigo}`, o.codigo, prod, o.amasada ?? 1, dia)
  for (const mp of o.mp) await p.sql('INSERT INTO lote_chipa_mp (lote_chipa_id, lote_mp_id) VALUES (?, ?)', `lc-${o.codigo}`, mp)
  for (const i of items.filter((x) => x.guardado > 0)) {
    await mov(p, { producto: i.producto, lote: o.codigo, tipo: 'produccion', cantidad: i.guardado, dia, produccion: prod })
  }
  return prod
}

async function mov(p: Prueba, o: {
  sector?: string; producto?: string; lote?: string | null; tipo: string; cantidad: number
  dia?: string; sucursal?: string | null; produccion?: string | null; usuario?: string; motivo?: string | null
}) {
  const id = `mov-${++n}`
  const dia = o.dia ?? hoy()
  await p.sql(
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.sector ?? 'chiperia', o.producto ?? CHIPA, o.lote ?? null, o.tipo, o.cantidad, o.motivo ?? null, o.sucursal ?? null,
    o.tipo === 'envio' ? `env-${id}` : null, o.produccion ?? null, o.usuario ?? 'usr-chiperia', `${dia}T${String(10 + (n % 10)).padStart(2, '0')}:00:00.000Z`, dia,
  )
  return id
}

const envio = (p: Prueba, lote: string, cantidad: number, sucursal = 'suc-centro', dia?: string, producto = CHIPA) =>
  mov(p, { lote, tipo: 'envio', cantidad: -cantidad, sucursal, dia, producto })

describe('planilla de comprobación E01, E05–E07', () => {
  it('E01–E07: lote de harina disponible → amasada → envío de 100 → trazabilidad ida y vuelta → bloqueo', async () => {
    const p = await nuevaPrueba()
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')

    // E01: ingresar un lote de harina con cantidad y vencimiento → queda disponible para elegir.
    const r = await loteMP(p, chiperia, { numeroLote: 'H-0210', cantidad: 50, unidad: 'kg' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      insumo: 'Harina', proveedor: 'Molinos del Sur', numeroLote: 'H-0210', cantidad: 50, unidad: 'kg',
      fechaIngreso: hoy(), vencimiento: sumarDias(hoy(), 90), bloqueado: false, disponible: true,
      descripcion: 'Harina · Molinos del Sur · lote H-0210',
    })
    const harina = r.body.id
    const disponibles = await p.pedir<LoteMP[]>(chiperia, 'GET', '/lotes-mp?disponibles=1')
    expect(disponibles.body.map((l) => l.id)).toContain(harina)

    // E02–E04 (otro módulo): la amasada usa ese lote; 200 al horno y 300 al congelador.
    await amasada(p, { codigo: 'CH-261010-1', mp: [harina] })

    // E05: enviar 100 chipas de ese lote → el envío indica el lote y el stock del lote baja a 200.
    let lotes = await p.pedir<LoteChipa[]>(chiperia, 'GET', '/lotes-chipa')
    expect(lotes.body).toHaveLength(1)
    expect(lotes.body[0]).toMatchObject({ codigo: 'CH-261010-1', amasada: 1, horno: 200, congelador: 300, stock: 300 })
    await envio(p, 'CH-261010-1', 100)
    lotes = await p.pedir<LoteChipa[]>(chiperia, 'GET', '/lotes-chipa')
    expect(lotes.body[0].stock).toBe(200)
    expect(lotes.body[0].lotesMP).toEqual([{ id: harina, descripcion: 'Harina · Molinos del Sur · lote H-0210' }])

    // E06: desde el lote de harina se llega al lote de chipa y a la sucursal…
    const ida = await p.pedir<TrazabilidadMP>(chiperia, 'GET', `/trazabilidad/mp/${harina}`)
    expect(ida.status).toBe(200)
    expect(ida.body.loteMP.id).toBe(harina)
    expect(ida.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-261010-1'])
    expect(ida.body.envios).toHaveLength(1)
    expect(ida.body.envios[0]).toMatchObject({
      tipo: 'envio', lote: 'CH-261010-1', cantidad: -100, sucursalId: 'suc-centro', sucursalNombre: 'Sucursal Centro',
    })
    // …y desde la sucursal se vuelve al lote de harina.
    const vuelta = await p.pedir<TrazabilidadSucursal>(chiperia, 'GET', '/trazabilidad/sucursal/suc-centro')
    expect(vuelta.status).toBe(200)
    expect(vuelta.body.sucursal).toEqual({ id: 'suc-centro', nombre: 'Sucursal Centro', activo: true })
    expect(vuelta.body.envios.map((m) => m.lote)).toEqual(['CH-261010-1'])
    expect(vuelta.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-261010-1'])
    expect(vuelta.body.lotesMP.map((l) => l.id)).toEqual([harina])

    // E07: el administrador bloquea el lote → deja de aparecer para elegir (pero sigue en la lista y en la trazabilidad).
    const b = await p.pedir<LoteMP>(admin, 'PATCH', `/lotes-mp/${harina}`, { bloqueado: true })
    expect(b.status).toBe(200)
    expect(b.body).toMatchObject({ bloqueado: true, disponible: false })
    expect((await p.pedir<LoteMP[]>(chiperia, 'GET', '/lotes-mp?disponibles=1')).body.map((l) => l.id)).not.toContain(harina)
    const todos = await p.pedir<LoteMP[]>(chiperia, 'GET', '/lotes-mp')
    expect(todos.body.find((l) => l.id === harina)).toMatchObject({ bloqueado: true, disponible: false })
    expect((await p.pedir<TrazabilidadMP>(chiperia, 'GET', `/trazabilidad/mp/${harina}`)).body.lotesChipa).toHaveLength(1)
  })
})

describe('lotes de materia prima (E01)', () => {
  it('sin número de lote se identifica por proveedor y fecha de ingreso, como en la planilla', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const ingreso = sumarDias(hoy(), -8)
    const r = await loteMP(p, t, { insumo: '  Queso ', proveedor: 'Lácteos Tatiana', fechaIngreso: ingreso, cantidad: 12.5, numeroLote: '' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      insumo: 'Queso', numeroLote: '', unidad: 'kg', cantidad: 12.5, fechaIngreso: ingreso,
      descripcion: `Queso · Lácteos Tatiana · ingreso ${diaLegible(ingreso)}`,
    })
    expect(r.body.creadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const [fila] = await p.sql('SELECT usuario_id FROM lotes_mp WHERE id = ?', r.body.id)
    expect(fila.usuario_id).toBe('usr-chiperia')
  })

  it('el administrador también registra lotes, con la unidad que elija', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('admin')
    const r = await loteMP(p, t, { insumo: 'Almidón', proveedor: 'Codipsa', cantidad: 40, unidad: 'bolsas' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ unidad: 'bolsas', disponible: true })
  })

  it('valida los datos con mensajes claros', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ insumo: '' }, /Falta el insumo/],
      [{ proveedor: '   ' }, /Falta el proveedor/],
      [{ proveedor: undefined }, /Falta el proveedor/],
      [{ cantidad: 0 }, /mayor que cero/],
      [{ cantidad: -3 }, /mayor que cero/],
      [{ cantidad: '5' }, /número/],
      [{ cantidad: undefined }, /Cargá la cantidad/],
      [{ vencimiento: undefined }, /Falta la fecha de vencimiento/],
      [{ vencimiento: '31/12/2026' }, /AAAA-MM-DD/],
      [{ fechaIngreso: undefined }, /Falta la fecha de ingreso/],
      [{ fechaIngreso: sumarDias(hoy(), 1), vencimiento: sumarDias(hoy(), 30) }, /posterior a hoy/],
      [{ fechaIngreso: sumarDias(hoy(), -10), vencimiento: sumarDias(hoy(), -11) }, /anterior a la fecha de ingreso/],
      [{ fechaIngreso: sumarDias(hoy(), -10), vencimiento: sumarDias(hoy(), -1) }, /ya está vencido/],
      [{ numeroLote: 'x'.repeat(61) }, /demasiado largo/],
    ]
    for (const [cambio, mensaje] of casos) {
      const r = await loteMP(p, t, cambio)
      expect(r.status, JSON.stringify(cambio)).toBe(400)
      const error = (r.body as unknown as { error: { codigo: string; mensaje: string } }).error
      expect(error.codigo).toBe('datos_invalidos')
      expect(error.mensaje).toMatch(mensaje)
    }
    expect((await p.pedir(t, 'POST', '/lotes-mp', 'no es json')).status).toBe(400)
    expect(await p.sql('SELECT id FROM lotes_mp')).toHaveLength(0)
    // Vence hoy: todavía se puede usar.
    const hoyMismo = await loteMP(p, t, { vencimiento: hoy() })
    expect(hoyMismo.status).toBe(200)
    expect(hoyMismo.body.disponible).toBe(true)
  })

  it('un lote vencido no se ofrece para elegir pero sigue en la lista (E07)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await loteMPDirecto(p, 'mp-vencido', { vencimiento: sumarDias(hoy(), -1) })
    const nuevo = (await loteMP(p, t)).body
    const todos = await p.pedir<LoteMP[]>(t, 'GET', '/lotes-mp')
    expect(todos.body.map((l) => l.id)).toEqual([nuevo.id, 'mp-vencido']) // el ingreso más nuevo primero
    expect(todos.body[1]).toMatchObject({ bloqueado: false, disponible: false })
    const disp = await p.pedir<LoteMP[]>(t, 'GET', '/lotes-mp?disponibles=true')
    expect(disp.body.map((l) => l.id)).toEqual([nuevo.id])
  })
})

describe('bloqueo de lotes (E07) · solo admin', () => {
  it('bloquea y desbloquea dejando auditoría; sin cambios no audita', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const lote = (await loteMP(p, await p.entrar('chiperia'), { insumo: 'Queso', proveedor: 'Tatiana' })).body

    expect((await p.pedir<LoteMP>(admin, 'PATCH', `/lotes-mp/${lote.id}`, { bloqueado: true })).body.disponible).toBe(false)
    // Repetir el mismo estado no genera otra fila de auditoría.
    expect((await p.pedir(admin, 'PATCH', `/lotes-mp/${lote.id}`, { bloqueado: true })).status).toBe(200)
    const des = await p.pedir<LoteMP>(admin, 'PATCH', `/lotes-mp/${lote.id}`, { bloqueado: false })
    expect(des.body).toMatchObject({ bloqueado: false, disponible: true })

    const aud = await p.sql('SELECT * FROM auditoria WHERE tabla = ? AND registro_id = ? ORDER BY fecha, accion', 'lotes_mp', lote.id)
    expect(aud.map((a) => a.accion).sort()).toEqual(['bloquear', 'desbloquear'])
    const bloqueo = aud.find((a) => a.accion === 'bloquear')
    expect(bloqueo.usuario_id).toBe('usr-admin')
    expect(JSON.parse(bloqueo.antes)).toMatchObject({ bloqueado: false })
    expect(JSON.parse(bloqueo.despues)).toMatchObject({ bloqueado: true, lote: lote.descripcion })
  })

  it('el operador de Chipería no puede bloquear; datos inválidos y lote inexistente', async () => {
    const p = await nuevaPrueba()
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')
    const lote = (await loteMP(p, chiperia)).body
    const r = await p.pedir(chiperia, 'PATCH', `/lotes-mp/${lote.id}`, { bloqueado: true })
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('prohibido')
    expect((await p.sql('SELECT bloqueado FROM lotes_mp'))[0].bloqueado).toBe(0)

    expect((await p.pedir(admin, 'PATCH', `/lotes-mp/${lote.id}`, { bloqueado: 'si' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', `/lotes-mp/${lote.id}`, {})).body.error.mensaje).toBe('No hay nada para cambiar.')
    const no = await p.pedir(admin, 'PATCH', '/lotes-mp/no-existe', { bloqueado: true })
    expect(no.status).toBe(404)
    expect(no.body.error.mensaje).toMatch(/lote de materia prima/)
  })
})

describe('lotes de chipa (E03–E05)', () => {
  it('lista los lotes con horno, congelador, lo que queda y la materia prima; filtra por fecha', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const queso = (await loteMP(p, t, { insumo: 'Queso', proveedor: 'Tatiana', numeroLote: '0210' })).body
    const almidon = (await loteMP(p, t, { insumo: 'Almidón', proveedor: 'Codipsa', numeroLote: '77' })).body
    const ayer = sumarDias(hoy(), -1)
    await amasada(p, { codigo: 'CH-A-1', dia: ayer, amasada: 1, mp: [queso.id, almidon.id] })
    await amasada(p, {
      codigo: 'CH-H-1', amasada: 1, mp: [queso.id],
      items: [{ producto: CHIPA, cocinado: 50, guardado: 120 }, { producto: QUESU, cocinado: 10, guardado: 40 }],
    })
    await amasada(p, { codigo: 'CH-H-2', amasada: 2, mp: [almidon.id] })
    await mov(p, { lote: 'CH-H-1', producto: QUESU, tipo: 'salida_venta', cantidad: -15 })
    await mov(p, { lote: 'CH-H-1', tipo: 'merma', cantidad: -5, motivo: 'Se quemaron' })

    const r = await p.pedir<LoteChipa[]>(t, 'GET', '/lotes-chipa')
    expect(r.status).toBe(200)
    expect(r.body.map((l) => l.codigo)).toEqual(['CH-H-2', 'CH-H-1', 'CH-A-1']) // el más nuevo primero
    expect(r.body[1]).toMatchObject({ dia: hoy(), horno: 60, congelador: 160, stock: 140 })
    expect(r.body[2].lotesMP.map((m) => m.descripcion)).toEqual(['Almidón · Codipsa · lote 77', 'Queso · Tatiana · lote 0210'])

    const soloAyer = await p.pedir<LoteChipa[]>(t, 'GET', `/lotes-chipa?desde=${ayer}&hasta=${ayer}`)
    expect(soloAyer.body.map((l) => l.codigo)).toEqual(['CH-A-1'])
    const desdeHoy = await p.pedir<LoteChipa[]>(t, 'GET', `/lotes-chipa?desde=${hoy()}`)
    expect(desdeHoy.body.map((l) => l.codigo)).toEqual(['CH-H-2', 'CH-H-1'])

    expect((await p.pedir(t, 'GET', `/lotes-chipa?desde=${hoy()}&hasta=${ayer}`)).status).toBe(400)
    expect((await p.pedir(t, 'GET', '/lotes-chipa?desde=ayer')).status).toBe(400)
  })
})

describe('trazabilidad (E06)', () => {
  /** Dos lotes de queso, tres amasadas y envíos a dos sucursales en días distintos. */
  async function escenario() {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const q1 = (await loteMP(p, t, { insumo: 'Queso', proveedor: 'Tatiana', numeroLote: 'Q1' })).body
    const q2 = (await loteMP(p, t, { insumo: 'Queso', proveedor: 'Tatiana', numeroLote: 'Q2' })).body
    const alm = (await loteMP(p, t, { insumo: 'Almidón', proveedor: 'Codipsa', numeroLote: 'A1' })).body
    const ayer = sumarDias(hoy(), -1)
    await amasada(p, { codigo: 'CH-1', dia: ayer, amasada: 1, mp: [q1.id, alm.id] })
    await amasada(p, { codigo: 'CH-2', dia: ayer, amasada: 2, mp: [q1.id] })
    await amasada(p, { codigo: 'CH-3', amasada: 1, mp: [q2.id, alm.id] })
    await envio(p, 'CH-1', 100, 'suc-centro', ayer)
    await envio(p, 'CH-1', 50, 'suc-ruta1', hoy())
    await envio(p, 'CH-2', 30, 'suc-centro', hoy())
    await envio(p, 'CH-3', 20, 'suc-ruta1', hoy())
    // Envíos de Cocina a la misma sucursal: no son parte de la trazabilidad de chipas.
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'produccion', cantidad: 10, usuario: 'usr-cocina' })
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -2, sucursal: 'suc-centro', usuario: 'usr-cocina' })
    return { p, t, q1, q2, alm, ayer }
  }

  it('desde un lote de materia prima llega a sus lotes de chipa y a las sucursales', async () => {
    const { p, t, q1, q2 } = await escenario()
    const r = await p.pedir<TrazabilidadMP>(t, 'GET', `/trazabilidad/mp/${q1.id}`)
    expect(r.body.loteMP.descripcion).toBe('Queso · Tatiana · lote Q1')
    expect(r.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-2', 'CH-1'])
    expect(r.body.envios.map((m) => [m.lote, m.sucursalId, m.cantidad]).sort()).toEqual([
      ['CH-1', 'suc-centro', -100], ['CH-1', 'suc-ruta1', -50], ['CH-2', 'suc-centro', -30],
    ])
    // Solo envíos: la producción que entró al stock no figura.
    expect(r.body.envios.every((m) => m.tipo === 'envio')).toBe(true)

    const otro = await p.pedir<TrazabilidadMP>(t, 'GET', `/trazabilidad/mp/${q2.id}`)
    expect(otro.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-3'])
    expect(otro.body.envios.map((m) => m.sucursalId)).toEqual(['suc-ruta1'])

    const sinUso = (await loteMP(p, t, { insumo: 'Harina' })).body
    const vacio = await p.pedir<TrazabilidadMP>(t, 'GET', `/trazabilidad/mp/${sinUso.id}`)
    expect(vacio.body).toMatchObject({ lotesChipa: [], envios: [] })
    expect((await p.pedir(t, 'GET', '/trazabilidad/mp/no-existe')).status).toBe(404)
  })

  it('un lote de chipa muestra su producción, materia prima, envíos y otros movimientos', async () => {
    const { p, t, q1, alm } = await escenario()
    await mov(p, { lote: 'CH-1', tipo: 'salida_venta', cantidad: -10 })
    await mov(p, { lote: 'CH-1', tipo: 'merma', cantidad: -2, motivo: 'Rotas' })

    const r = await p.pedir<TrazabilidadLote>(t, 'GET', '/trazabilidad/lote/CH-1')
    expect(r.status).toBe(200)
    expect(r.body.lote).toMatchObject({ codigo: 'CH-1', horno: 200, congelador: 300, stock: 300 - 150 - 12 })
    expect(r.body.lote.lotesMP.map((m) => m.id).sort()).toEqual([q1.id, alm.id].sort())
    expect(r.body.produccion).toMatchObject({
      id: 'prod-CH-1', sector: 'chiperia', usuarioNombre: 'Encargado Chipería', turno: 'dia',
      items: [{ productoId: CHIPA, productoNombre: 'Chipa tradicional', cocinado: 200, guardado: 300 }],
    })
    expect(r.body.produccion?.lote?.codigo).toBe('CH-1')
    expect(r.body.envios.map((m) => [m.sucursalId, m.cantidad]).sort()).toEqual([['suc-centro', -100], ['suc-ruta1', -50]])
    expect(r.body.otrosMovimientos.map((m) => m.tipo).sort()).toEqual(['merma', 'salida_venta'])

    // El código se puede escribir en minúsculas y con espacios.
    expect((await p.pedir<TrazabilidadLote>(t, 'GET', '/trazabilidad/lote/%20ch-1%20')).body.lote.codigo).toBe('CH-1')
    const no = await p.pedir(t, 'GET', '/trazabilidad/lote/CH-99')
    expect(no.status).toBe(404)
    expect(no.body.error.mensaje).toMatch(/CH-99/)
  })

  it('un lote que solo está en el stock (stock inicial) se muestra sin producción ni materia prima', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('admin')
    await mov(p, { lote: 'INICIAL-1', tipo: 'stock_inicial', cantidad: 40, usuario: 'usr-admin', dia: sumarDias(hoy(), -3) })
    await envio(p, 'INICIAL-1', 15, 'suc-encarnacion')
    const r = await p.pedir<TrazabilidadLote>(t, 'GET', '/trazabilidad/lote/INICIAL-1')
    expect(r.status).toBe(200)
    expect(r.body.lote).toMatchObject({ codigo: 'INICIAL-1', produccionId: null, stock: 25, lotesMP: [], dia: sumarDias(hoy(), -3) })
    expect(r.body.produccion).toBeNull()
    expect(r.body.envios.map((m) => m.sucursalId)).toEqual(['suc-encarnacion'])
    expect(r.body.otrosMovimientos.map((m) => m.tipo)).toEqual(['stock_inicial'])
    // Desde la sucursal se ve el envío aunque el lote no tenga materia prima registrada.
    const s = await p.pedir<TrazabilidadSucursal>(t, 'GET', '/trazabilidad/sucursal/suc-encarnacion')
    expect(s.body).toMatchObject({ lotesChipa: [], lotesMP: [] })
    expect(s.body.envios.map((m) => m.lote)).toEqual(['INICIAL-1'])
  })

  it('desde una sucursal vuelve a los lotes de chipa y de materia prima, con filtro de fechas', async () => {
    const { p, t, q1, q2, alm, ayer } = await escenario()
    const r = await p.pedir<TrazabilidadSucursal>(t, 'GET', '/trazabilidad/sucursal/suc-centro')
    expect(r.status).toBe(200)
    expect(r.body.envios.map((m) => [m.lote, m.cantidad]).sort()).toEqual([['CH-1', -100], ['CH-2', -30]])
    expect(r.body.envios.every((m) => m.sector === 'chiperia')).toBe(true) // sin las empanadas de Cocina
    expect(r.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-2', 'CH-1'])
    expect(r.body.lotesMP.map((l) => l.id).sort()).toEqual([q1.id, alm.id].sort())

    const deAyer = await p.pedir<TrazabilidadSucursal>(t, 'GET', `/trazabilidad/sucursal/suc-centro?desde=${ayer}&hasta=${ayer}`)
    expect(deAyer.body.envios.map((m) => m.lote)).toEqual(['CH-1'])
    expect(deAyer.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-1'])

    const ruta = await p.pedir<TrazabilidadSucursal>(t, 'GET', `/trazabilidad/sucursal/suc-ruta1?desde=${hoy()}`)
    expect(ruta.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-3', 'CH-1'])
    expect(ruta.body.lotesMP.map((l) => l.id).sort()).toEqual([q1.id, q2.id, alm.id].sort())

    const nada = await p.pedir<TrazabilidadSucursal>(t, 'GET', '/trazabilidad/sucursal/suc-encarnacion')
    expect(nada.body).toMatchObject({ envios: [], lotesChipa: [], lotesMP: [] })
    expect((await p.pedir(t, 'GET', '/trazabilidad/sucursal/no-existe')).status).toBe(404)
    expect((await p.pedir(t, 'GET', `/trazabilidad/sucursal/suc-centro?desde=${hoy()}&hasta=${ayer}`)).status).toBe(400)
  })

  it('una sucursal desactivada sigue apareciendo en la trazabilidad', async () => {
    const { p, t } = await escenario()
    await p.sql("UPDATE sucursales SET activo = 0 WHERE id = 'suc-centro'")
    const r = await p.pedir<TrazabilidadSucursal>(t, 'GET', '/trazabilidad/sucursal/suc-centro')
    expect(r.body.sucursal.activo).toBe(false)
    expect(r.body.envios).toHaveLength(2)
  })
})

describe('acceso (A03): solo Chipería y el administrador', () => {
  it('los otros sectores reciben 403 en todas las rutas y sin sesión 401', async () => {
    const p = await nuevaPrueba()
    const lote = (await loteMP(p, await p.entrar('chiperia'))).body
    await amasada(p, { codigo: 'CH-X-1', mp: [lote.id] })
    const rutas: [string, string, unknown?][] = [
      ['GET', '/lotes-mp'],
      ['GET', '/lotes-mp?disponibles=1'],
      ['POST', '/lotes-mp', { insumo: 'Queso', proveedor: 'X', fechaIngreso: hoy(), cantidad: 1, vencimiento: hoy() }],
      ['PATCH', `/lotes-mp/${lote.id}`, { bloqueado: true }],
      ['GET', '/lotes-chipa'],
      ['GET', `/trazabilidad/mp/${lote.id}`],
      ['GET', '/trazabilidad/lote/CH-X-1'],
      ['GET', '/trazabilidad/sucursal/suc-centro'],
    ]
    for (const usuario of ['chipitas', 'panaderia', 'cocina']) {
      const t = await p.entrar(usuario)
      for (const [metodo, ruta, cuerpo] of rutas) {
        const r = await p.pedir(t, metodo, ruta, cuerpo)
        expect(r.status, `${usuario} ${metodo} ${ruta}`).toBe(403)
        expect(r.body.error.mensaje).toMatch(/Chipería/)
      }
    }
    for (const [metodo, ruta, cuerpo] of rutas) expect((await p.pedir(null, metodo, ruta, cuerpo)).status).toBe(401)
    // Nada cambió.
    expect(await p.sql('SELECT id, bloqueado FROM lotes_mp')).toEqual([{ id: lote.id, bloqueado: 0 }])
  })

  it('Chipería y el administrador ven lo mismo', async () => {
    const p = await nuevaPrueba()
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')
    const lote = (await loteMP(p, chiperia)).body
    await amasada(p, { codigo: 'CH-Y-1', mp: [lote.id] })
    for (const ruta of ['/lotes-mp', '/lotes-chipa', `/trazabilidad/mp/${lote.id}`, '/trazabilidad/lote/CH-Y-1', '/trazabilidad/sucursal/suc-centro']) {
      const a = await p.pedir(chiperia, 'GET', ruta)
      const b = await p.pedir(admin, 'GET', ruta)
      expect(a.status, ruta).toBe(200)
      expect(b.body).toEqual(a.body)
    }
  })
})

describe('integración con producción y envíos (E02, E05, E07)', () => {
  it('la amasada con el lote ligado y el envío desde ese lote se ven en la trazabilidad; un lote bloqueado se rechaza', async () => {
    const p = await nuevaPrueba()
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')
    const harina = (await loteMP(p, chiperia)).body
    const prod = await p.pedir(chiperia, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: CHIPA, cocinado: 200, guardado: 300 }], lotesMP: [harina.id],
    })
    expect(prod.status).toBe(200)
    const codigo: string = prod.body.lote.codigo
    expect(codigo).toMatch(/^CH-\d{6}-1$/)
    const env = await p.pedir(chiperia, 'POST', '/envios', { sucursalId: 'suc-ruta1', items: [{ productoId: CHIPA, lote: codigo, cantidad: 100 }] })
    expect(env.status).toBe(200)
    expect((await p.pedir<LoteChipa[]>(chiperia, 'GET', '/lotes-chipa')).body[0]).toMatchObject({ codigo, stock: 200 })
    const s = await p.pedir<TrazabilidadSucursal>(chiperia, 'GET', '/trazabilidad/sucursal/suc-ruta1')
    expect(s.body.lotesMP.map((l) => l.id)).toEqual([harina.id])

    await p.pedir(admin, 'PATCH', `/lotes-mp/${harina.id}`, { bloqueado: true })
    const otra = await p.pedir(chiperia, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: CHIPA, cocinado: 10, guardado: 0 }], lotesMP: [harina.id],
    })
    expect(otra.status).toBe(409)
    expect(otra.body.error.codigo).toBe('lote_mp_no_disponible')
  })
})
