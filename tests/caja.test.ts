// Etapa 3 (M11–M15): precios, caja, ventas con el circuito de stock acordado, factura preimpresa, ingresos y egresos,
// gastos fijos y sueldos, y el reporte detallado. Prueba los circuitos compra–pago y venta–cobro–factura–cierre.
import { describe, expect, it } from 'vitest'
import type { Alerta } from '../src/shared/alertas'
import { diaPY, sumarDias } from '../src/shared/hora'
import { puede } from '../src/shared/permisos'
import type {
  Caja, Compra, ConfigFactura, GastoFijo, GastoFijoMes, Producto, ProductoVenta, Proveedor, ReporteDetallado, ResumenIE, StockFila, Venta,
} from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const CHIPA = 'prod-chiperia-01'
const COCIDO = 'prod-cocina-02'
const EMPANADA = 'prod-cocina-10'

interface Escenario {
  p: Prueba
  admin: string
  cajero: string
  gaseosa: Producto
}

/**
 * Precios: chipa 3.000, cocido 5.000 (IVA 5) y gaseosa 7.000 (IVA 10). La empanada queda sin precio. Todo lo que se vende
 * descuenta del depósito «Directo a Venta».
 */
async function escenario(): Promise<Escenario> {
  const p = await nuevaPrueba()
  const admin = await p.entrar('admin')
  await p.pedir(admin, 'PATCH', `/productos/${CHIPA}`, { precioVenta: 3000 })
  await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { precioVenta: '5.000', iva: 5 })
  const gaseosa = (await p.pedir<Producto>(admin, 'POST', '/productos', {
    sector: 'cocina', nombre: 'Gaseosa 500 ml', precioVenta: 7000, tipo: 'reventa',
  })).body
  return { p, admin, cajero: await p.entrar('cajero'), gaseosa }
}

/** Lo que hay de un producto en un depósito (sin indicarlo, en Directo a Venta). */
const stockDe = async (p: Prueba, token: string, sector: string, producto: string, deposito = 'venta') =>
  (await p.pedir<StockFila[]>(token, 'GET', `/stock?sector=${sector}`)).body.find((f) => f.productoId === producto)?.porDeposito[deposito] ?? 0

/** Gaseosas cargadas en Directo a Venta con un ajuste del administrador. */
async function cargarGaseosas(e: Escenario, n: number) {
  const r = await e.p.pedir(e.admin, 'POST', '/ajustes', { sector: 'cocina', tipo: 'stock_inicial', productoId: e.gaseosa.id, cantidad: n, motivo: 'Inicial', depositoId: 'venta' })
  expect(r.status).toBe(200)
}

describe('permisos de caja, ventas y finanzas', () => {
  it('cajero: caja, ventas y facturas; admin todo menos vender; supervisor solo egresos a proveedores; sectores nada', () => {
    for (const x of ['caja.operar', 'ventas.registrar', 'ventas.anular', 'facturas.generar'] as const) {
      expect(puede('cajero', x)).toBe(true)
      expect(puede('admin', x)).toBe(x !== 'ventas.registrar')
      expect(puede('supervisor', x)).toBe(false)
      expect(puede('cocina', x)).toBe(false)
    }
    for (const x of ['ie.completo', 'reportes.detallados', 'facturas.configurar'] as const) {
      for (const r of ['cajero', 'supervisor', 'chiperia'] as const) expect(puede(r, x)).toBe(false)
      expect(puede('admin', x)).toBe(true)
    }
    expect(puede('supervisor', 'ie.egresos_proveedores')).toBe(true)
  })
})

describe('precios de venta', () => {
  it('el admin carga precio e IVA; se listan solo los productos con precio, con lo que hay en Directo a Venta', async () => {
    const e = await escenario()
    const { p, cajero, gaseosa } = e
    expect(gaseosa).toMatchObject({ precioVenta: 7000, iva: 10 })
    await cargarGaseosas(e, 6)
    const lista = (await p.pedir<ProductoVenta[]>(cajero, 'GET', '/ventas/productos')).body
    expect(lista.map((x) => x.nombre)).toEqual(['Chipa tradicional', 'Cocido con leche', 'Gaseosa 500 ml'])
    expect(lista.find((x) => x.id === COCIDO)).toMatchObject({ precio: 5000, iva: 5, stock: 0 })
    expect(lista.find((x) => x.id === gaseosa.id)).toMatchObject({ stock: 6 })
    const sup = await p.entrar('supervisor')
    expect((await p.pedir(sup, 'PATCH', `/productos/${CHIPA}`, { precioVenta: 1 })).status).toBe(403)
    expect((await p.pedir(sup, 'GET', '/ventas/productos')).status).toBe(403)
  })
})

