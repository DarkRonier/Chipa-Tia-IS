// D01–D07 y E05: stock en frío, salidas a venta, envíos a sucursales, mermas, ajustes e historial.
import { describe, expect, it } from 'vitest'
import { diaPY } from '../src/shared/hora'
import type { Movimiento, StockFila } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10' // Empanada frita (carne)
const MARINERA = 'prod-cocina-14' // Marinera de carne
const MBEJU = 'prod-cocina-16'
const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const QUESU = 'prod-chiperia-03'

let n = 0
/** Movimiento cargado directo en la base (lo guardado en producción lo registra otro módulo). */
async function mov(p: Prueba, o: {
  sector?: string; producto?: string; lote?: string | null; tipo?: string; cantidad: number
  dia?: string; fecha?: string; sucursal?: string | null; motivo?: string | null; usuario?: string
}) {
  const id = `mov-${++n}`
  const dia = o.dia ?? diaPY()
  await p.sql(
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    id, o.sector ?? 'cocina', o.producto ?? EMPANADA, o.lote ?? null, o.tipo ?? 'produccion', o.cantidad, o.motivo ?? null,
    o.sucursal ?? null, o.usuario ?? 'usr-cocina', o.fecha ?? `${dia}T15:00:00.000Z`, dia,
  )
  return id
}

async function stockDe(p: Prueba, token: string, producto: string, sector?: string): Promise<StockFila | undefined> {
  const r = await p.pedir<StockFila[]>(token, 'GET', `/stock${sector ? `?sector=${sector}` : ''}`)
  expect(r.status).toBe(200)
  return r.body.find((f) => f.productoId === producto)
}

/** Lote de chipa con su producción, como lo deja el módulo de producción. */
async function loteChipa(p: Prueba, codigo: string, dia: string, amasada: number, guardado: number, producto = CHIPA) {
  const prod = `prod-${codigo}`
  await p.sql(`INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, 'chiperia', 'usr-chiperia', ?, ?, 'dia')`,
    prod, `${dia}T12:00:00.000Z`, dia)
  await p.sql('INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia) VALUES (?, ?, ?, ?, ?)', `lc-${codigo}`, codigo, prod, amasada, dia)
  await mov(p, { sector: 'chiperia', producto, lote: codigo, cantidad: guardado, dia, usuario: 'usr-chiperia' })
}

describe('planilla de comprobación D01–D07', () => {
  it('stock 8 → salida 3 → 5 → envío 2 → 3 → envío 10 rechazado → merma 1 → 2; stock inicial de otro producto', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')

    // D01: lo guardado (8 de 38 empanadas) suma al stock en frío del sector.
    await mov(p, { cantidad: 8 })
    expect((await stockDe(p, cocina, EMPANADA))?.total).toBe(8)

    // D02: sacar 3 para reponer la venta.
    const salida = await p.pedir<Movimiento>(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 3 })
    expect(salida.status).toBe(200)
    expect(salida.body).toMatchObject({
      tipo: 'salida_venta', cantidad: -3, sector: 'cocina', productoId: EMPANADA, productoNombre: 'Empanada frita (carne)',
      usuarioId: 'usr-cocina', usuarioNombre: 'Encargado Cocina', dia: diaPY(), sucursalId: null, lote: null,
    })
    expect(Date.parse(salida.body.fecha)).toBeGreaterThan(Date.now() - 60_000)
    expect((await stockDe(p, cocina, EMPANADA))?.total).toBe(5)

    // D03: envío de 2 a una sucursal, con sucursal, fecha, producto y cantidad.
    const envio = await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 2 }] })
    expect(envio.status).toBe(200)
    expect(envio.body.envioId).toBeTruthy()
    expect(envio.body.movimientos).toHaveLength(1)
    expect(envio.body.movimientos[0]).toMatchObject({
      tipo: 'envio', cantidad: -2, sucursalId: 'suc-centro', sucursalNombre: 'Sucursal Centro (ejemplo)',
      envioId: envio.body.envioId, productoNombre: 'Empanada frita (carne)', usuarioNombre: 'Encargado Cocina', dia: diaPY(),
    })
    expect((await stockDe(p, cocina, EMPANADA))?.total).toBe(3)

    // D04: no deja enviar 10.
    const diez = await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 10 }] })
    expect(diez.status).toBe(409)
    expect(diez.body.error.codigo).toBe('stock_insuficiente')
    expect(diez.body.error.mensaje).toContain('hay 3')
    expect((await stockDe(p, cocina, EMPANADA))?.total).toBe(3)

    // D06: merma de 1 con motivo; figura en el historial.
    const merma = await p.pedir<Movimiento>(admin, 'POST', '/ajustes', {
      sector: 'cocina', productoId: EMPANADA, tipo: 'merma', cantidad: 1, motivo: 'Se cayó al piso',
    })
    expect(merma.status).toBe(200)
    expect(merma.body).toMatchObject({ tipo: 'merma', cantidad: -1, motivo: 'Se cayó al piso', usuarioId: 'usr-admin' })
    expect((await stockDe(p, cocina, EMPANADA))?.total).toBe(2)
    const historial = await p.pedir<Movimiento[]>(cocina, 'GET', '/movimientos?tipo=salida_venta,envio,merma,vencimiento,ajuste')
    expect(historial.status).toBe(200)
    expect(historial.body.map((m) => [m.tipo, m.cantidad])).toEqual([['merma', -1], ['envio', -2], ['salida_venta', -3]])
    expect(historial.body[0].motivo).toBe('Se cayó al piso')

    // D07: stock inicial de otro producto.
    const inicial = await p.pedir<Movimiento>(admin, 'POST', '/ajustes', {
      sector: 'cocina', productoId: MARINERA, tipo: 'stock_inicial', cantidad: 12, motivo: 'Stock al empezar a usar el sistema',
    })
    expect(inicial.status).toBe(200)
    expect(inicial.body).toMatchObject({ tipo: 'stock_inicial', cantidad: 12 })
    expect((await stockDe(p, cocina, MARINERA))?.total).toBe(12)
  })
})

