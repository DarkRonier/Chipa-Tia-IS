// Stock por depósitos (2026-11-21): el catálogo de depósitos, las transferencias, «Sacar para la venta» desde cualquier
// depósito, adónde entra cada cosa (producción, compras) y cómo pasan los datos de antes (migraciones 0014 y 0015).
// Desde la 0015: dos depósitos de venta (frente y comedor), almacenes que crea y borra el super-administrador,
// sucursales que solo registran lo enviado y productos agrupados por categoría.
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

/** Activa el modo super-administrador en la sesión del administrador (Configuración → Ajustes avanzados). */
async function superAdmin(p: Prueba, admin: string) {
  const r = await p.pedir<{ superHasta: string }>(admin, 'POST', '/auth/super', { clave: '1234' })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.superHasta
}

describe('catálogo de depósitos', () => {
  it('dos de venta (frente y comedor) y Cámara 1; la materia prima no es un depósito; todos los ven, solo el administrador los renombra', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const r = await p.pedir<Deposito[]>(cocina, 'GET', '/depositos')
    expect(r.status).toBe(200)
    expect(r.body.map((d) => [d.id, d.nombre, d.tipo, d.sistema])).toEqual([
      ['venta', 'Venta frente', 'venta', true],
      ['comedor', 'Venta comedor', 'venta', true],
      ['frio', 'Cámara 1', 'almacen', false],
    ])
    // Cada depósito de venta admite sus categorías; los fríos, cualquiera.
    expect(r.body.map((d) => d.categorias)).toEqual([
      ['cat-bocaditos', 'cat-sticks', 'cat-panificados', 'cat-bebidas', 'cat-amandau', 'cat-otros'],
      ['cat-buffet', 'cat-bebidas'],
      [],
    ])
    expect(r.body.every((d) => d.maquina === null)).toBe(true)
    // El cajero también los ve (cuánto hay y cuánto se vendió).
    expect((await p.pedir(await p.entrar('cajero'), 'GET', '/stock?todos=1')).status).toBe(200)
    expect((await p.pedir(cocina, 'POST', '/depositos', { nombre: 'Cámara 2' })).status).toBe(403)
    expect((await p.pedir(cocina, 'PATCH', '/depositos/frio', { nombre: 'Heladera' })).status).toBe(403)
    const admin = await p.entrar('admin')
    expect((await p.pedir<Deposito>(admin, 'PATCH', '/depositos/venta', { nombre: 'Mostrador' })).body.nombre).toBe('Mostrador')
    expect((await p.pedir(admin, 'PATCH', '/depositos/materia_prima', { nombre: 'Materia prima' })).status).toBe(404)
  })

  it('solo el super-administrador crea y borra almacenes; vacíos y quedando al menos otro', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    // Sin el modo super-administrador, el administrador no puede.
    const sinSuper = await p.pedir(admin, 'POST', '/depositos', { nombre: 'Cámara 2' })
    expect(sinSuper.status).toBe(403)
    expect(sinSuper.body.error.mensaje).toContain('super-administrador')
    expect((await p.pedir(admin, 'POST', '/auth/super', { clave: 'mal' })).status).toBe(400)
    const hasta = await superAdmin(p, admin)
    expect(Date.parse(hasta) - Date.now()).toBeGreaterThan(29 * 60_000)
    expect((await p.pedir<{ superHasta: string | null }>(admin, 'GET', '/auth/yo')).body.superHasta).toBe(hasta)
    // Solo el administrador puede activarlo.
    expect((await p.pedir(await p.entrar('supervisor'), 'POST', '/auth/super', { clave: '1234' })).status).toBe(403)

    const nuevo = await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2', descripcion: 'La del fondo' })
    expect(nuevo.status).toBe(200)
    expect(nuevo.body).toMatchObject({ nombre: 'Cámara 2', descripcion: 'La del fondo', sistema: false, activo: true, tipo: 'almacen' })
    expect((await p.pedir(admin, 'POST', '/depositos', { nombre: 'cámara 2' })).status).toBe(409)
    expect((await p.pedir(admin, 'POST', '/depositos', { nombre: '' })).status).toBe(400)
    // Va después de los otros depósitos fríos.
    expect((await p.pedir<Deposito[]>(admin, 'GET', '/depositos')).body.map((d) => d.id)).toEqual(['venta', 'comedor', 'frio', nuevo.body.id])

    // Los de venta no se borran; la materia prima no es un depósito.
    expect((await p.pedir(admin, 'DELETE', '/depositos/materia_prima')).status).toBe(404)
    for (const id of ['venta', 'comedor']) {
      const r = await p.pedir(admin, 'DELETE', `/depositos/${id}`)
      expect(r.status).toBe(409)
      expect(r.body.error.codigo).toBe('deposito_del_sistema')
    }
    // Con stock no se borra: primero hay que pasarlo a otro.
    await cargar(p, admin, EMPANADA, 5, nuevo.body.id)
    const conStock = await p.pedir(admin, 'DELETE', `/depositos/${nuevo.body.id}`)
    expect(conStock.status).toBe(409)
    expect(conStock.body.error.codigo).toBe('deposito_con_stock')
    expect((await p.pedir(admin, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 5, desde: nuevo.body.id, hacia: 'frio' })).status).toBe(200)
    expect((await p.pedir(admin, 'DELETE', `/depositos/${nuevo.body.id}`)).status).toBe(200)
    // Tuvo movimientos: queda oculto (por el historial), no aparece y no recibe nada.
    const cocina = await p.entrar('cocina')
    expect((await p.pedir<Deposito[]>(cocina, 'GET', '/depositos')).body.some((d) => d.id === nuevo.body.id)).toBe(false)
    const r = await p.pedir(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 1, desde: 'frio', hacia: nuevo.body.id })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toBe('El depósito Cámara 2 ya no existe. Elegí otro.')
    // Frío es el único almacén en frío que queda: no se borra.
    const ultimo = await p.pedir(admin, 'DELETE', '/depositos/frio')
    expect(ultimo.status).toBe(409)
    expect(ultimo.body.error.codigo).toBe('ultimo_almacen')
    // Uno sin movimientos se borra del todo.
    const vacio = (await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Freezer 3' })).body
    expect((await p.pedir(admin, 'DELETE', `/depositos/${vacio.id}`)).status).toBe(200)
    expect(await p.sql(`SELECT id FROM depositos WHERE id = '${vacio.id}'`)).toEqual([])

    // Al salir del modo, vuelve a no poder.
    expect((await p.pedir(admin, 'POST', '/auth/super/salir')).status).toBe(200)
    expect((await p.pedir(admin, 'POST', '/depositos', { nombre: 'Cámara 4' })).status).toBe(403)
    const acciones = (await p.sql("SELECT accion FROM auditoria WHERE tabla = 'depositos' ORDER BY rowid")).map((a) => a.accion)
    expect(acciones).toEqual(['crear', 'borrar', 'crear', 'borrar'])
  })
})

