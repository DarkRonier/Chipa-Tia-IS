// C05: finalidad del stock en frío (reponer la venta o sucursales) y C08: aviso de stock mínimo.
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { D1SqlJs } from '../src/demo/d1-sqljs'
import { alertasStock } from '../src/server/rutas/stock'
import type { Alerta } from '../src/shared/alertas'
import { diaPY } from '../src/shared/hora'
import type { Movimiento, Produccion, Reporte, StockFila } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10' // Empanada frita (carne)
const MARINERA = 'prod-cocina-14' // Marinera de carne
const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const MIGRACIONES = import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

async function stockDe(p: Prueba, token: string, producto: string, sector?: string): Promise<StockFila> {
  const r = await p.pedir<StockFila[]>(token, 'GET', `/stock${sector ? `?sector=${sector}` : ''}`)
  expect(r.status).toBe(200)
  return r.body.find((f) => f.productoId === producto)!
}

/** Registra en Cocina lo guardado de cada producto, cada uno con su finalidad (por defecto, reponer la venta). */
async function producir(p: Prueba, token: string, items: { productoId: string; guardado: number; finalidad?: string }[]) {
  const r = await p.pedir<Produccion>(token, 'POST', '/producciones', {
    turno: 'dia', items: items.map((i) => ({ cocinado: 0, ...i })),
  })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body
}

describe('finalidad al guardar la producción (C05)', () => {
  it('cada producto lleva su finalidad; sin indicarla es «reposicion»', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const reg = await producir(p, cocina, [
      { productoId: EMPANADA, guardado: 10, finalidad: 'distribucion' },
      { productoId: MARINERA, guardado: 6 },
    ])
    expect(reg.items.map((i) => [i.productoId, i.guardado, i.finalidad])).toEqual([
      [EMPANADA, 10, 'distribucion'], [MARINERA, 6, 'reposicion'],
    ])
    expect(await p.sql('SELECT producto_id, finalidad FROM movimientos ORDER BY producto_id')).toEqual([
      { producto_id: EMPANADA, finalidad: 'distribucion' }, { producto_id: MARINERA, finalidad: 'reposicion' },
    ])
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 10, reposicion: 0, distribucion: 10 })
    expect(await stockDe(p, cocina, MARINERA)).toMatchObject({ total: 6, reposicion: 6, distribucion: 0 })
  })

  it('rechaza una finalidad que no existe', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const r = await p.pedir(cocina, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 1, finalidad: 'regalo' }] })
    expect(r.status).toBe(400)
    expect(await p.sql('SELECT COUNT(*) AS n FROM producciones')).toEqual([{ n: 0 }])
  })

  it('en Chipería la finalidad va con el lote', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const harina = (await p.pedir<{ id: string }>(t, 'POST', '/lotes-mp', {
      insumo: 'Harina', proveedor: 'Molino', numeroLote: 'H-1', fechaIngreso: diaPY(), cantidad: 50, vencimiento: '2099-01-01',
    })).body
    const r = await p.pedir<Produccion>(t, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [{ id: harina.id, cantidad: 1 }], items: [{ productoId: CHIPA, cocinado: 100, guardado: 80, finalidad: 'distribucion' }],
    })
    expect(r.status).toBe(200)
    const fila = await stockDe(p, t, CHIPA)
    expect(fila).toMatchObject({ total: 80, reposicion: 0, distribucion: 80 })
    expect(fila.lotes).toEqual([{ lote: r.body.lote!.codigo, cantidad: 80, reposicion: 0, distribucion: 80 }])
  })

  it('al corregir la producción el stock se ajusta en la finalidad que ya tenía', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    const reg = await producir(p, cocina, [{ productoId: EMPANADA, guardado: 10, finalidad: 'distribucion' }])
    // Aunque el pedido diga otra finalidad, lo ya guardado no cambia de lugar.
    const r = await p.pedir<Produccion>(admin, 'PATCH', `/producciones/${reg.id}`, {
      items: [{ productoId: EMPANADA, cocinado: 0, guardado: 7, finalidad: 'reposicion' }],
    })
    expect(r.status).toBe(200)
    expect(r.body.items[0]).toMatchObject({ guardado: 7, finalidad: 'distribucion' })
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 7, reposicion: 0, distribucion: 7 })
  })
})