describe('GET /stock', () => {
  it('lista los productos activos del sector y los desactivados que todavía tienen stock', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { producto: MBEJU, cantidad: 4 })
    await p.sql("UPDATE productos SET activo = 0 WHERE id IN (?, ?)", MBEJU, MARINERA)
    const r = await p.pedir<StockFila[]>(t, 'GET', '/stock')
    expect(r.status).toBe(200)
    expect(r.body.every((f) => f.productoId.startsWith('prod-cocina-'))).toBe(true)
    expect(r.body.find((f) => f.productoId === MBEJU)).toMatchObject({ activo: false, total: 4, lotes: [] })
    expect(r.body.find((f) => f.productoId === MARINERA)).toBeUndefined()
    expect(r.body.find((f) => f.productoId === EMPANADA)).toMatchObject({ activo: true, total: 0 })
    // Orden de la planilla.
    expect(r.body[0].productoNombre).toBe('Asadito (brochet de pollo)')
  })

  it('en Chipería muestra el stock por lote, el más viejo primero y sin lotes vacíos (E05)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await loteChipa(p, 'CH-261009-2', '2026-10-09', 2, 50)
    await loteChipa(p, 'CH-261010-1', '2026-10-10', 1, 70)
    await loteChipa(p, 'CH-261009-10', '2026-10-09', 10, 30)
    await loteChipa(p, 'CH-261008-1', '2026-10-08', 1, 20)
    await mov(p, { sector: 'chiperia', producto: CHIPA, lote: 'CH-261008-1', tipo: 'envio', cantidad: -20, sucursal: 'suc-centro', usuario: 'usr-chiperia' })
    // Stock inicial con un código anterior al sistema (no está en lotes_chipa): se ordena por su código.
    await mov(p, { sector: 'chiperia', producto: CHIPA, lote: 'CH-261001-3', tipo: 'stock_inicial', cantidad: 5, usuario: 'usr-admin' })
    await loteChipa(p, 'CH-261009-1', '2026-10-09', 1, 8, QUESU)
    const fila = await stockDe(p, t, CHIPA)
    expect(fila?.total).toBe(155)
    expect(fila?.lotes).toEqual([
      { lote: 'CH-261001-3', cantidad: 5 },
      { lote: 'CH-261009-2', cantidad: 50 },
      { lote: 'CH-261009-10', cantidad: 30 },
      { lote: 'CH-261010-1', cantidad: 70 },
    ])
    expect((await stockDe(p, t, QUESU))?.lotes).toEqual([{ lote: 'CH-261009-1', cantidad: 8 }])
  })

  it('el administrador tiene que indicar el sector; un operador no puede ver otro (A03)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    expect((await p.pedir(admin, 'GET', '/stock')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', '/stock?sector=nada')).status).toBe(400)
    const r = await p.pedir<StockFila[]>(admin, 'GET', '/stock?sector=panaderia')
    expect(r.status).toBe(200)
    expect(r.body.map((f) => f.productoId)).toEqual(['prod-panaderia-01', 'prod-panaderia-02', 'prod-panaderia-03'])
    const otro = await p.pedir(cocina, 'GET', '/stock?sector=chiperia')
    expect(otro.status).toBe(403)
    expect(otro.body.error.codigo).toBe('prohibido')
    expect((await p.pedir(cocina, 'GET', '/stock?sector=cocina')).status).toBe(200)
    expect((await p.pedir(null, 'GET', '/stock')).status).toBe(401)
  })
})

