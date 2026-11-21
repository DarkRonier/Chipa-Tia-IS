// Rol Caja Comedor (Mati, 2026-11-21): vende y factura como el cajero, pero en su propia caja, y lo vendido sale de
// Venta comedor. Las dos cajas pueden estar abiertas a la vez; el administrador elige cuál mira con ?punto=.
import { describe, expect, it } from 'vitest'
import type { Alerta } from '../src/shared/alertas'
import { inicioDe, permisosDe, puede } from '../src/shared/permisos'
import type { Caja, Producto, ProductoVenta, StockFila, Usuario, Venta } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const stockDe = async (p: Prueba, token: string, producto: string, deposito: string) =>
  (await p.pedir<StockFila[]>(token, 'GET', '/stock?sector=cocina')).body.find((f) => f.productoId === producto)?.porDeposito[deposito] ?? 0

async function escenario() {
  const p = await nuevaPrueba()
  const admin = await p.entrar('admin')
  await p.pedir(admin, 'PATCH', '/productos/prod-chiperia-01', { precioVenta: 3000 })
  const gaseosa = (await p.pedir<Producto>(admin, 'POST', '/productos', {
    sector: 'cocina', nombre: 'Gaseosa 500 ml', precioVenta: 7000, tipo: 'reventa', categoriaId: 'cat-bebidas',
  })).body
  expect(gaseosa.categoriaId).toBe('cat-bebidas')
  for (const depositoId of ['venta', 'comedor']) {
    const r = await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', tipo: 'stock_inicial', productoId: gaseosa.id, cantidad: 10, motivo: 'Inicial', depositoId })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  }
  return { p, admin, gaseosa, cajero: await p.entrar('cajero'), comedor: await p.entrar('comedor') }
}

describe('rol Caja Comedor', () => {
  it('tiene los mismos permisos que el cajero y entra a la caja', async () => {
    expect(permisosDe('caja_comedor')).toEqual(permisosDe('cajero'))
    expect(puede('caja_comedor', 'compras.registrar')).toBe(false)
    expect(inicioDe('caja_comedor')).toBe('/caja')
    const p = await nuevaPrueba()
    const yo = (await p.pedir<Usuario>(await p.entrar('comedor'), 'GET', '/auth/yo')).body
    expect(yo.rol).toBe('caja_comedor')
    // El administrador puede crear más usuarios con este rol.
    const admin = await p.entrar('admin')
    const nuevo = await p.pedir<Usuario>(admin, 'POST', '/usuarios', { nombre: 'Comedor 2', usuario: 'comedor2', clave: 'clave1234', rol: 'caja_comedor' })
    expect(nuevo.status, JSON.stringify(nuevo.body)).toBe(200)
    expect(nuevo.body.rol).toBe('caja_comedor')
  })

  it('tiene su propia caja: las dos abren a la vez, y cada una vende de su depósito', async () => {
    const { p, admin, gaseosa, cajero, comedor } = await escenario()
    const frente = await p.pedir<Caja>(cajero, 'POST', '/caja/abrir', { fondoInicial: 50000 })
    expect(frente.body.punto).toBe('frente')
    const caja = await p.pedir<Caja>(comedor, 'POST', '/caja/abrir', { fondoInicial: 20000 })
    expect(caja.status, JSON.stringify(caja.body)).toBe(200)
    expect(caja.body.punto).toBe('comedor')
    expect((await p.pedir(comedor, 'POST', '/caja/abrir', { fondoInicial: 0 })).status).toBe(409)
    // El stock que ve cada caja es el de su depósito.
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', tipo: 'merma', productoId: gaseosa.id, cantidad: 3, motivo: 'Rotas', depositoId: 'comedor' })
    const ver = async (t: string) => (await p.pedir<ProductoVenta[]>(t, 'GET', '/ventas/productos')).body.find((x) => x.id === gaseosa.id)!.stock
    expect(await ver(cajero)).toBe(10)
    expect(await ver(comedor)).toBe(7)
    // El comedor vende solo lo que recibe Venta comedor (buffet y bebidas): la chipa no.
    const lista = (await p.pedir<ProductoVenta[]>(comedor, 'GET', '/ventas/productos')).body
    expect(lista.some((x) => x.id === 'prod-chiperia-01')).toBe(false)
    expect((await p.pedir<ProductoVenta[]>(cajero, 'GET', '/ventas/productos')).body.some((x) => x.id === 'prod-chiperia-01')).toBe(true)
    const chipa = await p.pedir(comedor, 'POST', '/ventas', { items: [{ productoId: 'prod-chiperia-01', cantidad: 1 }], medio: 'efectivo' })
    expect(chipa.status).toBe(400)
    expect(chipa.body.error.mensaje).toContain('La caja del comedor no vende Chipas y bocaditos')

    const venta = await p.pedir<Venta>(comedor, 'POST', '/ventas', { items: [{ productoId: gaseosa.id, cantidad: 2 }], medio: 'efectivo' })
    expect(venta.status, JSON.stringify(venta.body)).toBe(200)
    expect(venta.body.cajaId).toBe(caja.body.id)
    expect(await stockDe(p, admin, gaseosa.id, 'comedor')).toBe(5)
    expect(await stockDe(p, admin, gaseosa.id, 'venta')).toBe(10)
    // Factura igual que en el frente.
    expect((await p.pedir(comedor, 'POST', `/ventas/${venta.body.id}/factura`)).status).toBe(200)

    // Cada uno ve solo las ventas de su caja.
    expect((await p.pedir<Venta[]>(comedor, 'GET', '/ventas')).body.map((v) => v.id)).toEqual([venta.body.id])
    expect((await p.pedir<Venta[]>(cajero, 'GET', '/ventas')).body).toEqual([])
    expect((await p.pedir<Caja>(cajero, 'GET', '/caja')).body.totalVentas).toBe(0)
    expect((await p.pedir<Caja>(comedor, 'GET', '/caja')).body.totalVentas).toBe(14000)
    // El cajero no anula una venta del comedor; la caja del comedor sí.
    expect((await p.pedir(cajero, 'POST', `/ventas/${venta.body.id}/anular`, { motivo: 'x' })).status).toBe(403)
    expect((await p.pedir(comedor, 'POST', `/ventas/${venta.body.id}/anular`, { motivo: 'Error' })).status).toBe(200)
    expect(await stockDe(p, admin, gaseosa.id, 'comedor')).toBe(7)
  })

  it('el administrador mira y opera cada caja con ?punto=, y ve las dos en el historial', async () => {
    const { p, admin, comedor } = await escenario()
    expect((await p.pedir(admin, 'GET', '/caja?punto=comedor')).body).toBeNull()
    const abierta = await p.pedir<Caja>(admin, 'POST', '/caja/abrir?punto=comedor', { fondoInicial: 10000 })
    expect(abierta.body.punto).toBe('comedor')
    expect((await p.pedir(admin, 'GET', '/caja')).body).toBeNull()
    expect((await p.pedir<Caja>(comedor, 'GET', '/caja')).body.id).toBe(abierta.body.id)
    const mov = await p.pedir<Caja>(comedor, 'POST', '/caja/movimientos', { tipo: 'retiro', importe: 2000, concepto: 'Hielo', medio: 'efectivo' })
    expect(mov.body.esperadoEfectivo).toBe(8000)
    // El cajero no toca un movimiento de la caja del comedor.
    const movId = mov.body.movimientos![0].id
    expect((await p.pedir(await p.entrar('cajero'), 'POST', `/caja/movimientos/${movId}/anular`)).status).toBe(403)
    const cierre = await p.pedir<Caja>(admin, 'POST', '/caja/cerrar?punto=comedor', { contado: 8000 })
    expect(cierre.body).toMatchObject({ abierta: false, diferencia: 0 })
    await p.pedir(admin, 'POST', '/caja/abrir', { fondoInicial: 0 })
    const cajas = (await p.pedir<Caja[]>(admin, 'GET', '/cajas')).body
    expect(cajas.map((c) => c.punto).sort()).toEqual(['comedor', 'frente'])
  })

  it('el aviso de caja sin cerrar es de cada caja', async () => {
    const { p, admin, comedor, cajero } = await escenario()
    await p.pedir(comedor, 'POST', '/caja/abrir', { fondoInicial: 0 })
    await p.sql("UPDATE cajas SET dia = '2026-01-01' WHERE punto = 'comedor'")
    const avisos = async (t: string) => (await p.pedir<Alerta[]>(t, 'GET', '/alertas')).body.filter((a) => a.tipo === 'caja_sin_cerrar')
    expect((await avisos(comedor)).map((a) => a.texto)).toEqual([expect.stringMatching(/^La caja está abierta desde/)])
    expect(await avisos(cajero)).toEqual([])
    expect((await avisos(admin)).map((a) => a.texto)).toEqual([expect.stringMatching(/^Caja del comedor está abierta/)])
  })
})
