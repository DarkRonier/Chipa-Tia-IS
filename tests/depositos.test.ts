// Stock por depósitos (2026-11-21): el catálogo de depósitos, las transferencias, «Sacar para la venta» desde cualquier
// depósito, adónde entra cada cosa (producción, compras) y cómo pasan los datos de antes (migración 0014).
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import type { Compra, Deposito, Movimiento, Producto, Proveedor, StockFila } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const MIGRACIONES = import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

const EMPANADA = 'prod-cocina-10'
const COCIDO = 'prod-cocina-02'
const CHIPA = 'prod-chiperia-01'

const fila = async (p: Prueba, token: string, sector: string, producto: string) =>
  (await p.pedir<StockFila[]>(token, 'GET', `/stock?sector=${sector}`)).body.find((f) => f.productoId === producto)

async function cargar(p: Prueba, admin: string, producto: string, cantidad: number, depositoId: string, sector = 'cocina', lote?: string) {
  const r = await p.pedir(admin, 'POST', '/ajustes', { sector, productoId: producto, tipo: 'stock_inicial', cantidad, motivo: 'Inicial', depositoId, lote })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
}

describe('catálogo de depósitos', () => {
  it('trae los 4 del sistema en orden; todos los ven, solo el administrador los cambia', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const r = await p.pedir<Deposito[]>(cocina, 'GET', '/depositos')
    expect(r.status).toBe(200)
    expect(r.body.map((d) => [d.id, d.nombre, d.sistema, d.activo])).toEqual([
      ['venta', 'Directo a Venta', true, true],
      ['frio', 'Frío', true, true],
      ['sucursales', 'Para sucursales', true, true],
      ['materia_prima', 'Materia prima', true, true],
    ])
    expect((await p.pedir(cocina, 'POST', '/depositos', { nombre: 'Cámara 2' })).status).toBe(403)
    expect((await p.pedir(cocina, 'PATCH', '/depositos/frio', { nombre: 'Heladera' })).status).toBe(403)
  })

  it('el administrador agrega uno, lo renombra y lo desactiva cuando queda vacío; los del sistema no se desactivan', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const nuevo = await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2', descripcion: 'La del fondo' })
    expect(nuevo.status).toBe(200)
    expect(nuevo.body).toMatchObject({ nombre: 'Cámara 2', descripcion: 'La del fondo', sistema: false, activo: true })
    expect((await p.pedir(admin, 'POST', '/depositos', { nombre: 'cámara 2' })).status).toBe(409)
    expect((await p.pedir(admin, 'POST', '/depositos', { nombre: '' })).status).toBe(400)
    const lista = (await p.pedir<Deposito[]>(admin, 'GET', '/depositos')).body
    expect(lista.at(-1)!.id).toBe(nuevo.body.id)

    // Renombrar uno del sistema se puede; desactivarlo no.
    expect((await p.pedir<Deposito>(admin, 'PATCH', '/depositos/frio', { nombre: 'Congelador' })).body.nombre).toBe('Congelador')
    const sistema = await p.pedir(admin, 'PATCH', '/depositos/venta', { activo: false })
    expect(sistema.status).toBe(409)
    expect(sistema.body.error.codigo).toBe('deposito_del_sistema')

    // Con stock no se desactiva: primero hay que pasarlo a otro.
    await cargar(p, admin, EMPANADA, 5, nuevo.body.id)
    const conStock = await p.pedir(admin, 'PATCH', `/depositos/${nuevo.body.id}`, { activo: false })
    expect(conStock.status).toBe(409)
    expect(conStock.body.error).toMatchObject({ codigo: 'deposito_con_stock', mensaje: '«Cámara 2» todavía tiene stock de 1 producto. Pasalo a otro depósito antes de desactivarlo.' })
    expect((await p.pedir(admin, 'POST', '/transferencias', { sector: 'cocina', productoId: EMPANADA, cantidad: 5, desde: nuevo.body.id, hacia: 'frio' })).status).toBe(200)
    const apagado = await p.pedir<Deposito>(admin, 'PATCH', `/depositos/${nuevo.body.id}`, { activo: false })
    expect(apagado.body.activo).toBe(false)
    // Desactivado no aparece para los sectores, y no recibe nada.
    const cocina = await p.entrar('cocina')
    expect((await p.pedir<Deposito[]>(cocina, 'GET', '/depositos')).body.some((d) => d.id === nuevo.body.id)).toBe(false)
    const r = await p.pedir(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 1, desde: 'frio', hacia: nuevo.body.id })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toBe('El depósito Cámara 2 está desactivado. Elegí otro.')

    const acciones = (await p.sql("SELECT accion FROM auditoria WHERE tabla = 'depositos' ORDER BY rowid")).map((a) => a.accion)
    expect(acciones).toEqual(['crear', 'editar', 'desactivar'])
  })
})