describe('POST /salidas (D02, D04)', () => {
  it('valida producto y cantidad con mensajes claros', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 5 })
    const casos: [unknown, string][] = [
      [{ cantidad: 1 }, 'Elegí el producto.'],
      [{ productoId: EMPANADA }, 'Cargá una cantidad mayor que cero.'],
      [{ productoId: EMPANADA, cantidad: 0 }, 'Cargá una cantidad mayor que cero.'],
      [{ productoId: EMPANADA, cantidad: -2 }, 'Cargá una cantidad mayor que cero.'],
      [{ productoId: EMPANADA, cantidad: 1.5 }, 'La cantidad tiene que ser un número entero.'],
      [{ productoId: EMPANADA, cantidad: '2' }, 'La cantidad tiene que ser un número entero.'],
      [{ productoId: 'no-existe', cantidad: 1 }, 'Ese producto no existe. Recargá la página y probá de nuevo.'],
      [{ productoId: CHIPA, cantidad: 1 }, 'Chipa tradicional no es un producto de este sector.'],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await p.pedir(t, 'POST', '/salidas', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error).toEqual({ codigo: 'datos_invalidos', mensaje })
    }
    expect((await p.sql('SELECT COUNT(*) AS n FROM movimientos'))[0].n).toBe(1)
  })

  it('no deja sacar más de lo que hay y lo explica', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const sinNada = await p.pedir(t, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1 })
    expect(sinNada.status).toBe(409)
    expect(sinNada.body.error).toEqual({ codigo: 'stock_insuficiente', mensaje: 'No hay stock de Empanada frita (carne).' })
    await mov(p, { cantidad: 4 })
    const r = await p.pedir(t, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 5 })
    expect(r.status).toBe(409)
    expect(r.body.error.mensaje).toBe('No hay stock suficiente: de Empanada frita (carne) hay 4 y querés sacar 5.')
    expect((await p.pedir(t, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 4 })).status).toBe(200)
    expect((await stockDe(p, t, EMPANADA))?.total).toBe(0)
  })

  it('un operador solo saca de su sector; el administrador indica el sector (A03)', async () => {
    const p = await nuevaPrueba()
    await mov(p, { sector: 'chiperia', producto: CHIPA, lote: 'CH-261009-1', cantidad: 10, usuario: 'usr-chiperia' })
    await mov(p, { cantidad: 10 })
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    const r = await p.pedir(cocina, 'POST', '/salidas', { sector: 'chiperia', productoId: CHIPA, lote: 'CH-261009-1', cantidad: 1 })
    expect(r.status).toBe(403)
    expect((await p.pedir(admin, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1 })).body.error.mensaje).toBe('Indicá el sector.')
    const a = await p.pedir<Movimiento>(admin, 'POST', '/salidas', { sector: 'cocina', productoId: EMPANADA, cantidad: 1 })
    expect(a.status).toBe(200)
    expect(a.body).toMatchObject({ sector: 'cocina', usuarioId: 'usr-admin', cantidad: -1 })
  })

  it('en Chipería exige el lote y controla el stock del lote', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await loteChipa(p, 'CH-261008-1', '2026-10-08', 1, 10)
    await loteChipa(p, 'CH-261009-1', '2026-10-09', 1, 300)
    const sinLote = await p.pedir(t, 'POST', '/salidas', { productoId: CHIPA, cantidad: 5 })
    expect(sinLote.status).toBe(400)
    expect(sinLote.body.error.mensaje).toBe('Elegí de qué lote sale.')
    // Hay 310 en total, pero el lote viejo solo tiene 10.
    const r = await p.pedir(t, 'POST', '/salidas', { productoId: CHIPA, lote: 'CH-261008-1', cantidad: 11 })
    expect(r.status).toBe(409)
    expect(r.body.error.mensaje).toBe('No hay stock suficiente: de Chipa tradicional del lote CH-261008-1 hay 10 y querés sacar 11.')
    const ok = await p.pedir<Movimiento>(t, 'POST', '/salidas', { productoId: CHIPA, lote: 'CH-261008-1', cantidad: 10 })
    expect(ok.status).toBe(200)
    expect(ok.body.lote).toBe('CH-261008-1')
    expect((await stockDe(p, t, CHIPA))?.lotes).toEqual([{ lote: 'CH-261009-1', cantidad: 300 }])
  })

  it('normaliza el lote en salidas y envíos: espacios y minúsculas no cambian el stock del lote (E05)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await loteChipa(p, 'CH-261009-1', '2026-10-09', 1, 10)
    const salida = await p.pedir<Movimiento>(t, 'POST', '/salidas', { productoId: CHIPA, lote: 'ch-261009-1 ', cantidad: 3 })
    expect(salida.status).toBe(200)
    expect(salida.body).toMatchObject({ lote: 'CH-261009-1', cantidad: -3 })
    const envio = await p.pedir(t, 'POST', '/envios', {
      sucursalId: 'suc-centro', items: [{ productoId: CHIPA, lote: ' ch-261009-1', cantidad: 4 }],
    })
    expect(envio.status).toBe(200)
    expect(envio.body.movimientos[0]).toMatchObject({ lote: 'CH-261009-1', cantidad: -4 })
    expect((await stockDe(p, t, CHIPA))?.lotes).toEqual([{ lote: 'CH-261009-1', cantidad: 3 }])
  })

  it('en un sector sin lotes ignora el lote', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 5 })
    const r = await p.pedir<Movimiento>(t, 'POST', '/salidas', { productoId: EMPANADA, lote: 'X-1', cantidad: 2 })
    expect(r.status).toBe(200)
    expect(r.body.lote).toBeNull()
  })
})