describe('caja', () => {
  it('abre con fondo, una sola a la vez; sin caja no se vende', async () => {
    const { p, cajero } = await escenario()
    expect((await p.pedir<Caja | null>(cajero, 'GET', '/caja')).body).toBeNull()
    expect((await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' })).status).toBe(409)
    const caja = await p.pedir<Caja>(cajero, 'POST', '/caja/abrir', { fondoInicial: 100_000 })
    expect(caja.body).toMatchObject({ abierta: true, fondoInicial: 100_000, esperadoEfectivo: 100_000 })
    expect((await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })).status).toBe(409)
    const cocina = await p.entrar('cocina')
    expect((await p.pedir(cocina, 'GET', '/caja')).status).toBe(403)
  })

  it('venta–cobro–arqueo–cierre: el esperado suma fondo, ventas e ingresos y resta retiros; la diferencia queda', async () => {
    const { p, cajero } = await escenario()
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 50_000 })
    const v1 = await p.pedir<Venta>(cajero, 'POST', '/ventas', {
      items: [{ productoId: CHIPA, cantidad: 10 }, { productoId: COCIDO, cantidad: 2 }], descuento: 4000, medio: 'efectivo', recibido: 50_000,
      clienteNombre: 'Juan Pérez', clienteRuc: '1234567-8',
    })
    expect(v1.status).toBe(200)
    expect(v1.body).toMatchObject({ numero: 1, subtotal: 40_000, descuento: 4000, total: 36_000, vuelto: 14_000, clienteNombre: 'Juan Pérez' })
    await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 5 }], medio: 'qr' })
    await p.pedir(cajero, 'POST', '/caja/movimientos', { tipo: 'ingreso', importe: 20_000, concepto: 'Cambio' })
    await p.pedir(cajero, 'POST', '/caja/movimientos', { tipo: 'retiro', importe: 30_000, concepto: 'Depósito' })
    let caja = (await p.pedir<Caja>(cajero, 'GET', '/caja')).body
    // 50.000 + 36.000 + 20.000 − 30.000
    expect(caja.esperadoEfectivo).toBe(76_000)
    expect(caja.totales.find((t) => t.medio === 'qr')?.ventas).toBe(15_000)
    expect(caja).toMatchObject({ cantidadVentas: 2, totalVentas: 51_000 })
    caja = (await p.pedir<Caja>(cajero, 'POST', '/caja/arqueos', { contado: 75_000, nota: 'Falta una moneda' })).body
    expect(caja.arqueos![0]).toMatchObject({ esperado: 76_000, contado: 75_000, diferencia: -1000, esCierre: false })
    caja = (await p.pedir<Caja>(cajero, 'POST', '/caja/cerrar', { contado: 76_500 })).body
    expect(caja).toMatchObject({ abierta: false, esperadoEfectivo: 76_000, contadoEfectivo: 76_500, diferencia: 500 })
    expect((await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' })).status).toBe(409)
    expect((await p.pedir(cajero, 'POST', `/ventas/${v1.body.id}/anular`, { motivo: 'x' })).status).toBe(409)
    expect((await p.pedir(cajero, 'POST', '/caja/cerrar', { contado: 0 })).status).toBe(409)
  })

  it('cobro híbrido: una venta se cobra en partes (efectivo + tarjeta + cheque) y cada parte suma en su medio', async () => {
    const { p, admin, cajero } = await escenario()
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 10_000 })
    const vender = (pagos: object[], extra: object = {}) =>
      p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 20 }], pagos, ...extra })
    // 20 chipas = 60.000. Las partes tienen que sumar justo el total.
    expect((await vender([{ medio: 'efectivo', importe: 30_000 }, { medio: 'tarjeta', importe: 20_000 }])).status).toBe(400)
    expect((await vender([{ medio: 'efectivo', importe: 50_000 }, { medio: 'tarjeta', importe: 20_000 }])).status).toBe(400)
    expect((await vender([{ medio: 'efectivo', importe: 40_000 }, { medio: 'cheque', importe: 20_000 }])).status).toBe(400)
    // Lo recibido se compara con la parte en efectivo, no con el total.
    expect((await vender([{ medio: 'efectivo', importe: 25_000 }, { medio: 'tarjeta', importe: 35_000 }], { recibido: 20_000 })).status).toBe(400)

    const v = await vender([
      { medio: 'efectivo', importe: 25_000 },
      { medio: 'tarjeta', importe: 30_000 },
      { medio: 'cheque', importe: 5000, banco: 'Itaú', chequeNumero: '77' },
    ], { recibido: 30_000 })
    expect(v.status).toBe(200)
    expect(v.body).toMatchObject({ total: 60_000, medio: 'tarjeta', vuelto: 5000 })
    expect(v.body.pagos).toEqual([
      { medio: 'efectivo', importe: 25_000, banco: '', chequeNumero: '' },
      { medio: 'tarjeta', importe: 30_000, banco: '', chequeNumero: '' },
      { medio: 'cheque', importe: 5000, banco: 'Itaú', chequeNumero: '77' },
    ])
    // Una venta de un solo medio sigue igual (forma corta).
    const corta = await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'qr' })
    expect(corta.body.pagos).toEqual([{ medio: 'qr', importe: 3000, banco: '', chequeNumero: '' }])

    const caja = (await p.pedir<Caja>(cajero, 'GET', '/caja')).body
    expect(caja.esperadoEfectivo).toBe(35_000)
    expect(caja.totales.find((t) => t.medio === 'tarjeta')?.ventas).toBe(30_000)
    expect(caja.totales.find((t) => t.medio === 'cheque')?.ventas).toBe(5000)
    expect(caja.totales.find((t) => t.medio === 'qr')?.ventas).toBe(3000)
    expect(caja).toMatchObject({ cantidadVentas: 2, totalVentas: 63_000 })

    // El reporte detallado y los ingresos reparten la venta por medio.
    const hoy = diaPY()
    const rep = (await p.pedir<ReporteDetallado>(admin, 'GET', `/reportes/detallado?desde=${hoy}&hasta=${hoy}`)).body
    expect(rep.ventas.porMedio).toEqual(expect.arrayContaining([
      { medio: 'efectivo', cantidad: 1, importe: 25_000 }, { medio: 'tarjeta', cantidad: 1, importe: 30_000 },
    ]))
    const ie = (await p.pedir<ResumenIE>(admin, 'GET', `/ie?desde=${hoy}&hasta=${hoy}`)).body
    expect(ie.porMedio.find((m) => m.medio === 'cheque')?.ingresos).toBe(5000)
  })

  it('valida la venta: precio, cantidad, descuento y lo recibido', async () => {
    const { p, cajero } = await escenario()
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const vender = (extra: object) => p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 2 }], medio: 'efectivo', ...extra })
    expect((await vender({ items: [{ productoId: EMPANADA, cantidad: 1 }] })).status).toBe(400)
    expect((await vender({ items: [{ productoId: CHIPA, cantidad: 0.5 }] })).status).toBe(400)
    expect((await vender({ items: [] })).status).toBe(400)
    expect((await vender({ descuento: 7000 })).status).toBe(400)
    expect((await vender({ recibido: 5000 })).status).toBe(400)
    expect((await vender({ medio: 'fiado' })).status).toBe(400)
    // Dos líneas del mismo producto se juntan.
    const r = await vender({ items: [{ productoId: CHIPA, cantidad: 2 }, { productoId: CHIPA, cantidad: 3 }] })
    expect(r.body.items).toEqual([expect.objectContaining({ productoId: CHIPA, cantidad: 5, subtotal: 15_000 })])
  })
})