describe('transferencias', () => {
  it('pasan unidades de un frío a otro sin cambiar el total, y el historial muestra solo la salida con «De … a …»', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await superAdmin(p, admin)
    const camara2 = (await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2' })).body
    await cargar(p, admin, EMPANADA, 10, 'frio')
    const r = await p.pedir<Movimiento[]>(cocina, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 4, desde: 'frio', hacia: camara2.id })
    expect(r.status).toBe(200)
    expect(r.body.map((m) => [m.tipo, m.depositoId, m.cantidad])).toEqual([['transferencia', 'frio', -4], ['transferencia', camara2.id, 4]])
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 10, porDeposito: { frio: 6, [camara2.id]: 4 } })
    const historial = (await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&tipo=transferencia`)).body
    expect(historial.map((m) => [m.depositoId, m.cantidad, m.motivo])).toEqual([['frio', -4, 'De «Cámara 1» a «Cámara 2»']])
    // Filtrar por depósito.
    expect((await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&deposito=${camara2.id}`)).body).toEqual([])
    expect((await p.pedir<Movimiento[]>(cocina, 'GET', `/movimientos?producto=${EMPANADA}&deposito=frio`)).body.map((m) => m.tipo))
      .toEqual(['transferencia', 'stock_inicial'])
  })

  it('valida origen, destino y lo que hay; avisa si en otro depósito sí hay; cada sector mueve lo suyo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await superAdmin(p, admin)
    const c2 = (await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2' })).body.id
    await cargar(p, admin, EMPANADA, 3, 'frio')
    const pedir = (b: object, token = cocina) => p.pedir(token, 'POST', '/transferencias', { productoId: EMPANADA, cantidad: 1, ...b })
    expect((await pedir({ desde: 'frio', hacia: 'frio' })).body.error.mensaje).toBe('El depósito de origen y el de destino son el mismo. Elegí otro destino.')
    expect((await pedir({ desde: 'frio' })).status).toBe(400)
    expect((await pedir({ hacia: 'frio', desde: 'nada' })).status).toBe(400)
    // A la venta se pasa con «Sacar para la venta»; de la venta solo se vende o se da de baja.
    const aVenta = await pedir({ desde: 'frio', hacia: 'venta' })
    expect(aVenta.status).toBe(400)
    expect(aVenta.body.error.mensaje).toBe('Para pasar a «Venta frente» usá «Sacar para la venta».')
    const deVenta = await pedir({ desde: 'venta', hacia: 'frio' })
    expect(deVenta.status).toBe(400)
    expect(deVenta.body.error.mensaje).toContain('ya está a la venta')
    // La materia prima no es un depósito: no se elige.
    expect((await pedir({ desde: 'frio', hacia: 'materia_prima' })).body.error.mensaje).toBe('Ese depósito no existe. Recargá la página y probá de nuevo.')
    expect((await pedir({ desde: 'materia_prima', hacia: 'frio' })).status).toBe(400)
    const poco = await pedir({ desde: 'frio', hacia: c2, cantidad: 5 })
    expect(poco.status).toBe(409)
    expect(poco.body.error.mensaje).toBe('No hay stock suficiente en «Cámara 1»: de Empanada frita (carne) hay 3 y querés sacar 5.')
    const otro = await pedir({ desde: c2, hacia: 'frio' })
    expect(otro.body.error.mensaje).toBe('No hay stock de Empanada frita (carne) en «Cámara 2». En «Cámara 1» hay 3: pasalo con «Transferir» en Depósitos si querés usarlo.')
    // Un sector no mueve lo de otro, ni diciendo otro sector.
    expect((await pedir({ sector: 'chiperia', desde: 'frio', hacia: c2 })).status).toBe(403)
    expect((await pedir({ desde: 'frio', hacia: c2 }, await p.entrar('panaderia'))).status).toBe(403)
    // El administrador no necesita decir el sector: sale del producto.
    expect((await pedir({ desde: 'frio', hacia: c2 }, admin)).status).toBe(200)
  })

  it('en Chipería se transfiere por lote', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const chiperia = await p.entrar('chiperia')
    await superAdmin(p, admin)
    const c2 = (await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2' })).body.id
    await cargar(p, admin, CHIPA, 50, 'frio', 'chiperia', 'CH-261101-1')
    expect((await p.pedir(chiperia, 'POST', '/transferencias', { productoId: CHIPA, cantidad: 10, desde: 'frio', hacia: c2 })).status).toBe(400)
    const r = await p.pedir(chiperia, 'POST', '/transferencias', { productoId: CHIPA, lote: 'CH-261101-1', cantidad: 10, desde: 'frio', hacia: c2 })
    expect(r.status).toBe(200)
    expect((await fila(p, chiperia, 'chiperia', CHIPA))!.lotes).toEqual([{ lote: 'CH-261101-1', cantidad: 50, porDeposito: { frio: 40, [c2]: 10 } }])
  })
})

