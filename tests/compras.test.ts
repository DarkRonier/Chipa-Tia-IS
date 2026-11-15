// Etapa 2 (M10): categorías, proveedores, compras que suman al stock, pagos parciales, saldos, anulaciones y reportes.
import { describe, expect, it } from 'vitest'
import type { Alerta } from '../src/shared/alertas'
import { sumarDias } from '../src/shared/hora'
import { diaPY } from '../src/shared/hora'
import { puede } from '../src/shared/permisos'
import type {
  Categoria, Compra, CuentaProveedor, Movimiento, Producto, ProductoCompra, Proveedor, ReporteCompras, StockFila,
} from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const COCIDO = 'prod-cocina-02'
const EMPANADA = 'prod-cocina-10'
const PAN = 'prod-panaderia-01'

interface Escenario {
  p: Prueba
  admin: string
  sup: string
  cocina: string
  panaderia: string
  bebidas: Categoria
  insumos: Categoria
  gaseosa: Producto
  proveedor: Proveedor
}

/** Bebidas habilitada para Cocina; Insumos sin sectores. Gaseosa (Cocina, Bebidas) y Harina (Panadería, Insumos). */
async function escenario(): Promise<Escenario> {
  const p = await nuevaPrueba()
  const admin = await p.entrar('admin')
  const bebidas = (await p.pedir<Categoria>(admin, 'POST', '/categorias', { nombre: 'Bebidas', sectores: ['cocina'] })).body
  const insumos = (await p.pedir<Categoria>(admin, 'POST', '/categorias', { nombre: 'Insumos', sectores: [] })).body
  const gaseosa = (await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Gaseosa 500 ml', categoriaId: bebidas.id })).body
  await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { categoriaId: insumos.id })
  const sup = await p.entrar('supervisor')
  const proveedor = (await p.pedir<Proveedor>(sup, 'POST', '/proveedores', { nombre: 'Distribuidora Sur', ruc: '80012345-6', telefono: '0981 123456' })).body
  return { p, admin, sup, cocina: await p.entrar('cocina'), panaderia: await p.entrar('panaderia'), bebidas, insumos, gaseosa, proveedor }
}

const stockDe = async (p: Prueba, token: string, sector: string, producto: string) =>
  (await p.pedir<StockFila[]>(token, 'GET', `/stock?sector=${sector}`)).body.find((f) => f.productoId === producto)

describe('permisos de compras', () => {
  it('sectores cargan compras pero no pagan ni gestionan proveedores; supervisor y admin hacen todo; el cajero nada', () => {
    for (const s of ['chiperia', 'chipitas', 'panaderia', 'cocina'] as const) {
      expect(puede(s, 'compras.registrar')).toBe(true)
      for (const x of ['compras.pagar', 'proveedores.gestionar', 'reportes.compras'] as const) expect(puede(s, x)).toBe(false)
    }
    for (const r of ['supervisor', 'admin'] as const) {
      for (const x of ['compras.registrar', 'compras.pagar', 'proveedores.gestionar', 'reportes.compras'] as const) expect(puede(r, x)).toBe(true)
    }
    for (const x of ['compras.registrar', 'compras.pagar', 'proveedores.gestionar'] as const) expect(puede('cajero', x)).toBe(false)
  })
})

describe('categorías', () => {
  it('el administrador las crea, elige sectores y las asigna a productos; el resto no las edita', async () => {
    const { p, admin, sup, bebidas, gaseosa } = await escenario()
    expect(bebidas.sectores).toEqual(['cocina'])
    expect(gaseosa.categoriaId).toBe(bebidas.id)
    const r = await p.pedir<Categoria>(admin, 'PATCH', `/categorias/${bebidas.id}`, { sectores: ['panaderia', 'cocina'] })
    expect(r.body.sectores).toEqual(['panaderia', 'cocina'])
    expect((await p.pedir(admin, 'POST', '/categorias', { nombre: 'bebidas' })).status).toBe(409)
    expect((await p.pedir(sup, 'POST', '/categorias', { nombre: 'Otra' })).status).toBe(403)
    expect((await p.pedir(admin, 'PATCH', `/productos/${gaseosa.id}`, { categoriaId: 'no-existe' })).status).toBe(400)
    const sinCat = await p.pedir<Producto>(admin, 'PATCH', `/productos/${gaseosa.id}`, { categoriaId: null })
    expect(sinCat.body.categoriaId).toBeNull()
  })
})