describe('stock de la venta: todo sale de «Directo a Venta»', () => {
  it('lo del frío se pasa a Directo a Venta y cada venta descuenta de ahí (la chipa por lote, el más viejo primero)', async () => {
    const e = await escenario()
    const { p, admin, cajero, gaseosa } = e
    const chiperia = await p.entrar('chiperia')
    // 50 chipas del lote viejo en el frío, 20 se pasan a la venta; después se cargan 10 de un lote nuevo directo en la venta.
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'chiperia', tipo: 'stock_inicial', productoId: CHIPA, lote: 'CH-261101-1', cantidad: 50, motivo: 'Inicial' })
    expect((await p.pedir(chiperia, 'POST', '/salidas', { productoId: CHIPA, lote: 'CH-261101-1', cantidad: 20 })).status).toBe(200)
    const loteNuevo = 'CH-261110-1'
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'chiperia', tipo: 'stock_inicial', productoId: CHIPA, lote: loteNuevo, cantidad: 10, motivo: 'Del horno', depositoId: 'venta' })
    expect(await stockDe(p, admin, 'chiperia', CHIPA)).toBe(30)
    await cargarGaseosas(e, 24)
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v = await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 25 }, { productoId: gaseosa.id, cantidad: 3 }], medio: 'efectivo' })
    expect(v.status).toBe(200)
    expect(await stockDe(p, admin, 'chiperia', CHIPA)).toBe(5)
    expect(await stockDe(p, admin, 'chiperia', CHIPA, 'frio')).toBe(30)
    expect(await stockDe(p, admin, 'cocina', gaseosa.id)).toBe(21)
    const movs = await p.sql(`SELECT producto_id, lote, deposito_id, cantidad FROM movimientos WHERE tipo = 'venta' ORDER BY producto_id, cantidad`)
    expect(movs).toEqual([
      { producto_id: gaseosa.id, lote: null, deposito_id: 'venta', cantidad: -3 },
      { producto_id: CHIPA, lote: 'CH-261101-1', deposito_id: 'venta', cantidad: -20 },
      { producto_id: CHIPA, lote: loteNuevo, deposito_id: 'venta', cantidad: -5 },
    ].sort((a, b) => a.producto_id.localeCompare(b.producto_id) || a.cantidad - b.cantidad))
  })

  it('la venta nunca se frena: si no se cargó lo que se vende, Directo a Venta queda en negativo', async () => {
    const e = await escenario()
    const { p, admin, cajero, gaseosa } = e
    await cargarGaseosas(e, 2)
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    expect((await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: gaseosa.id, cantidad: 3 }], medio: 'efectivo' })).status).toBe(200)
    expect(await stockDe(p, admin, 'cocina', gaseosa.id)).toBe(-1)
    expect((await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: COCIDO, cantidad: 4 }], medio: 'efectivo' })).status).toBe(200)
    expect(await stockDe(p, admin, 'cocina', COCIDO)).toBe(-4)
    const lista = (await p.pedir<ProductoVenta[]>(cajero, 'GET', '/ventas/productos')).body
    expect(lista.find((x) => x.id === COCIDO)?.stock).toBe(-4)
  })

  it('la materia prima con precio se vende (la leche) y sale del depósito Materia prima; sin precio no se vende', async () => {
    const e = await escenario()
    const { p, admin, cajero } = e
    const leche = (await p.pedir<Producto>(admin, 'POST', '/productos', {
      sector: 'cocina', nombre: 'Leche entera 1 L', tipo: 'materia_prima', precioVenta: 9000,
    })).body
    const harina = (await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Harina 000', tipo: 'materia_prima', unidad: 'kg' })).body
    expect((await p.pedir(admin, 'POST', '/ajustes', {
      sector: 'cocina', tipo: 'stock_inicial', productoId: leche.id, cantidad: 10, motivo: 'Inicial', depositoId: 'materia_prima',
    })).status).toBe(200)
    const lista = (await p.pedir<ProductoVenta[]>(cajero, 'GET', '/ventas/productos')).body
    expect(lista.find((x) => x.id === leche.id)).toMatchObject({ precio: 9000, stock: 10 })
    expect(lista.some((x) => x.id === harina.id)).toBe(false)
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v = await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: leche.id, cantidad: 3 }], medio: 'efectivo' })
    expect(v.status).toBe(200)
    expect(v.body.total).toBe(27000)
    expect(await stockDe(p, admin, 'cocina', leche.id, 'materia_prima')).toBe(7)
    expect(await stockDe(p, admin, 'cocina', leche.id, 'venta')).toBe(0)
    expect((await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: harina.id, cantidad: 1 }], medio: 'efectivo' })).status).toBe(400)
    // Al anular, vuelve a Materia prima.
    expect((await p.pedir(admin, 'POST', `/ventas/${v.body.id}/anular`, { motivo: 'Mal cobrada' })).status).toBe(200)
    expect(await stockDe(p, admin, 'cocina', leche.id, 'materia_prima')).toBe(10)
  })

  it('el administrador y el supervisor no venden; el administrador ve las ventas y puede anularlas', async () => {
    const e = await escenario()
    const { p, admin, cajero } = e
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const venta = { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' }
    const r = await p.pedir(admin, 'POST', '/ventas', venta)
    expect(r.status).toBe(403)
    expect((await p.pedir(await p.entrar('supervisor'), 'POST', '/ventas', venta)).status).toBe(403)
    const v = (await p.pedir<Venta>(cajero, 'POST', '/ventas', venta)).body
    expect((await p.pedir<Venta[]>(admin, 'GET', '/ventas')).body.map((x) => x.id)).toContain(v.id)
    expect((await p.pedir(admin, 'POST', `/ventas/${v.id}/anular`, { motivo: 'Mal cobrada' })).status).toBe(200)
    expect((await p.pedir(await p.entrar('supervisor'), 'GET', '/ventas')).status).toBe(403)
  })

  it('anular una venta (caja abierta) devuelve el stock y anula su factura', async () => {
    const e = await escenario()
    const { p, admin, cajero, gaseosa } = e
    await cargarGaseosas(e, 10)
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v = (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: gaseosa.id, cantidad: 4 }], medio: 'tarjeta' })).body
    await p.pedir(cajero, 'POST', `/ventas/${v.id}/factura`)
    expect((await p.pedir(cajero, 'POST', `/ventas/${v.id}/anular`, {})).status).toBe(400)
    const a = await p.pedir<Venta>(cajero, 'POST', `/ventas/${v.id}/anular`, { motivo: 'Se arrepintió' })
    expect(a.body).toMatchObject({ anulada: true, motivoAnulacion: 'Se arrepintió' })
    expect(a.body.factura?.anulada).toBe(true)
    expect(await stockDe(p, admin, 'cocina', gaseosa.id)).toBe(10)
    expect((await p.pedir<Caja>(cajero, 'GET', '/caja')).body.totalVentas).toBe(0)
    expect((await p.pedir(cajero, 'POST', `/ventas/${v.id}/factura`)).status).toBe(409)
  })
})