describe('stock por depósito, sin separar por sector', () => {
  it('sin sector trae todos los productos con su categoría, subcategoría y unidad; los «sin stock» no aparecen', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await cargar(p, admin, EMPANADA, 4, 'frio')
    await cargar(p, admin, CHIPA, 6, 'frio', 'chiperia', 'CH-261101-1')
    const buffet = (await p.pedir<Producto>(admin, 'POST', '/productos', {
      sector: 'cocina', nombre: 'Buffet por kilo', unidad: 'kg', sinStock: true, subcategoria: 'Comedor', precioVenta: 60000,
    })).body
    expect(buffet).toMatchObject({ sinStock: true, subcategoria: 'Comedor', unidad: 'kg', categoriaId: 'cat-otros' })
    const cocina = await p.entrar('cocina')
    for (const token of [admin, cocina]) {
      const r = await p.pedir<StockFila[]>(token, 'GET', '/stock')
      expect(r.status).toBe(200)
      const sectores = new Set(r.body.map((f) => f.sector))
      expect(sectores).toEqual(new Set(['chiperia', 'chipitas', 'panaderia', 'cocina']))
      expect(r.body.find((f) => f.productoId === CHIPA)).toMatchObject({ sector: 'chiperia', categoriaId: 'cat-bocaditos', total: 6, porDeposito: { frio: 6 } })
      expect(r.body.find((f) => f.productoId === EMPANADA)).toMatchObject({ sector: 'cocina', categoriaId: 'cat-bocaditos', unidad: 'unidades', total: 4 })
      expect(r.body.some((f) => f.productoId === buffet.id)).toBe(false)
    }
    // A un producto con stock no se le puede poner «sin stock».
    const conStock = await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { sinStock: true })
    expect(conStock.status).toBe(409)
    expect(conStock.body.error.codigo).toBe('producto_con_stock')
    // Un producto «sin stock» no se mueve.
    expect((await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: buffet.id, tipo: 'stock_inicial', cantidad: 1, motivo: 'x' })).status).toBe(400)
  })
})