describe('proveedores', () => {
  it('admin y supervisor los cargan y editan; los sectores solo los listan, sin saldo', async () => {
    const { p, admin, cocina, proveedor } = await escenario()
    expect(proveedor).toMatchObject({ nombre: 'Distribuidora Sur', ruc: '80012345-6', activo: true, saldo: 0 })
    expect((await p.pedir(admin, 'POST', '/proveedores', { nombre: 'distribuidora sur' })).status).toBe(409)
    expect((await p.pedir(cocina, 'POST', '/proveedores', { nombre: 'Otro' })).status).toBe(403)
    const lista = await p.pedir<Proveedor[]>(cocina, 'GET', '/proveedores')
    expect(lista.status).toBe(200)
    expect(lista.body[0]).toMatchObject({ nombre: 'Distribuidora Sur', saldo: null })
    const cajero = await p.entrar('cajero')
    expect((await p.pedir(cajero, 'GET', '/proveedores')).status).toBe(403)
    const off = await p.pedir<Proveedor>(admin, 'PATCH', `/proveedores/${proveedor.id}`, { activo: false })
    expect(off.body.activo).toBe(false)
    expect((await p.pedir<Proveedor[]>(cocina, 'GET', '/proveedores')).body).toHaveLength(0)
    expect((await p.pedir<Proveedor[]>(admin, 'GET', '/proveedores?todos=1')).body).toHaveLength(1)
  })
})