describe('factura preimpresa', () => {
  it('numera desde el número inicial, reimprime con el mismo número; el formato lo configura el admin', async () => {
    const { p, admin, cajero } = await escenario()
    const cfg = await p.pedir<ConfigFactura>(admin, 'PUT', '/factura/config', { timbrado: '12345678', prefijo: '001-002', numeroInicial: 150, margenSuperior: 2.5 })
    expect(cfg.body).toMatchObject({ timbrado: '12345678', prefijo: '001-002', numeroInicial: 150, margenSuperior: 2.5 })
    expect((await p.pedir(cajero, 'PUT', '/factura/config', { numeroInicial: 1 })).status).toBe(403)
    expect((await p.pedir(admin, 'PUT', '/factura/config', { prefijo: '1-1' })).status).toBe(400)
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v1 = (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' })).body
    const v2 = (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 2 }], medio: 'efectivo' })).body
    const f1 = await p.pedir<{ venta: Venta; config: ConfigFactura }>(cajero, 'POST', `/ventas/${v1.id}/factura`)
    expect(f1.body.venta.factura).toMatchObject({ numeroCompleto: '001-002-0000150', timbrado: '12345678', impresiones: 1 })
    expect(f1.body.config.margenSuperior).toBe(2.5)
    const f2 = await p.pedir<{ venta: Venta }>(cajero, 'POST', `/ventas/${v2.id}/factura`)
    expect(f2.body.venta.factura?.numeroCompleto).toBe('001-002-0000151')
    const otra = await p.pedir<{ venta: Venta }>(cajero, 'POST', `/ventas/${v1.id}/factura`)
    expect(otra.body.venta.factura).toMatchObject({ numeroCompleto: '001-002-0000150', impresiones: 2 })
  })
})