describe('sacar para la venta y envíos', () => {
  it('«Sacar para la venta» pasa de un almacén a Venta frente o a Venta comedor', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 10, 'frio')
    await cargar(p, admin, EMPANADA, 5, 'materia_prima')
    const r = await p.pedir<Movimiento>(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 3 })
    expect(r.body).toMatchObject({ tipo: 'salida_venta', depositoId: 'frio', cantidad: -3, motivo: 'De «Cámara 1» a «Venta frente»' })
    // Venta comedor no recibe «Chipas y bocaditos» hasta que el administrador suma esa categoría.
    const noVa = await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 2, hacia: 'comedor' })
    expect(noVa.status).toBe(400)
    expect(noVa.body.error.mensaje).toContain('«Venta comedor» no recibe productos de la categoría Chipas y bocaditos')
    const sumada = await p.pedir<Deposito>(admin, 'PATCH', '/depositos/comedor', { categorias: ['cat-buffet', 'cat-bebidas', 'cat-bocaditos'] })
    expect(sumada.body.categorias).toEqual(['cat-bocaditos', 'cat-buffet', 'cat-bebidas'])
    const comedor = await p.pedir<Movimiento>(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 2, hacia: 'comedor' })
    expect(comedor.body.motivo).toBe('De «Cámara 1» a «Venta comedor»')
    // La materia prima no es un depósito: no se vende desde ahí.
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 2, desde: 'materia_prima' })).status).toBe(400)
    // Desde un depósito de venta, o hacia un almacén, no.
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1, desde: 'venta' })).status).toBe(400)
    const aFrio = await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1, hacia: 'frio' })
    expect(aFrio.status).toBe(400)
    expect(aFrio.body.error.mensaje).toBe('«Cámara 1» no es un depósito de venta. Elegí Venta frente o Venta comedor.')
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 15, porDeposito: { frio: 5, materia_prima: 5, venta: 3, comedor: 2 } })
  })

  it('los envíos salen de un almacén (Frío si no se elige) y en Sucursales queda solo lo enviado', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    await cargar(p, admin, EMPANADA, 10, 'frio')
    await cargar(p, admin, EMPANADA, 4, 'venta')
    const envio = { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 2 }] }
    const r = await p.pedir(cocina, 'POST', '/envios', envio)
    expect(r.status).toBe(200)
    expect(r.body.movimientos[0]).toMatchObject({ depositoId: 'frio', cantidad: -2 })
    expect((await p.pedir(cocina, 'POST', '/envios', { ...envio, sucursalId: 'suc-ruta1', items: [{ productoId: EMPANADA, cantidad: 3 }] })).status).toBe(200)
    expect((await p.pedir(cocina, 'POST', '/envios', envio)).status).toBe(200)
    // Desde un depósito de venta, no.
    expect((await p.pedir(cocina, 'POST', '/envios', { ...envio, desde: 'venta' })).status).toBe(400)
    expect(await fila(p, cocina, 'cocina', EMPANADA)).toMatchObject({ total: 7, porDeposito: { frio: 3, venta: 4 } })
    const resumen = await p.pedir(await p.entrar('cajero'), 'GET', '/envios')
    expect(resumen.status).toBe(200)
    expect(resumen.body.map((e: any) => [e.sucursalId, e.productoId, e.cantidad, e.envios])).toEqual([
      ['suc-centro', EMPANADA, 4, 2],
      ['suc-ruta1', EMPANADA, 3, 1],
    ].sort((a, b) => resumen.body.findIndex((e: any) => e.sucursalId === a[0]) - resumen.body.findIndex((e: any) => e.sucursalId === b[0])))
  })
})