describe('compras de un sector', () => {
  it('Cocina compra gaseosas (Bebidas habilitada): suma al stock de Cocina y queda pendiente', async () => {
    const { p, cocina, gaseosa, proveedor } = await escenario()
    const productos = await p.pedir<ProductoCompra[]>(cocina, 'GET', '/compras/productos')
    expect(productos.body.map((x) => x.id)).toEqual([gaseosa.id])
    const r = await p.pedir<Compra>(cocina, 'POST', '/compras', {
      proveedorId: proveedor.id, comprobante: '001-001-0000123', items: [{ productoId: gaseosa.id, cantidad: 24, precioUnitario: 5000 }],
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sector: 'cocina', total: 120_000, pagado: 0, saldo: 120_000, estado: 'pendiente' })
    expect(r.body.pagos).toBeUndefined()
    expect((await stockDe(p, cocina, 'cocina', gaseosa.id))?.total).toBe(24)
    const movs = await p.pedir<Movimiento[]>(cocina, 'GET', '/movimientos?tipo=compra')
    expect(movs.body).toHaveLength(1)
    expect(movs.body[0]).toMatchObject({ tipo: 'compra', cantidad: 24, productoId: gaseosa.id })
  })

  it('no puede comprar de categorías no habilitadas, de otro sector, sin categoría ni texto libre, ni marcar pagos', async () => {
    const { p, cocina, panaderia, gaseosa, proveedor } = await escenario()
    const base = { proveedorId: proveedor.id }
    const item = (productoId: string) => ({ ...base, items: [{ productoId, cantidad: 1, precioUnitario: 100 }] })
    const cocido = await p.pedir(cocina, 'POST', '/compras', item(COCIDO))
    expect(cocido.status).toBe(403)
    expect(cocido.body.error.mensaje).toContain('Insumos')
    expect((await p.pedir(cocina, 'POST', '/compras', item(EMPANADA))).status).toBe(403)
    expect((await p.pedir(panaderia, 'POST', '/compras', item(gaseosa.id))).status).toBe(403)
    expect((await p.pedir(panaderia, 'POST', '/compras', item(PAN))).status).toBe(403)
    expect((await p.pedir(cocina, 'POST', '/compras', { ...base, items: [{ detalle: 'Flete', precioUnitario: 1000 }] })).status).toBe(400)
    const conPago = await p.pedir(cocina, 'POST', '/compras', { ...item(gaseosa.id), pago: { importe: 100, medio: 'efectivo' } })
    expect(conPago.status).toBe(400)
    const compra = (await p.pedir<Compra>(cocina, 'POST', '/compras', item(gaseosa.id))).body
    expect((await p.pedir(cocina, 'POST', `/compras/${compra.id}/pagos`, { importe: 100, medio: 'efectivo' })).status).toBe(403)
    expect((await p.pedir(cocina, 'POST', `/compras/${compra.id}/anular`, { motivo: 'x' })).status).toBe(403)
    // Panadería no ve las compras de Cocina.
    expect((await p.pedir<Compra[]>(panaderia, 'GET', '/compras')).body).toHaveLength(0)
    expect((await p.pedir(panaderia, 'GET', `/compras/${compra.id}`)).status).toBe(404)
    expect((await p.pedir(panaderia, 'GET', '/compras?sector=cocina')).status).toBe(403)
  })

  it('valida fecha, vencimiento, cantidades enteras y renglones repetidos', async () => {
    const { p, cocina, gaseosa, proveedor } = await escenario()
    const hoy = diaPY()
    const pedir = (extra: object) => p.pedir(cocina, 'POST', '/compras', {
      proveedorId: proveedor.id, items: [{ productoId: gaseosa.id, cantidad: 2, precioUnitario: 100 }], ...extra,
    })
    expect((await pedir({ diaCompra: sumarDias(hoy, 1) })).status).toBe(400)
    expect((await pedir({ vencimiento: sumarDias(hoy, -1) })).status).toBe(400)
    expect((await pedir({ items: [{ productoId: gaseosa.id, cantidad: 1.5, precioUnitario: 100 }] })).status).toBe(400)
    expect((await pedir({ items: [{ productoId: gaseosa.id, cantidad: 1, precioUnitario: 1.5 }] })).status).toBe(400)
    expect((await pedir({ items: [] })).status).toBe(400)
    expect((await pedir({ items: [{ productoId: gaseosa.id, cantidad: 1, precioUnitario: 0 }] })).status).toBe(400)
    const repetido = { productoId: gaseosa.id, cantidad: 1, precioUnitario: 100 }
    expect((await pedir({ items: [repetido, repetido] })).status).toBe(400)
    expect((await pedir({ proveedorId: 'no-existe' })).status).toBe(400)
  })
})