describe('hoja de factura de Chipa Tía', () => {
  it('viene con el timbrado y la numeración del talonario; guarda la dirección y el código de cada producto', async () => {
    const { p, admin, cajero } = await escenario()
    const cfg = (await p.pedir<ConfigFactura>(cajero, 'GET', '/factura/config')).body
    expect(cfg).toMatchObject({ timbrado: '18980642', prefijo: '001-002', numeroInicial: 1775, numeroFinal: 2000, anchoHoja: 210, altoHoja: 297 })
    expect(cfg.duplicado).toEqual({ x: 0, y: 148.5 })
    await p.pedir(admin, 'PATCH', `/productos/${CHIPA}`, { codigo: 'CH01' })
    await p.pedir(admin, 'PUT', '/factura/config', { numeroInicial: 1775 })
    expect((await p.pedir<{ numeroCompleto: string }>(admin, 'GET', '/factura/proxima')).body.numeroCompleto).toBe('001-002-0001775')
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v = (await p.pedir<Venta>(cajero, 'POST', '/ventas', {
      items: [{ productoId: CHIPA, cantidad: 2 }], medio: 'efectivo', clienteNombre: 'Juan', clienteRuc: '1234567', clienteDireccion: 'Ruta 1',
    })).body
    expect(v.clienteDireccion).toBe('Ruta 1')
    expect(v.items[0].codigo).toBe('CH01')
    const f = await p.pedir<{ venta: Venta }>(cajero, 'POST', `/ventas/${v.id}/factura`)
    expect(f.body.venta.factura).toMatchObject({ numeroCompleto: '001-002-0001775', timbrado: '18980642' })
  })

  it('no factura con el talonario agotado ni con el timbrado vencido', async () => {
    const { p, admin, cajero } = await escenario()
    await p.pedir(admin, 'PUT', '/factura/config', { numeroInicial: 2000 })
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const vender = async () => (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' })).body
    const v1 = await vender()
    expect((await p.pedir<{ venta: Venta }>(cajero, 'POST', `/ventas/${v1.id}/factura`)).body.venta.factura?.numeroCompleto).toBe('001-002-0002000')
    const v2 = await vender()
    const agotado = await p.pedir<{ error: { codigo: string } }>(cajero, 'POST', `/ventas/${v2.id}/factura`)
    expect(agotado.status).toBe(409)
    expect(agotado.body.error.codigo).toBe('talonario_agotado')
    await p.pedir(admin, 'PUT', '/factura/config', { numeroFinal: 0, venceTimbrado: sumarDias(diaPY(), -1) })
    const vencido = await p.pedir<{ error: { codigo: string } }>(cajero, 'POST', `/ventas/${v2.id}/factura`)
    expect(vencido.body.error.codigo).toBe('timbrado_vencido')
    expect((await p.pedir(admin, 'PUT', '/factura/config', { venceTimbrado: '31/07/2027' })).status).toBe(400)
  })

  it('el formato viejo (genérico) se cambia por el de la hoja nueva, pero respeta la numeración cargada', async () => {
    const { p, cajero } = await escenario()
    await p.sql("INSERT INTO configuracion (clave, valor) VALUES ('factura', ?)", JSON.stringify({ timbrado: '111', prefijo: '001-001', numeroInicial: 40, anchoHoja: 210, altoHoja: 148 }))
    expect((await p.pedir<ConfigFactura>(cajero, 'GET', '/factura/config')).body).toMatchObject({ timbrado: '111', prefijo: '001-001', numeroInicial: 40, anchoHoja: 210, altoHoja: 297, version: 3 })
  })
})

describe('renglones e IVA de la factura', async () => {
  const { columnasIva, fechaFactura, renglonesFactura } = await import('../src/shared/factura')
  const { miles } = await import('../src/shared/dinero')
  const item = (n: number, iva: 0 | 5 | 10, subtotal = 1000) => ({ productoId: `p${n}`, codigo: `C${n}`, nombre: `Producto ${n}`, cantidad: 1, precioUnitario: subtotal, subtotal, iva })
  const venta = (items: ReturnType<typeof item>[], descuento = 0) => {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    return { items, descuento, subtotal, total: subtotal - descuento } as unknown as Venta
  }

  it('liquida el IVA incluido y reparte el descuento sin dejar columnas negativas', () => {
    const v = venta([item(1, 10, 22_000), item(2, 5, 21_000)], 1000)
    const c = columnasIva(v)
    expect(c.neto[10] + c.neto[5]).toBe(42_000)
    expect(c.iva10).toBe(Math.round(c.neto[10] / 11))
    expect(c.iva5).toBe(Math.round(c.neto[5] / 21))
    expect(c.totalIva).toBe(c.iva5 + c.iva10)
    const solo5 = columnasIva(venta([item(1, 5, 10_001)], 3))
    expect(solo5.desc).toEqual({ 0: 0, 5: 3, 10: 0 })
  })

  it('si no entran todos los productos, junta los últimos en «Varios» por tasa de IVA', () => {
    const items = [...Array.from({ length: 12 }, (_, n) => item(n, 10)), item(20, 5), item(21, 0)]
    const r = renglonesFactura(venta(items), 10, miles)
    expect(r).toHaveLength(10)
    expect(r.filter((x) => x.descripcion.startsWith('Varios')).map((x) => x.iva)).toEqual([0, 5, 10])
    expect(r.reduce((s, x) => s + x.importe, 0)).toBe(14_000)
    const conDescuento = renglonesFactura(venta(items.slice(0, 3), 500), 10, miles)
    expect(conDescuento.at(-1)).toMatchObject({ descripcion: 'Descuento', importe: -500 })
    expect(fechaFactura('2026-11-21')).toBe('21 de noviembre de 2026')
  })
})

describe('ingresos y egresos, gastos fijos y sueldos', () => {
  it('suma solas las ventas y los pagos a proveedores; lo manual y los sueldos se cargan una vez', async () => {
    const { p, admin, cajero } = await escenario()
    const hoy = diaPY()
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 10_000 })
    await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 10 }], medio: 'efectivo' })
    await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 4 }], medio: 'transferencia' })
    // Pago a proveedor que sale de la caja: aparece como retiro de la caja y como egreso, sin cargarlo dos veces.
    const sup = await p.entrar('supervisor')
    const prov = (await p.pedir<Proveedor>(sup, 'POST', '/proveedores', { nombre: 'Molinos' })).body
    await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { tipo: 'materia_prima' })
    const compra = (await p.pedir<Compra>(sup, 'POST', '/compras', { proveedorId: prov.id, items: [{ productoId: COCIDO, cantidad: 5, precioUnitario: 2000 }] })).body
    const pagada = await p.pedir<Compra>(sup, 'POST', `/compras/${compra.id}/pagos`, { importe: 6000, medio: 'efectivo', desdeCaja: true })
    expect(pagada.status).toBe(200)
    // Gasto de luz pagado con efectivo de la caja.
    expect((await p.pedir(admin, 'POST', '/ie', { tipo: 'egreso', concepto: 'Luz', categoria: 'Servicios (luz, agua, internet)', importe: 3000, medio: 'efectivo', desdeCaja: true })).status).toBe(200)
    expect((await p.pedir(admin, 'POST', '/ie', { tipo: 'ingreso', concepto: 'Aporte', categoria: 'Aporte de socios', importe: 100_000, medio: 'transferencia' })).status).toBe(200)
    let caja = (await p.pedir<Caja>(cajero, 'GET', '/caja')).body
    // 10.000 + 30.000 − 6.000 − 3.000
    expect(caja.esperadoEfectivo).toBe(31_000)
    expect(caja.movimientos!.map((m) => m.origen).sort()).toEqual(['ie', 'proveedor'])
    // Un movimiento automático no se anula desde la caja.
    const auto = caja.movimientos!.find((m) => m.origen === 'proveedor')!
    expect((await p.pedir(cajero, 'POST', `/caja/movimientos/${auto.id}/anular`)).status).toBe(409)

    // Sueldo: gasto fijo que define el admin; se paga una vez por mes.
    const sueldo = (await p.pedir<GastoFijo>(admin, 'POST', '/gastos-fijos', { nombre: 'Sueldo de Ana', importe: 2_500_000, diaDelMes: 1, esSueldo: true })).body
    expect(sueldo).toMatchObject({ categoria: 'Sueldos', esSueldo: true })
    expect((await p.pedir(cajero, 'POST', '/gastos-fijos', { nombre: 'x', importe: 1 })).status).toBe(403)
    expect((await p.pedir(sup, 'PATCH', `/gastos-fijos/${sueldo.id}`, { importe: 1 })).status).toBe(403)
    const mes = hoy.slice(0, 7)
    const pago = await p.pedir<GastoFijoMes[]>(admin, 'POST', `/gastos-fijos/${sueldo.id}/pagar`, { periodo: mes, medio: 'transferencia' })
    expect(pago.body[0]).toMatchObject({ pagado: true, importePagado: 2_500_000 })
    expect((await p.pedir(admin, 'POST', `/gastos-fijos/${sueldo.id}/pagar`, { periodo: mes, medio: 'transferencia' })).status).toBe(409)

    const ie = (await p.pedir<ResumenIE>(admin, 'GET', `/ie?desde=${hoy}&hasta=${hoy}`)).body
    // Ingresos: ventas 42.000 + aporte 100.000. Egresos: proveedor 6.000 + luz 3.000 + sueldo 2.500.000.
    expect(ie).toMatchObject({ ingresos: 142_000, egresos: 2_509_000, resultado: 142_000 - 2_509_000, soloProveedores: false })
    expect(ie.porCategoria).toEqual(expect.arrayContaining([
      { tipo: 'ingreso', categoria: 'Ventas', importe: 42_000 },
      { tipo: 'egreso', categoria: 'Sueldos', importe: 2_500_000 },
      { tipo: 'egreso', categoria: 'Pagos a proveedores', importe: 6000 },
    ]))
    // El supervisor solo ve los egresos por pagos a proveedores; el cajero y los sectores, nada.
    const delSup = (await p.pedir<ResumenIE>(sup, 'GET', '/ie')).body
    expect(delSup).toMatchObject({ soloProveedores: true, ingresos: 0, egresos: 6000 })
    expect(delSup.movimientos.every((m) => m.origen === 'proveedor')).toBe(true)
    expect((await p.pedir(cajero, 'GET', '/ie')).status).toBe(403)
    expect((await p.pedir(await p.entrar('cocina'), 'GET', '/ie')).status).toBe(403)

    // Anular el gasto de luz devuelve el efectivo a lo esperado en la caja; anular el pago al proveedor, también.
    const luz = ie.movimientos.find((m) => m.concepto === 'Luz')!
    expect((await p.pedir(admin, 'POST', `/ie/${luz.id}/anular`, { motivo: 'Mal cargado' })).status).toBe(200)
    await p.pedir(sup, 'POST', `/pagos-proveedor/${pagada.body.pagos![0].id}/anular`, { motivo: 'Error' })
    caja = (await p.pedir<Caja>(cajero, 'GET', '/caja')).body
    expect(caja.esperadoEfectivo).toBe(40_000)
  })

  it('un gasto desde la caja necesita la caja abierta', async () => {
    const { p, admin } = await escenario()
    const r = await p.pedir(admin, 'POST', '/ie', { tipo: 'egreso', concepto: 'Gas', categoria: 'Otros gastos', importe: 1000, medio: 'efectivo', desdeCaja: true })
    expect(r.status).toBe(409)
  })
})