describe('POST /envios (D03, D04, E05)', () => {
  it('registra varias líneas con el mismo envío y sucursal', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 10 })
    await mov(p, { producto: MARINERA, cantidad: 6 })
    const r = await p.pedir(t, 'POST', '/envios', {
      sucursalId: 'suc-ruta1',
      items: [{ productoId: MARINERA, cantidad: 6 }, { productoId: EMPANADA, cantidad: 4 }],
    })
    expect(r.status).toBe(200)
    const movs = r.body.movimientos as Movimiento[]
    expect(movs.map((m) => [m.productoId, m.cantidad])).toEqual([[MARINERA, -6], [EMPANADA, -4]])
    expect(new Set(movs.map((m) => m.envioId))).toEqual(new Set([r.body.envioId]))
    expect(movs.every((m) => m.sucursalId === 'suc-ruta1' && m.tipo === 'envio' && m.fecha === movs[0].fecha)).toBe(true)
    expect((await stockDe(p, t, MARINERA))?.total).toBe(0)
    expect((await stockDe(p, t, EMPANADA))?.total).toBe(6)
  })

  it('si una línea no alcanza no registra ninguna (todo o nada)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 10 })
    await mov(p, { producto: MARINERA, cantidad: 2 })
    const r = await p.pedir(t, 'POST', '/envios', {
      sucursalId: 'suc-centro',
      items: [{ productoId: EMPANADA, cantidad: 5 }, { productoId: MARINERA, cantidad: 3 }],
    })
    expect(r.status).toBe(409)
    expect(r.body.error).toEqual({
      codigo: 'stock_insuficiente', mensaje: 'No hay stock suficiente: de Marinera de carne hay 2 y querés sacar 3.',
    })
    expect((await p.sql("SELECT COUNT(*) AS n FROM movimientos WHERE tipo = 'envio'"))[0].n).toBe(0)
    expect((await stockDe(p, t, EMPANADA))?.total).toBe(10)
  })

  it('valida sucursal, líneas y cantidades', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 10 })
    await p.sql("UPDATE sucursales SET activo = 0 WHERE id = 'suc-encarnacion'")
    const linea = [{ productoId: EMPANADA, cantidad: 1 }]
    const casos: [unknown, string][] = [
      [{ items: linea }, 'Elegí la sucursal.'],
      [{ sucursalId: 'suc-nada', items: linea }, 'Esa sucursal no existe. Recargá la página y probá de nuevo.'],
      [{ sucursalId: 'suc-encarnacion', items: linea }, 'La sucursal Sucursal Encarnación (ejemplo) está desactivada. Elegí otra.'],
      [{ sucursalId: 'suc-centro' }, 'Cargá al menos un producto para enviar.'],
      [{ sucursalId: 'suc-centro', items: [] }, 'Cargá al menos un producto para enviar.'],
      [{ sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 0 }] }, 'Cargá una cantidad mayor que cero.'],
      [{ sucursalId: 'suc-centro', items: [{ cantidad: 1 }] }, 'Elegí el producto.'],
      [{ sucursalId: 'suc-centro', items: [{ productoId: CHIPA, cantidad: 1 }] }, 'Chipa tradicional no es un producto de este sector.'],
      [
        { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 1 }, { productoId: EMPANADA, cantidad: 2 }] },
        'Empanada frita (carne) está repetido en el envío: juntá las cantidades en una sola línea.',
      ],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await p.pedir(t, 'POST', '/envios', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error).toEqual({ codigo: 'datos_invalidos', mensaje })
    }
    expect((await p.pedir(t, 'POST', '/envios', { sector: 'chipitas', sucursalId: 'suc-centro', items: linea })).status).toBe(403)
  })

  it('en Chipería cada línea indica su lote; 100 de un lote de 300 lo dejan en 200 (E05)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await loteChipa(p, 'CH-261009-1', '2026-10-09', 1, 300)
    await loteChipa(p, 'CH-261009-2', '2026-10-09', 2, 40)
    const sinLote = await p.pedir(t, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: CHIPA, cantidad: 100 }] })
    expect(sinLote.body.error.mensaje).toBe('Elegí el lote de Chipa tradicional.')
    const r = await p.pedir(t, 'POST', '/envios', {
      sucursalId: 'suc-centro',
      items: [{ productoId: CHIPA, lote: 'CH-261009-1', cantidad: 100 }, { productoId: CHIPA, lote: 'CH-261009-2', cantidad: 40 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.movimientos.map((m: Movimiento) => m.lote)).toEqual(['CH-261009-1', 'CH-261009-2'])
    expect((await stockDe(p, t, CHIPA))?.lotes).toEqual([{ lote: 'CH-261009-1', cantidad: 200 }])
    const otra = await p.pedir(t, 'POST', '/envios', {
      sucursalId: 'suc-ruta1', items: [{ productoId: CHIPA, lote: 'CH-261009-2', cantidad: 1 }],
    })
    expect(otra.status).toBe(409)
    expect(otra.body.error.mensaje).toBe('No hay stock de Chipa tradicional del lote CH-261009-2.')
    const historial = await p.pedir<Movimiento[]>(t, 'GET', '/movimientos?lote=CH-261009-1&tipo=envio')
    expect(historial.body.map((m) => [m.sucursalNombre, m.cantidad])).toEqual([['Sucursal Centro (ejemplo)', -100]])
  })
})