describe('compras del supervisor, pagos parciales y saldos', () => {
  it('compra cualquier producto y texto libre; paga en partes hasta saldar; el saldo del proveedor acompaña', async () => {
    const { p, sup, cocina, gaseosa, proveedor } = await escenario()
    const hoy = diaPY()
    const r = await p.pedir<Compra>(sup, 'POST', '/compras', {
      proveedorId: proveedor.id, comprobante: 'F-77', vencimiento: sumarDias(hoy, 10),
      items: [
        { productoId: COCIDO, cantidad: 10, precioUnitario: 3000 },
        { productoId: gaseosa.id, cantidad: 12, precioUnitario: 5000 },
        { detalle: 'Flete', precioUnitario: 10_000 },
      ],
    })
    expect(r.status).toBe(200)
    const compra = r.body
    expect(compra).toMatchObject({ sector: null, total: 100_000, estado: 'pendiente', pagos: [] })
    expect(compra.items.map((i) => i.subtotal)).toEqual([30_000, 60_000, 10_000])
    // Stock en Cocina: cocido (sin stock obligatorio) y gaseosa. El flete no toca el stock.
    expect((await stockDe(p, sup, 'cocina', COCIDO))?.total).toBe(10)
    expect((await stockDe(p, sup, 'cocina', gaseosa.id))?.total).toBe(12)

    const pago1 = await p.pedir<Compra>(sup, 'POST', `/compras/${compra.id}/pagos`, { importe: 40_000, medio: 'efectivo' })
    expect(pago1.body).toMatchObject({ pagado: 40_000, saldo: 60_000, estado: 'parcial' })
    expect((await p.pedir(sup, 'POST', `/compras/${compra.id}/pagos`, { importe: 60_001, medio: 'efectivo' })).status).toBe(400)
    expect((await p.pedir(sup, 'POST', `/compras/${compra.id}/pagos`, { importe: 100, medio: 'trueque' })).status).toBe(400)
    let prov = (await p.pedir<Proveedor[]>(sup, 'GET', '/proveedores')).body[0]
    expect(prov.saldo).toBe(60_000)

    const pago2 = await p.pedir<Compra>(sup, 'POST', `/compras/${compra.id}/pagos`, { total: true, medio: 'transferencia' })
    expect(pago2.body).toMatchObject({ pagado: 100_000, saldo: 0, estado: 'pagada' })
    expect(pago2.body.pagos).toHaveLength(2)
    expect((await p.pedir(sup, 'POST', `/compras/${compra.id}/pagos`, { importe: 1, medio: 'efectivo' })).status).toBe(409)
    prov = (await p.pedir<Proveedor[]>(sup, 'GET', '/proveedores')).body[0]
    expect(prov.saldo).toBe(0)

    // El sector que no cargó la compra no la ve; la cuenta del proveedor muestra compra y pagos con el saldo.
    expect((await p.pedir<Compra[]>(cocina, 'GET', '/compras')).body).toHaveLength(0)
    const cuenta = await p.pedir<CuentaProveedor>(sup, 'GET', `/proveedores/${proveedor.id}/cuenta`)
    expect(cuenta.body).toMatchObject({ totalComprado: 100_000, totalPagado: 100_000, saldo: 0 })
    expect(cuenta.body.movimientos.map((m) => [m.tipo, m.saldo])).toEqual([['compra', 100_000], ['pago', 60_000], ['pago', 0]])
    expect((await p.pedir(cocina, 'GET', `/proveedores/${proveedor.id}/cuenta`)).status).toBe(403)
  })

  it('la compra se carga siempre pendiente: no se puede marcar pagada al crearla', async () => {
    const { p, admin, proveedor } = await escenario()
    const base = { proveedorId: proveedor.id, items: [{ productoId: COCIDO, cantidad: 1, precioUnitario: 5000 }] }
    const r = await p.pedir(admin, 'POST', '/compras', { ...base, pago: { importe: 5000, medio: 'efectivo' } })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toContain('Pendientes de pago')
    expect((await p.pedir<Compra>(admin, 'POST', '/compras', base)).body).toMatchObject({ estado: 'pendiente', saldo: 5000 })
  })

  it('proveedor y comprobante son opcionales: sin proveedor queda «Sin nombre», que no se lista ni se edita', async () => {
    const { p, sup, cocina, gaseosa } = await escenario()
    const c = await p.pedir<Compra>(cocina, 'POST', '/compras', { items: [{ productoId: gaseosa.id, cantidad: 30, precioUnitario: 1000 }] })
    expect(c.status).toBe(200)
    expect(c.body).toMatchObject({ proveedorId: 'prov-sin-nombre', proveedorNombre: 'Sin nombre', comprobante: '', estado: 'pendiente' })
    const pendientes = (await p.pedir<Compra[]>(sup, 'GET', '/compras?estado=pendiente,parcial')).body
    expect(pendientes.map((x) => x.id)).toContain(c.body.id)
    const pagada = await p.pedir<Compra>(sup, 'POST', `/compras/${c.body.id}/pagos`, { total: true, medio: 'efectivo' })
    expect(pagada.body.estado).toBe('pagada')
    const lista = (await p.pedir<Proveedor[]>(sup, 'GET', '/proveedores?todos=1')).body
    expect(lista.map((x) => x.nombre)).not.toContain('Sin nombre')
    expect((await p.pedir(sup, 'PATCH', '/proveedores/prov-sin-nombre', { nombre: 'Otro' })).status).toBe(400)
  })

  it('el código del producto se guarda, se edita y sale en los productos para comprar', async () => {
    const { p, admin, cocina, gaseosa } = await escenario()
    expect(gaseosa.codigo).toBe('')
    const editado = await p.pedir<Producto>(admin, 'PATCH', `/productos/${gaseosa.id}`, { codigo: 'BEB-500' })
    expect(editado.body.codigo).toBe('BEB-500')
    const nuevo = await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Agua 500 ml', codigo: 'BEB-501' })
    expect(nuevo.body.codigo).toBe('BEB-501')
    const lista = (await p.pedir<ProductoCompra[]>(cocina, 'GET', '/compras/productos')).body
    expect(lista.find((x) => x.id === gaseosa.id)?.codigo).toBe('BEB-500')
  })

  it('el trigger frena un pago que supera el saldo aunque se salte la API', async () => {
    const { p, sup, proveedor } = await escenario()
    const c = (await p.pedir<Compra>(sup, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ productoId: COCIDO, cantidad: 1, precioUnitario: 1000 }] })).body
    await expect(p.sql(
      `INSERT INTO pagos_proveedor (id, compra_id, proveedor_id, dia_pago, importe, medio, usuario_id, fecha, dia)
       VALUES ('x', ?, ?, '2026-01-01', 1001, 'efectivo', 'usr-admin', '2026-01-01', '2026-01-01')`, c.id, proveedor.id,
    )).rejects.toThrow(/PAGO_EXCEDE_SALDO/)
  })
})