describe('reporte detallado y avisos', () => {
  it('suma ventas, cajas con diferencias, I/E, sueldos y compras; solo para el admin', async () => {
    const { p, admin, cajero } = await escenario()
    const hoy = diaPY()
    await p.pedir(admin, 'POST', '/gastos-fijos', { nombre: 'Sueldo de Ana', importe: 2_000_000, esSueldo: true, diaDelMes: 28 })
    const alquiler = (await p.pedir<GastoFijo>(admin, 'POST', '/gastos-fijos', { nombre: 'Alquiler', categoria: 'Alquiler', importe: 1_000_000, diaDelMes: 5 })).body
    await p.pedir(admin, 'POST', `/gastos-fijos/${alquiler.id}/pagar`, { medio: 'transferencia' })
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const v = (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 10 }], medio: 'efectivo', descuento: 1000 })).body
    await p.pedir(cajero, 'POST', '/ventas', { items: [{ productoId: COCIDO, cantidad: 1 }], medio: 'tarjeta' })
    await p.pedir(cajero, 'POST', `/ventas/${v.id}/factura`)
    const anulada = (await p.pedir<Venta>(cajero, 'POST', '/ventas', { items: [{ productoId: CHIPA, cantidad: 1 }], medio: 'efectivo' })).body
    await p.pedir(cajero, 'POST', `/ventas/${anulada.id}/anular`, { motivo: 'x' })
    await p.pedir(cajero, 'POST', '/caja/cerrar', { contado: 28_000 })
    const r = await p.pedir<ReporteDetallado>(admin, 'GET', `/reportes/detallado?desde=${hoy}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    expect(r.body.ventas).toMatchObject({ cantidad: 2, bruto: 35_000, descuentos: 1000, total: 34_000, anuladas: 1, ticketPromedio: 17_000, facturas: 1 })
    expect(r.body.ventas.porMedio).toEqual([{ medio: 'efectivo', cantidad: 1, importe: 29_000 }, { medio: 'tarjeta', cantidad: 1, importe: 5000 }])
    expect(r.body.ventas.porProducto[0]).toMatchObject({ productoId: CHIPA, cantidad: 10, importe: 30_000 })
    expect(r.body.cajas).toHaveLength(1)
    expect(r.body.diferenciasCaja).toBe(-1000)
    expect(r.body.sueldos).toMatchObject({ pagados: 0, pendientes: 2_000_000 })
    expect(r.body.gastosFijos).toMatchObject({ pagados: 1_000_000, pendientes: 0 })
    expect(r.body.ie).toMatchObject({ ingresos: 34_000, egresos: 1_000_000 })
    expect((await p.pedir(await p.entrar('supervisor'), 'GET', '/reportes/detallado')).status).toBe(403)
    expect((await p.pedir(cajero, 'GET', '/reportes/detallado')).status).toBe(403)
    expect((await p.pedir(cajero, 'GET', '/cajas')).status).toBe(403)
    expect((await p.pedir<Caja[]>(admin, 'GET', '/cajas')).body).toHaveLength(1)
  })

  it('avisa de la caja abierta de un día anterior y de gastos fijos vencidos sin pagar', async () => {
    const { p, admin, cajero } = await escenario()
    await p.pedir(cajero, 'POST', '/caja/abrir', { fondoInicial: 0 })
    await p.sql('UPDATE cajas SET dia = ?', sumarDias(diaPY(), -1))
    await p.pedir(admin, 'POST', '/gastos-fijos', { nombre: 'Internet', categoria: 'Servicios', importe: 200_000, diaDelMes: 1 })
    const delAdmin = (await p.pedir<Alerta[]>(admin, 'GET', '/alertas')).body.map((a) => a.tipo)
    // Vence el día 1: siempre ya venció en el mes actual.
    expect(delAdmin).toEqual(expect.arrayContaining(['caja_sin_cerrar', 'gasto_fijo_pendiente']))
    const delCajero = (await p.pedir<Alerta[]>(cajero, 'GET', '/alertas')).body.map((a) => a.tipo)
    expect(delCajero).toEqual(['caja_sin_cerrar'])
  })
})

describe('total en letras de la factura', async () => {
  const { enLetras, gs } = await import('../src/shared/dinero')
  it('escribe números en castellano', () => {
    expect(enLetras(0)).toBe('cero')
    expect(enLetras(100)).toBe('cien')
    expect(enLetras(121)).toBe('ciento veintiuno')
    expect(enLetras(21_000)).toBe('veintiún mil')
    expect(enLetras(125_300)).toBe('ciento veinticinco mil trescientos')
    expect(enLetras(1_001_001)).toBe('un millón mil uno')
    expect(enLetras(31_500_045)).toBe('treinta y un millones quinientos mil cuarenta y cinco')
    expect(gs(1234567)).toBe('Gs. 1.234.567')
  })
})