describe('POST /ajustes (D06, D07) · solo admin', () => {
  it('solo el administrador puede registrar ajustes', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await mov(p, { cantidad: 5 })
    const r = await p.pedir(t, 'POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, tipo: 'merma', cantidad: 1, motivo: 'x' })
    expect(r.status).toBe(403)
    expect((await stockDe(p, t, EMPANADA))?.total).toBe(5)
  })

  it('merma y vencimiento restan, stock inicial suma, el ajuste usa el sentido; queda en auditoría', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await mov(p, { cantidad: 10 })
    const ajustar = (cuerpo: object) => p.pedir<Movimiento>(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, ...cuerpo })
    expect((await ajustar({ tipo: 'vencimiento', cantidad: 2, motivo: 'Venció el 08/10' })).body.cantidad).toBe(-2)
    expect((await ajustar({ tipo: 'ajuste', sentido: 1, cantidad: 3, motivo: 'Conteo físico' })).body.cantidad).toBe(3)
    expect((await ajustar({ tipo: 'ajuste', sentido: -1, cantidad: 4, motivo: 'Conteo físico' })).body.cantidad).toBe(-4)
    expect((await ajustar({ tipo: 'stock_inicial', cantidad: 1, motivo: 'Inicio' })).body.cantidad).toBe(1)
    expect((await stockDe(p, admin, EMPANADA, 'cocina'))?.total).toBe(8)

    const aud = await p.sql("SELECT * FROM auditoria WHERE tabla = 'movimientos' ORDER BY fecha")
    expect(aud).toHaveLength(4)
    expect(aud.every((a) => a.usuario_id === 'usr-admin' && a.accion === 'ajustar')).toBe(true)
    const ultimo = aud.find((a) => JSON.parse(a.despues).tipo === 'vencimiento')
    expect(JSON.parse(ultimo.antes)).toMatchObject({ productoId: EMPANADA, stock: 10 })
    expect(JSON.parse(ultimo.despues)).toMatchObject({ stock: 8, cantidad: -2, motivo: 'Venció el 08/10' })
    const movs = await p.sql("SELECT id FROM movimientos WHERE tipo <> 'produccion'")
    expect(new Set(aud.map((a) => a.registro_id))).toEqual(new Set(movs.map((m) => m.id)))
  })

  it('valida tipo, sentido, motivo y no deja el stock negativo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await mov(p, { cantidad: 2 })
    const base = { sector: 'cocina', productoId: EMPANADA, cantidad: 1, motivo: 'Algo' }
    const casos: [unknown, string][] = [
      [{ ...base, sector: undefined, tipo: 'merma' }, 'Indicá el sector.'],
      [{ ...base, tipo: undefined }, 'Elegí si es merma, vencimiento, ajuste o stock inicial.'],
      [{ ...base, tipo: 'salida_venta' }, 'El tipo de ajuste no es válido.'],
      [{ ...base, tipo: 'ajuste' }, 'Elegí si el ajuste suma o resta.'],
      [{ ...base, tipo: 'ajuste', sentido: 2 }, 'Elegí si el ajuste suma o resta.'],
      [{ ...base, tipo: 'merma', motivo: '' }, 'Escribí el motivo.'],
      [{ ...base, tipo: 'merma', motivo: '   ' }, 'Escribí el motivo.'],
      [{ ...base, tipo: 'stock_inicial', motivo: undefined }, 'Escribí el motivo.'],
      [{ ...base, tipo: 'merma', cantidad: 0 }, 'Cargá una cantidad mayor que cero.'],
      [{ ...base, tipo: 'merma', productoId: MBEJU, sector: 'panaderia' }, 'Mbeju no es un producto de este sector.'],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await p.pedir(admin, 'POST', '/ajustes', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error.mensaje).toBe(mensaje)
    }
    const r = await p.pedir(admin, 'POST', '/ajustes', { ...base, tipo: 'merma', cantidad: 3 })
    expect(r.status).toBe(409)
    expect(r.body.error.mensaje).toBe('No hay stock suficiente: de Empanada frita (carne) hay 2 y querés sacar 3.')
    expect((await p.sql('SELECT COUNT(*) AS n FROM auditoria'))[0].n).toBe(0)
    expect((await stockDe(p, admin, EMPANADA, 'cocina'))?.total).toBe(2)
  })

  it('en Chipería pide el lote; el stock inicial puede traer un lote anterior al sistema', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const base = { sector: 'chiperia', productoId: CHIPA, tipo: 'stock_inicial', cantidad: 50, motivo: 'Stock existente' }
    expect((await p.pedir(admin, 'POST', '/ajustes', base)).body.error.mensaje).toBe('Indicá el lote.')
    const r = await p.pedir<Movimiento>(admin, 'POST', '/ajustes', { ...base, lote: ' ch-261001-1 ' })
    expect(r.status).toBe(200)
    expect(r.body.lote).toBe('CH-261001-1')
    const merma = await p.pedir(admin, 'POST', '/ajustes', { ...base, tipo: 'merma', lote: 'CH-261001-1', cantidad: 5, motivo: 'Rotas' })
    expect(merma.status).toBe(200)
    expect((await stockDe(p, admin, CHIPA, 'chiperia'))?.lotes).toEqual([{ lote: 'CH-261001-1', cantidad: 45 }])
  })
})