describe('anulaciones', () => {
  it('un pago anulado vuelve a ser saldo; la compra sin pagos se anula y su stock se descuenta', async () => {
    const { p, sup, gaseosa, proveedor } = await escenario()
    const c = (await p.pedir<Compra>(sup, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ productoId: gaseosa.id, cantidad: 6, precioUnitario: 5000 }] })).body
    const pagada = (await p.pedir<Compra>(sup, 'POST', `/compras/${c.id}/pagos`, { importe: 10_000, medio: 'efectivo' })).body
    expect((await p.pedir(sup, 'POST', `/compras/${c.id}/anular`, { motivo: 'Error' })).status).toBe(409)
    const sinPago = await p.pedir<Compra>(sup, 'POST', `/pagos-proveedor/${pagada.pagos![0].id}/anular`, { motivo: 'Mal cargado' })
    expect(sinPago.body).toMatchObject({ pagado: 0, saldo: 30_000, estado: 'pendiente' })
    expect(sinPago.body.pagos![0]).toMatchObject({ anulado: true, motivoAnulacion: 'Mal cargado' })
    expect((await p.pedir(sup, 'POST', `/compras/${c.id}/anular`, {})).status).toBe(400)
    const anulada = await p.pedir<Compra>(sup, 'POST', `/compras/${c.id}/anular`, { motivo: 'Compra duplicada' })
    expect(anulada.body).toMatchObject({ estado: 'anulada', saldo: 0, motivoAnulacion: 'Compra duplicada' })
    expect((await stockDe(p, sup, 'cocina', gaseosa.id))?.total).toBe(0)
    expect((await p.pedir(sup, 'POST', `/compras/${c.id}/pagos`, { importe: 1, medio: 'efectivo' })).status).toBe(409)
    expect((await p.pedir<Proveedor[]>(sup, 'GET', '/proveedores')).body[0].saldo).toBe(0)
  })

  it('no se anula si el stock obligatorio ya se usó', async () => {
    const { p, sup, cocina, gaseosa, proveedor } = await escenario()
    const c = (await p.pedir<Compra>(sup, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ productoId: gaseosa.id, cantidad: 6, precioUnitario: 5000 }] })).body
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: gaseosa.id, cantidad: 2 })).status).toBe(200)
    const r = await p.pedir(sup, 'POST', `/compras/${c.id}/anular`, { motivo: 'x' })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('stock_insuficiente')
    expect((await stockDe(p, sup, 'cocina', gaseosa.id))?.total).toBe(4)
  })
})