describe('salidas desde la finalidad que corresponde (C05)', () => {
  it('la salida a venta saca de «Reponer venta» y avisa cuánto hay en «Sucursales»', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 5, finalidad: 'distribucion' }, { productoId: MARINERA, guardado: 4 }])

    const r = await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1 })
    expect(r.status).toBe(409)
    expect(r.body.error).toEqual({
      codigo: 'stock_insuficiente',
      mensaje: 'No hay stock de Empanada frita (carne). En «Sucursales» hay 5: cambiales la finalidad en Stock en frío si querés usarlos.',
    })
    const parcial = await p.pedir(cocina, 'POST', '/salidas', { productoId: MARINERA, cantidad: 6 })
    expect(parcial.body.error.mensaje).toBe('No hay stock suficiente: de Marinera de carne hay 4 y querés sacar 6.')
    const ok = await p.pedir<Movimiento>(cocina, 'POST', '/salidas', { productoId: MARINERA, cantidad: 4 })
    expect(ok.status).toBe(200)
    expect(ok.body.finalidad).toBe('reposicion')
  })

  it('el envío saca de «Sucursales» y es todo o nada', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 8, finalidad: 'distribucion' }, { productoId: MARINERA, guardado: 4 }])

    const mal = await p.pedir(cocina, 'POST', '/envios', {
      sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 3 }, { productoId: MARINERA, cantidad: 2 }],
    })
    expect(mal.status).toBe(409)
    expect(mal.body.error.mensaje).toBe('No hay stock de Marinera de carne. En «Reponer venta» hay 4: cambiales la finalidad en Stock en frío si querés usarlos.')
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ reposicion: 0, distribucion: 8 })

    const ok = await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 8 }] })
    expect(ok.status).toBe(200)
    expect(ok.body.movimientos[0]).toMatchObject({ tipo: 'envio', cantidad: -8, finalidad: 'distribucion' })
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 0, distribucion: 0 })
  })

  it('merma, vencimiento y ajuste piden la finalidad (por defecto «reposicion») y controlan esa finalidad', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 5, finalidad: 'distribucion' }])
    const base = { sector: 'cocina', productoId: EMPANADA, cantidad: 2, motivo: 'Se cayó' }

    const sin = await p.pedir(admin, 'POST', '/ajustes', { ...base, tipo: 'merma' })
    expect(sin.status).toBe(409)
    expect(sin.body.error.mensaje).toContain('En «Sucursales» hay 5')
    const ok = await p.pedir<Movimiento>(admin, 'POST', '/ajustes', { ...base, tipo: 'merma', finalidad: 'distribucion' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ tipo: 'merma', cantidad: -2, finalidad: 'distribucion' })
    const inicial = await p.pedir<Movimiento>(admin, 'POST', '/ajustes', { ...base, tipo: 'stock_inicial' })
    expect(inicial.body.finalidad).toBe('reposicion')
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 5, reposicion: 2, distribucion: 3 })

    const rara = await p.pedir(admin, 'POST', '/ajustes', { ...base, tipo: 'merma', finalidad: 'otra' })
    expect(rara.status).toBe(400)
    const aud = await p.sql("SELECT despues FROM auditoria WHERE tabla = 'movimientos' ORDER BY fecha")
    expect(JSON.parse(aud[0].despues)).toMatchObject({ finalidad: 'distribucion', stock: 3 })
  })
})