describe('transferencias', () => {
  it('pasan unidades entre depósitos sin cambiar el total, y el historial muestra solo la salida con «De … a …»', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 10, 'frio')
    const r = await p.pedir<Movimiento[]>(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 4, desde: 'frio', hacia: 'sucursales' })
    expect(r.status).toBe(200)
    expect(r.body.map((m) => [m.tipo, m.depositoId, m.cantidad])).toEqual([['transferencia', 'frio', -4], ['transferencia', 'sucursales', 4]])
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 10, porDeposito: { frio: 6, sucursales: 4 } })
    const historial = (await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&tipo=transferencia`)).body
    expect(historial.map((m) => [m.depositoId, m.cantidad, m.motivo])).toEqual([['frio', -4, 'De «Frío» a «Para sucursales»']])
    // Filtrar por depósito.
    expect((await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&deposito=sucursales`)).body).toEqual([])
    expect((await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&deposito=frio`)).body.map((m) => m.tipo))
      .toEqual(['transferencia', 'stock_inicial'])
  })

  it('valida origen, destino y lo que hay; avisa si en otro depósito sí hay', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 3, 'frio')
    const pedir = (b: object) => p.pedir(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 1, ...b })
    expect((await pedir({ desde: 'frio', hacia: 'frio' })).body.error.mensaje).toBe('El depósito de origen y el de destino son el mismo. Elegí otro destino.')
    expect((await pedir({ desde: 'frio' })).status).toBe(400)
    expect((await pedir({ hacia: 'frio', desde: 'nada' })).status).toBe(400)
    const poco = await pedir({ desde: 'frio', hacia: 'venta', cantidad: 5 })
    expect(poco.status).toBe(409)
    expect(poco.body.error.mensaje).toBe('No hay stock suficiente en «Frío»: de Empanada frita (carne) hay 3 y querés sacar 5.')
    const otro = await pedir({ desde: 'sucursales', hacia: 'venta' })
    expect(otro.body.error.mensaje).toBe('No hay stock de Empanada frita (carne) en «Para sucursales». En «Frío» hay 3: pasalo con «Transferir» en Stock si querés usarlo.')
    // Un sector no mueve lo de otro.
    expect((await pedir({ sector: 'chiperia', desde: 'frio', hacia: 'venta' })).status).toBe(403)
  })

  it('en Chipería se transfiere por lote', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const chiperia = await p.entrar('chiperia')
    await cargar(p, admin, CHIPA, 50, 'frio', 'chiperia', 'CH-261101-1')
    expect((await p.pedir(chiperia, 'POST', '/transferencias', { productoId: CHIPA, cantidad: 10, desde: 'frio', hacia: 'sucursales' })).status).toBe(400)
    const r = await p.pedir(chiperia, 'POST', '/transferencias', { productoId: CHIPA, lote: 'CH-261101-1', cantidad: 10, desde: 'frio', hacia: 'sucursales' })
    expect(r.status).toBe(200)
    expect((await fila(p, chiperia, 'chiperia', CHIPA))!.lotes).toEqual([{ lote: 'CH-261101-1', cantidad: 50, porDeposito: { frio: 40, sucursales: 10 } }])
  })
})

describe('sacar para la venta y envíos', () => {
  it('«Sacar para la venta» pasa a Directo a Venta desde Frío o desde el depósito que se elija', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 10, 'frio')
    await cargar(p, admin, EMPANADA, 5, 'sucursales')
    const r = await p.pedir<Movimiento>(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 3 })
    expect(r.body).toMatchObject({ tipo: 'salida_venta', depositoId: 'frio', cantidad: -3, motivo: 'De «Frío» a «Directo a Venta»' })
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 2, desde: 'sucursales' })).status).toBe(200)
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1, desde: 'venta' })).status).toBe(400)
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 15, porDeposito: { frio: 7, sucursales: 3, venta: 5 } })
  })

  it('los envíos salen de «Para sucursales»', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 10, 'frio')
    const envio = { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 2 }] }
    expect((await p.pedir(cocina, 'POST', '/envios', envio)).status).toBe(409)
    await p.pedir(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 2, desde: 'frio', hacia: 'sucursales' })
    const r = await p.pedir(cocina, 'POST', '/envios', envio)
    expect(r.status).toBe(200)
    expect(r.body.movimientos[0]).toMatchObject({ depositoId: 'sucursales', cantidad: -2 })
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 8, porDeposito: { frio: 8 } })
  })
})

describe('compras', () => {
  it('lo de venta directa entra en Directo a Venta y la materia prima en Materia prima; anular saca de ahí', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const gaseosa = (await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Gaseosa 500 ml', tipo: 'reventa' })).body
    await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { tipo: 'materia_prima' })
    const sup = await p.entrar('supervisor')
    const proveedor = (await p.pedir<Proveedor>(sup, 'POST', '/proveedores', { nombre: 'Distribuidora Sur' })).body
    const c = await p.pedir<Compra>(sup, 'POST', '/compras', {
      proveedorId: proveedor.id, items: [{ productoId: gaseosa.id, cantidad: 12, precioUnitario: 5000 }, { productoId: COCIDO, cantidad: 3, precioUnitario: 1000 }],
    })
    expect(c.status).toBe(200)
    expect((await fila(p, sup, 'cocina', gaseosa.id))!.porDeposito).toEqual({ venta: 12 })
    expect((await fila(p, sup, 'cocina', COCIDO))!.porDeposito).toEqual({ materia_prima: 3 })
    expect((await p.pedir(sup, 'POST', `/compras/${c.body.id}/anular`, { motivo: 'Duplicada' })).status).toBe(200)
    expect((await fila(p, sup, 'cocina', gaseosa.id))!.total).toBe(0)
    expect((await fila(p, sup, 'cocina', COCIDO))!.total).toBe(0)
  })
})

describe('migración de los datos de antes (0014)', () => {
  it('pasa cada movimiento a su depósito, las reasignaciones a transferencias y saca los campos de stock de los productos', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const nombres = Object.keys(MIGRACIONES).sort()
    const i = nombres.findIndex((n) => n.includes('0014_depositos'))
    for (const n of nombres.slice(0, i)) db.exec(MIGRACIONES[n])
    db.exec(`
      INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES ('u', 'U', 'u', 'x', 'admin', 1, 0, '2026-11-01');
      UPDATE productos SET tipo = 'reventa' WHERE id = '${COCIDO}';
      INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES ('pr', 'cocina', 'u', '2026-11-01', '2026-11-01', 'dia');
      INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado, finalidad) VALUES ('pr', '${EMPANADA}', 5, 10, 'distribucion');
      INSERT INTO movimientos (id, sector, producto_id, tipo, cantidad, usuario_id, fecha, dia, finalidad) VALUES
        ('m1', 'cocina', '${EMPANADA}', 'produccion', 10, 'u', '2026-11-01', '2026-11-01', 'reposicion'),
        ('m2', 'cocina', '${EMPANADA}', 'reasignacion', -4, 'u', '2026-11-01', '2026-11-01', 'reposicion'),
        ('m3', 'cocina', '${EMPANADA}', 'reasignacion', 4, 'u', '2026-11-01', '2026-11-01', 'distribucion'),
        ('m4', 'cocina', '${COCIDO}', 'compra', 6, 'u', '2026-11-01', '2026-11-01', 'reposicion'),
        ('m5', 'cocina', '${COCIDO}', 'venta', -2, 'u', '2026-11-01', '2026-11-01', 'reposicion');
    `)
    db.exec(MIGRACIONES[nombres[i]])
    const movs = db.exec('SELECT id, tipo, deposito_id, cantidad FROM movimientos ORDER BY id')[0].values
    expect(movs).toEqual([
      ['m1', 'produccion', 'frio', 10],
      ['m2', 'transferencia', 'frio', -4],
      ['m3', 'transferencia', 'sucursales', 4],
      ['m4', 'compra', 'venta', 6],
      ['m5', 'venta', 'venta', -2],
    ])
    expect(db.exec('SELECT deposito_id FROM produccion_items')[0].values).toEqual([['sucursales']])
    const columnas = db.exec("SELECT name FROM pragma_table_info('productos')")[0].values.flat()
    expect(columnas).not.toContain('stock_obligatorio')
    expect(db.exec("SELECT name FROM pragma_table_info('produccion_items')")[0].values.flat()).not.toContain('finalidad')
  })
})