describe('lo vendido', () => {
  it('lo vendido hoy por producto, también los «sin stock» (el buffet)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const buffet = (await p.pedir<Producto>(admin, 'POST', '/productos', {
      sector: 'cocina', nombre: 'Buffet por kilo', unidad: 'kg', sinStock: true, precioVenta: 1000,
    })).body
    await cargar(p, admin, EMPANADA, 5, 'venta')
    await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { precioVenta: 2000 })
    const cajero = await p.entrar('cajero')
    expect((await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })).status).toBe(200)
    const venta = await p.pedir(cajero, 'POST', '/ventas', {
      items: [{ productoId: buffet.id, cantidad: 3 }, { productoId: EMPANADA, cantidad: 2 }], medio: 'efectivo',
    })
    expect(venta.status, JSON.stringify(venta.body)).toBe(200)
    // El buffet no mueve stock; la empanada sí.
    expect(await p.sql(`SELECT 1 FROM movimientos WHERE producto_id = '${buffet.id}'`)).toEqual([])
    expect(await fila(p, cajero, 'cocina', EMPANADA)).toMatchObject({ porDeposito: { venta: 3 } })
    const vendido = await p.pedir(cajero, 'GET', '/stock/vendido')
    expect(vendido.status).toBe(200)
    expect(vendido.body.map((v: any) => [v.productoId, v.depositoId, v.cantidad]).sort()).toEqual([
      [buffet.id, 'venta', 3], [EMPANADA, 'venta', 2],
    ].sort())
  })
})