describe('POST /reasignaciones · cambiar finalidad (C05)', () => {
  it('pasa unidades de una finalidad a la otra con un par de movimientos que no cambia el total', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 10 }])

    const r = await p.pedir<Movimiento[]>(cocina, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 4, desde: 'reposicion' })
    expect(r.status).toBe(200)
    expect(r.body.map((m) => [m.tipo, m.cantidad, m.finalidad])).toEqual([['reasignacion', -4, 'reposicion'], ['reasignacion', 4, 'distribucion']])
    expect(r.body[0].motivo).toBe('Cambio de finalidad: de «Reponer venta» a «Sucursales»')
    expect(r.body[0].usuarioNombre).toBe('Encargado Cocina')
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 10, reposicion: 6, distribucion: 4 })

    // Y de vuelta.
    const vuelta = await p.pedir<Movimiento[]>(cocina, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 1, desde: 'distribucion' })
    expect(vuelta.status).toBe(200)
    expect(await stockDe(p, cocina, EMPANADA)).toMatchObject({ total: 10, reposicion: 7, distribucion: 3 })
  })

  it('no deja pasar más de lo que hay en la finalidad de origen y no registra nada', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 3 }])
    const r = await p.pedir(cocina, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 4, desde: 'reposicion' })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('stock_insuficiente')
    const desdeSucursales = await p.pedir(cocina, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 1, desde: 'distribucion' })
    expect(desdeSucursales.body.error.mensaje).toBe('No hay stock de Empanada frita (carne). En «Reponer venta» hay 3: cambiales la finalidad en Stock en frío si querés usarlos.')
    expect(await p.sql("SELECT COUNT(*) AS n FROM movimientos WHERE tipo = 'reasignacion'")).toEqual([{ n: 0 }])
  })

  it('valida el pedido, respeta el sector y en Chipería pide el lote', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 3 }])
    const casos: [unknown, string][] = [
      [{ cantidad: 1, desde: 'reposicion' }, 'Elegí el producto.'],
      [{ productoId: EMPANADA, desde: 'reposicion' }, 'Cargá una cantidad mayor que cero.'],
      [{ productoId: EMPANADA, cantidad: 1 }, 'Elegí de qué finalidad pasan.'],
      [{ productoId: EMPANADA, cantidad: 1, desde: 'nada' }, 'La finalidad no es válida: elegí «Reponer venta» o «Sucursales».'],
      [{ productoId: CHIPA, cantidad: 1, desde: 'reposicion' }, 'Chipa tradicional no es un producto de este sector.'],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await p.pedir(cocina, 'POST', '/reasignaciones', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error.mensaje).toBe(mensaje)
    }
    expect((await p.pedir(cocina, 'POST', '/reasignaciones', { sector: 'chiperia', productoId: CHIPA, cantidad: 1, desde: 'reposicion' })).status).toBe(403)
    expect((await p.pedir(admin, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 1, desde: 'reposicion' })).body.error.mensaje).toBe('Indicá el sector.')
    expect((await p.pedir(admin, 'POST', '/reasignaciones', { sector: 'cocina', productoId: EMPANADA, cantidad: 1, desde: 'reposicion' })).status).toBe(200)
    expect((await p.pedir(null, 'POST', '/reasignaciones', {})).status).toBe(401)

    const chiperia = await p.entrar('chiperia')
    const sinLote = await p.pedir(chiperia, 'POST', '/reasignaciones', { productoId: CHIPA, cantidad: 1, desde: 'reposicion' })
    expect(sinLote.body.error.mensaje).toBe('Elegí de qué lote.')
  })

  it('en Chipería se reasigna por lote', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    await p.sql(`INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, usuario_id, fecha, dia)
                 VALUES ('m1', 'chiperia', ?, 'CH-261001-1', 'stock_inicial', 50, 'usr-admin', '2026-10-01T12:00:00.000Z', '2026-10-01')`, CHIPA)
    await p.sql(`INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, usuario_id, fecha, dia)
                 VALUES ('m2', 'chiperia', ?, 'CH-261002-1', 'stock_inicial', 20, 'usr-admin', '2026-10-02T12:00:00.000Z', '2026-10-02')`, CHIPA)
    const r = await p.pedir(t, 'POST', '/reasignaciones', { productoId: CHIPA, lote: ' ch-261001-1', cantidad: 30, desde: 'reposicion' })
    expect(r.status).toBe(200)
    expect((await stockDe(p, t, CHIPA)).lotes).toEqual([
      { lote: 'CH-261001-1', cantidad: 50, reposicion: 20, distribucion: 30 },
      { lote: 'CH-261002-1', cantidad: 20, reposicion: 20, distribucion: 0 },
    ])
    // El otro lote no tiene nada en «Sucursales».
    const mal = await p.pedir(t, 'POST', '/reasignaciones', { productoId: CHIPA, lote: 'CH-261002-1', cantidad: 1, desde: 'distribucion' })
    expect(mal.status).toBe(409)
    expect(mal.body.error.mensaje).toBe('No hay stock de Chipa tradicional del lote CH-261002-1. En «Reponer venta» hay 20: cambiales la finalidad en Stock en frío si querés usarlos.')
  })

  it('no cuenta como salida en el reporte y muestra el reparto del stock', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 10 }])
    await p.pedir(cocina, 'POST', '/reasignaciones', { productoId: EMPANADA, cantidad: 4, desde: 'reposicion' })
    const hoy = diaPY()
    const rep = (await p.pedir<Reporte>(admin, 'GET', `/reportes?desde=${hoy}&hasta=${hoy}`)).body
    expect(rep.salidas).toEqual([])
    expect(rep.stock).toEqual([{ sector: 'cocina', productoId: EMPANADA, productoNombre: 'Empanada frita (carne)', total: 10, reposicion: 6, distribucion: 4 }])
  })
})