describe('avisos y reporte de compras', () => {
  it('avisa de compras por vencer y vencidas al supervisor y al admin, no a los sectores', async () => {
    const { p, sup, admin, cocina, gaseosa, proveedor } = await escenario()
    const hoy = diaPY()
    await p.pedir(sup, 'POST', '/compras', {
      proveedorId: proveedor.id, comprobante: 'A-1', vencimiento: sumarDias(hoy, 2), items: [{ productoId: gaseosa.id, cantidad: 1, precioUnitario: 1000 }],
    })
    const vieja = (await p.pedir<Compra>(sup, 'POST', '/compras', {
      proveedorId: proveedor.id, comprobante: 'A-0', diaCompra: sumarDias(hoy, -20), vencimiento: sumarDias(hoy, -5),
      items: [{ productoId: COCIDO, cantidad: 1, precioUnitario: 2000 }],
    })).body
    expect(vieja.vencida).toBe(true)
    const avisos = (await p.pedir<Alerta[]>(admin, 'GET', '/alertas')).body.filter((a) => a.tipo.startsWith('compra'))
    expect(avisos.map((a) => a.tipo)).toEqual(['compra_vencida', 'compra_por_vencer'])
    expect(avisos[0].texto).toContain('A-0')
    expect((await p.pedir<Alerta[]>(sup, 'GET', '/alertas')).body.some((a) => a.tipo === 'compra_vencida')).toBe(true)
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/alertas')).body.some((a) => a.tipo.startsWith('compra'))).toBe(false)
  })

  it('suma compras, pagos, deuda y categorías del período; lo ven supervisor y admin', async () => {
    const { p, sup, admin, cocina, gaseosa, proveedor, bebidas } = await escenario()
    const hoy = diaPY()
    const c1 = (await p.pedir<Compra>(cocina, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ productoId: gaseosa.id, cantidad: 10, precioUnitario: 5000 }] })).body
    await p.pedir(sup, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ detalle: 'Flete', precioUnitario: 20_000 }] })
    const anulada = (await p.pedir<Compra>(sup, 'POST', '/compras', { proveedorId: proveedor.id, items: [{ productoId: COCIDO, cantidad: 1, precioUnitario: 999 }] })).body
    await p.pedir(sup, 'POST', `/compras/${anulada.id}/anular`, { motivo: 'x' })
    await p.pedir(sup, 'POST', `/compras/${c1.id}/pagos`, { importe: 30_000, medio: 'transferencia' })
    const r = await p.pedir<ReporteCompras>(sup, 'GET', `/reportes/compras?desde=${hoy}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      cantidadCompras: 2, totalComprado: 70_000, totalPagado: 30_000, pendientePeriodo: 40_000, deudaTotal: 40_000, deudaVencida: 0,
    })
    expect(r.body.porProveedor).toEqual([{ proveedorId: proveedor.id, proveedorNombre: 'Distribuidora Sur', comprado: 70_000, pagado: 30_000, saldo: 40_000 }])
    expect(r.body.porCategoria.find((k) => k.categoriaId === bebidas.id)?.importe).toBe(50_000)
    expect(r.body.porMedio).toEqual([{ medio: 'transferencia', importe: 30_000 }])
    expect((await p.pedir(admin, 'GET', '/reportes/compras')).status).toBe(200)
    expect((await p.pedir(cocina, 'GET', '/reportes/compras')).status).toBe(403)
  })
})