describe('GET /movimientos (D05)', () => {
  async function conHistorial() {
    const p = await nuevaPrueba()
    await mov(p, { cantidad: 50, dia: '2026-10-01' })
    await mov(p, { producto: MARINERA, cantidad: 50, dia: '2026-10-01' })
    await mov(p, { tipo: 'envio', cantidad: -5, sucursal: 'suc-centro', dia: '2026-10-02' })
    await mov(p, { tipo: 'envio', cantidad: -6, sucursal: 'suc-ruta1', dia: '2026-10-03' })
    await mov(p, { producto: MARINERA, tipo: 'envio', cantidad: -7, sucursal: 'suc-centro', dia: '2026-10-04' })
    await mov(p, { tipo: 'salida_venta', cantidad: -8, dia: '2026-10-04' })
    await mov(p, { tipo: 'merma', cantidad: -1, motivo: 'Rota', dia: '2026-10-05', usuario: 'usr-admin' })
    await mov(p, { sector: 'chiperia', producto: CHIPA, lote: 'CH-261003-1', cantidad: 9, dia: '2026-10-03', usuario: 'usr-chiperia' })
    await mov(p, { sector: 'chiperia', producto: CHIPA, lote: 'CH-261003-1', tipo: 'envio', cantidad: -9, sucursal: 'suc-centro', dia: '2026-10-03', usuario: 'usr-chiperia' })
    return p
  }

  it('filtra por sucursal y fecha (planilla D05), por producto, tipo y lote; el más nuevo primero', async () => {
    const p = await conHistorial()
    const t = await p.entrar('cocina')
    const pedir = async (q: string) => {
      const r = await p.pedir<Movimiento[]>(t, 'GET', `/movimientos${q}`)
      expect(r.status, q).toBe(200)
      return r.body
    }
    const todos = await pedir('')
    expect(todos).toHaveLength(7)
    expect(todos.every((m) => m.sector === 'cocina')).toBe(true)
    expect(todos.map((m) => m.dia)).toEqual([...todos.map((m) => m.dia)].sort().reverse())

    const centro = await pedir('?sucursal=suc-centro&desde=2026-10-03&hasta=2026-10-04')
    expect(centro.map((m) => [m.productoId, m.cantidad, m.sucursalNombre])).toEqual([[MARINERA, -7, 'Sucursal Centro (ejemplo)']])
    expect((await pedir('?sucursal=suc-centro')).map((m) => m.cantidad)).toEqual([-7, -5])
    expect((await pedir('?producto=prod-cocina-10&tipo=envio')).map((m) => m.cantidad)).toEqual([-6, -5])
    expect((await pedir('?tipo=salida_venta,merma')).map((m) => [m.tipo, m.motivo, m.usuarioNombre])).toEqual([
      ['merma', 'Rota', 'Administración'], ['salida_venta', null, 'Encargado Cocina'],
    ])
    expect(await pedir('?desde=2026-10-06')).toEqual([])
    expect(await pedir('?lote=CH-261003-1')).toEqual([])
  })

  it('un operador no ve otro sector; el administrador ve todos o el que elija (A03)', async () => {
    const p = await conHistorial()
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')
    expect((await p.pedir(chiperia, 'GET', '/movimientos?sector=cocina')).status).toBe(403)
    const propios = await p.pedir<Movimiento[]>(chiperia, 'GET', '/movimientos?sucursal=suc-centro')
    expect(propios.body.map((m) => [m.sector, m.lote])).toEqual([['chiperia', 'CH-261003-1']])
    expect((await p.pedir<Movimiento[]>(chiperia, 'GET', `/movimientos?producto=${EMPANADA}`)).body).toEqual([])
    expect((await p.pedir<Movimiento[]>(admin, 'GET', '/movimientos')).body).toHaveLength(9)
    expect((await p.pedir<Movimiento[]>(admin, 'GET', '/movimientos?sector=chiperia')).body).toHaveLength(2)
  })

  it('rechaza filtros inválidos', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const casos: [string, string][] = [
      ['?tipo=robo', 'El tipo de movimiento no es válido.'],
      ['?tipo=envio,robo', 'El tipo de movimiento no es válido.'],
      ['?desde=10/10/2026', 'La fecha desde debe ser una fecha AAAA-MM-DD.'],
      ['?desde=2026-10-05&hasta=2026-10-01', 'La fecha desde no puede ser posterior a la fecha hasta.'],
    ]
    for (const [q, mensaje] of casos) {
      const r = await p.pedir(t, 'GET', `/movimientos${q}`)
      expect(r.status, q).toBe(400)
      expect(r.body.error.mensaje).toBe(mensaje)
    }
  })
})