describe('compras', () => {
  it('lo de venta directa entra en Venta frente y la materia prima en Materia prima; anular saca de ahí', async () => {
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

describe('migración a depósitos de venta y almacenes (0015)', () => {
  it('lo de «Para sucursales» pasa a Frío, aparece Venta comedor y los productos quedan con categoría', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const nombres = Object.keys(MIGRACIONES).sort()
    const i = nombres.findIndex((n) => n.includes('0015_'))
    for (const n of nombres.slice(0, i)) db.exec(MIGRACIONES[n])
    db.exec(`
      INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES ('u', 'U', 'u', 'x', 'admin', 1, 0, '2026-11-01');
      INSERT INTO movimientos (id, sector, producto_id, deposito_id, tipo, cantidad, usuario_id, fecha, dia) VALUES
        ('m1', 'cocina', '${EMPANADA}', 'sucursales', 'stock_inicial', 7, 'u', '2026-11-01', '2026-11-01'),
        ('m2', 'cocina', '${EMPANADA}', 'frio', 'stock_inicial', 3, 'u', '2026-11-01', '2026-11-01');
    `)
    db.exec(MIGRACIONES[nombres[i]])
    const saldo = db.exec("SELECT deposito_id, SUM(cantidad) FROM movimientos GROUP BY deposito_id ORDER BY deposito_id")[0].values
    expect(saldo).toEqual([['frio', 10], ['sucursales', 0]])
    const deps = db.exec('SELECT id, nombre, tipo, activo FROM depositos ORDER BY activo DESC, orden')[0].values
    expect(deps).toEqual([
      ['venta', 'Venta frente', 'venta', 1], ['comedor', 'Venta comedor', 'venta', 1], ['frio', 'Frío', 'almacen', 1],
      ['materia_prima', 'Materia prima', 'almacen', 1], ['sucursales', 'Para sucursales', 'almacen', 0],
    ])
    const sinCategoria = db.exec('SELECT COUNT(*) FROM productos WHERE categoria_id IS NULL')[0].values[0][0]
    expect(sinCategoria).toBe(0)
    expect(db.exec("SELECT categoria_id FROM productos WHERE id = '" + CHIPA + "'")[0].values[0][0]).toBe('cat-chiperia')
  })
})

describe('tipos de depósito (0019)', () => {
  it('un depósito frío puede tener una máquina: muestra su última medición y si está fuera de rango', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    // A un depósito de venta no se le vincula máquina; a uno frío no se le eligen categorías.
    expect((await p.pedir(admin, 'PATCH', '/depositos/venta', { maquinaId: 'maq-cocina-2' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/depositos/frio', { categorias: ['cat-bebidas'] })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/depositos/frio', { maquinaId: 'nada' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/depositos/venta', { categorias: ['nada'] })).status).toBe(400)
    // Freezer 1 de Cocina: hasta −18 °C.
    const r = await p.pedir<Deposito>(admin, 'PATCH', '/depositos/frio', { maquinaId: 'maq-cocina-2' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.maquina).toEqual({ id: 'maq-cocina-2', nombre: 'Freezer 1', tempMin: null, tempMax: -18, ultima: null })
    const cocina = await p.entrar('cocina')
    expect((await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-2', momento: 'inicio', estado: 'funciona', temperatura: -20 })).status).toBe(200)
    const bien = (await p.pedir<Deposito[]>(cocina, 'GET', '/depositos')).body.find((d) => d.id === 'frio')!
    expect(bien.maquina!.ultima).toMatchObject({ temperatura: -20, estado: 'funciona', fueraDeRango: false, usuarioNombre: 'Encargado Cocina' })
    expect((await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-2', momento: 'fin', estado: 'funciona', temperatura: -5 })).status).toBe(200)
    // El cajero también lo ve (mira Depósitos).
    const mal = (await p.pedir<Deposito[]>(await p.entrar('cajero'), 'GET', '/depositos')).body.find((d) => d.id === 'frio')!
    expect(mal.maquina!.ultima).toMatchObject({ temperatura: -5, fueraDeRango: true })
    // Se desvincula con null; un depósito frío nuevo puede nacer con máquina.
    expect((await p.pedir<Deposito>(admin, 'PATCH', '/depositos/frio', { maquinaId: null })).body.maquina).toBeNull()
    await superAdmin(p, admin)
    const nuevo = await p.pedir<Deposito>(admin, 'POST', '/depositos', { nombre: 'Cámara 2', maquinaId: 'maq-cocina-3' })
    expect(nuevo.body).toMatchObject({ tipo: 'almacen', maquina: { id: 'maq-cocina-3', nombre: 'Freezer 2' }, categorias: [] })
  })

  it('una categoría nueva entra en Venta frente', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cat = (await p.pedir(admin, 'POST', '/categorias', { nombre: 'Regalería', sectores: [] })).body
    const deps = (await p.pedir<Deposito[]>(admin, 'GET', '/depositos')).body
    expect(deps.find((d) => d.id === 'venta')!.categorias).toContain(cat.id)
    expect(deps.find((d) => d.id === 'comedor')!.categorias).not.toContain(cat.id)
  })

  it('solo el super-administrador crea y borra sucursales; con envíos quedan dadas de baja', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'DELETE', '/sucursales/suc-centro')).status).toBe(403)
    await superAdmin(p, admin)
    const nueva = (await p.pedir(admin, 'POST', '/sucursales', { nombre: 'Sucursal Luque' })).body
    expect((await p.pedir(admin, 'DELETE', `/sucursales/${nueva.id}`)).status).toBe(200)
    expect(await p.sql(`SELECT id FROM sucursales WHERE id = '${nueva.id}'`)).toEqual([])
    await cargar(p, admin, EMPANADA, 5, 'frio')
    const cocina = await p.entrar('cocina')
    expect((await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 2 }] })).status).toBe(200)
    expect((await p.pedir(admin, 'DELETE', '/sucursales/suc-centro')).status).toBe(200)
    expect(await p.sql("SELECT activo FROM sucursales WHERE id = 'suc-centro'")).toEqual([{ activo: 0 }])
    // Lo que se le envió sigue en el historial.
    expect((await p.pedir(admin, 'GET', '/envios')).body.map((e: any) => e.sucursalId)).toEqual(['suc-centro'])
    expect((await p.pedir(admin, 'DELETE', '/sucursales/nada')).status).toBe(404)
  })

  it('migración: «Frío» pasa a «Cámara 1», Materia prima queda como depósito frío y el stock no se mueve', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const nombres = Object.keys(MIGRACIONES).sort()
    const i = nombres.findIndex((n) => n.includes('0019_'))
    for (const n of nombres.slice(0, i)) db.exec(MIGRACIONES[n])
    db.exec(`
      INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES ('u', 'U', 'u', 'x', 'admin', 1, 0, '2026-11-01');
      INSERT INTO movimientos (id, sector, producto_id, deposito_id, tipo, cantidad, usuario_id, fecha, dia) VALUES
        ('m1', 'cocina', '${EMPANADA}', 'frio', 'stock_inicial', 7, 'u', '2026-11-01', '2026-11-01'),
        ('m2', 'cocina', '${COCIDO}', 'materia_prima', 'stock_inicial', 3, 'u', '2026-11-01', '2026-11-01');
    `)
    const antes = db.exec('SELECT deposito_id, SUM(cantidad) FROM movimientos GROUP BY deposito_id ORDER BY deposito_id')[0].values
    db.exec(MIGRACIONES[nombres[i]])
    expect(db.exec('SELECT deposito_id, SUM(cantidad) FROM movimientos GROUP BY deposito_id ORDER BY deposito_id')[0].values).toEqual(antes)
    expect(db.exec("SELECT id, nombre, tipo, sistema FROM depositos WHERE borrado_en IS NULL ORDER BY orden")[0].values).toEqual([
      ['venta', 'Venta frente', 'venta', 1], ['comedor', 'Venta comedor', 'venta', 1], ['frio', 'Cámara 1', 'almacen', 0],
      ['materia_prima', 'Materia prima', 'almacen', 1],
    ])
  })
})

describe('la materia prima no es un depósito (0023)', () => {
  it('lo que no es materia prima vuelve a Cámara 1 con una transferencia; la materia prima queda y no se pierde nada', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const nombres = Object.keys(MIGRACIONES).sort()
    const i = nombres.findIndex((n) => n.includes('0023_'))
    for (const n of nombres.slice(0, i)) db.exec(MIGRACIONES[n])
    db.exec(`
      INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES ('u', 'U', 'u', 'x', 'admin', 1, 0, '2026-11-01');
      UPDATE productos SET tipo = 'materia_prima' WHERE id = '${COCIDO}';
      INSERT INTO movimientos (id, sector, producto_id, deposito_id, lote, tipo, cantidad, usuario_id, fecha, dia) VALUES
        ('m1', 'chiperia', '${CHIPA}', 'materia_prima', 'CH-261101-1', 'stock_inicial', 30, 'u', '2026-11-01', '2026-11-01'),
        ('m2', 'cocina', '${COCIDO}', 'materia_prima', NULL, 'stock_inicial', 3, 'u', '2026-11-01', '2026-11-01'),
        ('m3', 'cocina', '${EMPANADA}', 'materia_prima', NULL, 'stock_inicial', 4, 'u', '2026-11-01', '2026-11-01'),
        ('m4', 'cocina', '${EMPANADA}', 'materia_prima', NULL, 'merma', -4, 'u', '2026-11-01', '2026-11-01');
    `)
    db.exec(MIGRACIONES[nombres[i]])
    expect(db.exec(`SELECT producto_id, deposito_id, lote, SUM(cantidad) FROM movimientos GROUP BY producto_id, deposito_id, lote
                     HAVING SUM(cantidad) <> 0 ORDER BY producto_id, deposito_id`)[0].values).toEqual([
      [CHIPA, 'frio', 'CH-261101-1', 30],
      [COCIDO, 'materia_prima', null, 3],
    ])
    expect(db.exec("SELECT motivo FROM movimientos WHERE id LIKE 'mig23-%' AND cantidad > 0")[0].values)
      .toEqual([['De «Materia prima» a «Cámara 1» (la materia prima ya no es un depósito)']])
    expect(db.exec("SELECT nombre FROM depositos WHERE id = 'materia_prima'")[0].values).toEqual([['Stock de materia prima']])
  })
})