describe('stock mínimo (C08)', () => {
  async function conMinimos() {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    for (const [id, minimo] of [[EMPANADA, 10], [MARINERA, 5], [CHIPA, 100]] as const) {
      expect((await p.pedir(admin, 'PATCH', `/productos/${id}`, { stockMinimo: minimo })).status).toBe(200)
    }
    return { p, admin, cocina }
  }

  it('el administrador lo pone, lo cambia y lo quita desde el catálogo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    expect((await p.pedir(cocina, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: 3 })).status).toBe(403)
    const a = await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: 12 })
    expect(a.body).toMatchObject({ id: EMPANADA, stockMinimo: 12 })
    expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: '8' })).body.stockMinimo).toBe(8)
    expect((await p.pedir(cocina, 'GET', '/productos')).body.find((x: any) => x.id === EMPANADA).stockMinimo).toBe(8)
    expect((await stockDe(p, cocina, EMPANADA)).minimo).toBe(8)
    for (const malo of [-1, 1.5, 'mucho', true]) {
      expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: malo })).status, String(malo)).toBe(400)
    }
    expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: '' })).body.stockMinimo).toBeNull()
    expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: 4 })).status).toBe(200)
    expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: null })).body.stockMinimo).toBeNull()
    const nuevo = await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Pastel', stockMinimo: 20 })
    expect(nuevo.body.stockMinimo).toBe(20)
    const aud = await p.sql("SELECT antes, despues FROM auditoria WHERE tabla = 'productos' AND registro_id = ? ORDER BY fecha", EMPANADA)
    expect(JSON.parse(aud[0].despues).stockMinimo).toBe(12)
  })

  it('avisa de los productos activos con menos que el mínimo, sumando finalidades y lotes', async () => {
    const { p, admin, cocina } = await conMinimos()
    // Empanada: 6 + 3 = 9 < 10 → avisa. Marinera: 5 = mínimo → no avisa.
    await producir(p, cocina, [{ productoId: EMPANADA, guardado: 6 }, { productoId: MARINERA, guardado: 5, finalidad: 'distribucion' }])
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, tipo: 'stock_inicial', cantidad: 3, finalidad: 'distribucion', motivo: 'Inicio' })

    const r = await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([{
      tipo: 'stock_minimo', sector: 'cocina', texto: 'Empanada frita (carne): quedan 9 en frío (mínimo 10).', enlace: '/stock',
    }])

    // Al subir el stock por encima del mínimo, el aviso desaparece.
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, tipo: 'stock_inicial', cantidad: 1, motivo: 'Conteo' })
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')).body).toEqual([])
  })

  it('un producto sin nada en frío avisa «no queda nada»; los desactivados y los sin mínimo no avisan', async () => {
    const { p, cocina, admin } = await conMinimos()
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')).body.map((a) => a.texto)).toEqual([
      'Empanada frita (carne): no queda nada en frío (mínimo 10).',
      'Marinera de carne: no queda nada en frío (mínimo 5).',
    ])
    await p.pedir(admin, 'PATCH', `/productos/${MARINERA}`, { activo: false })
    await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: null })
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')).body).toEqual([])
  })

  it('cada operador ve las de su sector; el administrador, todas o las del sector que pida', async () => {
    const { p, admin } = await conMinimos()
    const chiperia = await p.entrar('chiperia')
    const cocina = await p.entrar('cocina')
    expect((await p.pedir<Alerta[]>(chiperia, 'GET', '/stock/alertas')).body.map((a) => a.sector)).toEqual(['chiperia'])
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')).body.map((a) => a.sector)).toEqual(['cocina', 'cocina'])
    expect((await p.pedir<Alerta[]>(admin, 'GET', '/stock/alertas')).body.map((a) => a.sector)).toEqual(['chiperia', 'cocina', 'cocina'])
    expect((await p.pedir<Alerta[]>(admin, 'GET', '/stock/alertas?sector=chiperia')).body).toHaveLength(1)
    expect((await p.pedir(cocina, 'GET', '/stock/alertas?sector=chiperia')).status).toBe(403)
    expect((await p.pedir(admin, 'GET', '/stock/alertas?sector=nada')).status).toBe(400)
    expect((await p.pedir(null, 'GET', '/stock/alertas')).status).toBe(401)
    // La función que usan el inicio, el resumen y el correo.
    expect(await alertasStock(p.env.DB, null)).toHaveLength(3)
    expect(await alertasStock(p.env.DB, 'chiperia')).toHaveLength(1)
    expect(await alertasStock(p.env.DB, 'panaderia')).toEqual([])
  })
})

describe('migración 0007: los movimientos que ya estaban quedan como «reposicion»', () => {
  it('conserva el libro, marca todo como reposición y mantiene el control de stock', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const d1 = new D1SqlJs(db)
    const nombres = Object.keys(MIGRACIONES).sort()
    const migracion = nombres.find((x) => x.includes('0007'))!
    for (const n of nombres.filter((x) => x < migracion)) d1.exec(MIGRACIONES[n])
    db.run(`INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES ('u', 'U', 'u', 'x', 'cocina', 1, 0, 'ya')`)
    db.run(`INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, usuario_id, fecha, dia) VALUES
      ('a', 'cocina', '${EMPANADA}', NULL, 'produccion', 10, 'u', '2026-10-01T10:00:00Z', '2026-10-01'),
      ('b', 'cocina', '${EMPANADA}', NULL, 'salida_venta', -4, 'u', '2026-10-02T10:00:00Z', '2026-10-02')`)
    d1.exec(MIGRACIONES[migracion])

    const filas = db.exec('SELECT id, cantidad, finalidad FROM movimientos ORDER BY rowid')[0].values
    expect(filas).toEqual([['a', 10, 'reposicion'], ['b', -4, 'reposicion']])
    expect(db.exec("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'movimientos'")[0].values).toEqual([['movimientos_sin_stock_negativo']])
    // Sigue sin dejar sacar de más (hay 6) y el control es por finalidad.
    const sacar = (cantidad: number, finalidad: string) => () =>
      db.run(`INSERT INTO movimientos (id, sector, producto_id, tipo, cantidad, finalidad, usuario_id, fecha, dia)
              VALUES ('x${-cantidad}${finalidad}', 'cocina', '${EMPANADA}', 'merma', ${cantidad}, '${finalidad}', 'u', 'f', 'd')`)
    expect(sacar(-7, 'reposicion')).toThrow(/STOCK_INSUFICIENTE/)
    expect(sacar(-1, 'distribucion')).toThrow(/STOCK_INSUFICIENTE/)
    expect(sacar(-6, 'reposicion')).not.toThrow()
    expect(db.exec(`SELECT stock_minimo FROM productos WHERE id = '${EMPANADA}'`)[0].values).toEqual([[null]])
  })
})
