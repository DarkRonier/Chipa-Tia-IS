// La materia prima de Chipería que entra con una compra crea su lote de materia prima (E01), y lo que usa cada amasada
// sale del depósito Materia prima.
import { describe, expect, it } from 'vitest'
import { sumarDias, diaPY } from '../src/shared/hora'
import type { Compra, LoteMP, Produccion, Producto, ProductoCompra, StockFila } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

async function escenario() {
  const p = await nuevaPrueba()
  const admin = await p.entrar('admin')
  const queso = (await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'chiperia', nombre: 'Queso Paraguay', unidad: 'kg', tipo: 'materia_prima' })).body
  return { p, admin, queso, vence: sumarDias(diaPY(), 20) }
}

const comprar = (p: Prueba, token: string, items: unknown[]) =>
  p.pedir(token, 'POST', '/compras', { comprobante: '001-001-0000123', items })

const stockMP = async (p: Prueba, token: string, productoId: string) =>
  (await p.pedir<StockFila[]>(token, 'GET', '/stock?sector=chiperia')).body.find((f) => f.productoId === productoId)?.porDeposito.materia_prima ?? 0

describe('materia prima de Chipería comprada', () => {
  it('avisa que pide vencimiento y crea el lote de materia prima con lo de la compra', async () => {
    const { p, admin, queso, vence } = await escenario()
    const productos = (await p.pedir<ProductoCompra[]>(admin, 'GET', '/compras/productos')).body
    expect(productos.find((x) => x.id === queso.id)).toMatchObject({ loteMP: true, tipo: 'materia_prima' })

    const sinVence = await comprar(p, admin, [{ productoId: queso.id, cantidad: 40, precioUnitario: 30000, lote: 'q-7' }])
    expect(sinVence.status).toBe(400)
    expect(sinVence.body.error.mensaje).toMatch(/vence/)
    const vencido = await comprar(p, admin, [{ productoId: queso.id, cantidad: 40, precioUnitario: 30000, vencimiento: sumarDias(diaPY(), -1) }])
    expect(vencido.status).toBe(400)

    const r = await comprar(p, admin, [{ productoId: queso.id, cantidad: 40, precioUnitario: 30000, lote: 'q-7', vencimiento: vence }])
    expect(r.status).toBe(200)
    expect(r.body.items[0]).toMatchObject({ lote: 'Q-7', vencimiento: vence })
    const lotes = (await p.pedir<LoteMP[]>(admin, 'GET', '/lotes-mp?disponibles=1')).body
    const lote = lotes.find((l) => l.compraId === r.body.id)!
    expect(lote).toMatchObject({
      insumo: 'Queso Paraguay', proveedor: 'Sin nombre', numeroLote: 'Q-7', cantidad: 40, unidad: 'kg', vencimiento: vence, productoId: queso.id,
      fechaIngreso: diaPY(), disponible: true,
    })
    expect(await stockMP(p, admin, queso.id)).toBe(40)
  })

  it('lo que usa la amasada sale del depósito Materia prima; la compra ya no se puede anular', async () => {
    const { p, admin, queso, vence } = await escenario()
    const compra = (await comprar(p, admin, [{ productoId: queso.id, cantidad: 40, precioUnitario: 30000, lote: 'Q-7', vencimiento: vence }])).body
    const lote = (await p.pedir<LoteMP[]>(admin, 'GET', '/lotes-mp')).body.find((l) => l.compraId === compra.id)!
    const chiperia = await p.entrar('chiperia')
    const prod = await p.pedir<Produccion>(chiperia, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [{ id: lote.id, cantidad: 2.5 }], items: [{ productoId: 'prod-chiperia-01', cocinado: 100, guardado: 0 }],
    })
    expect(prod.status).toBe(200)
    expect(await stockMP(p, admin, queso.id)).toBe(37.5)
    const [mov] = await p.sql("SELECT lote, motivo, produccion_id FROM movimientos WHERE producto_id = ? AND tipo = 'produccion'", queso.id)
    expect(mov).toMatchObject({ lote: 'Q-7', motivo: `Usado en la amasada ${prod.body.lote!.codigo}`, produccion_id: prod.body.id })

    const anular = await p.pedir(admin, 'POST', `/compras/${compra.id}/anular`, { motivo: 'Error' })
    expect(anular.status).toBe(409)
    expect(anular.body.error.mensaje).toMatch(/amasada/)
  })

  it('no frena la amasada aunque el depósito no alcance', async () => {
    const { p, admin, queso, vence } = await escenario()
    const compra = (await comprar(p, admin, [{ productoId: queso.id, cantidad: 10, precioUnitario: 30000, vencimiento: vence }])).body
    const lote = (await p.pedir<LoteMP[]>(admin, 'GET', '/lotes-mp')).body.find((l) => l.compraId === compra.id)!
    // Alguien pasó el queso a Frío: el depósito Materia prima queda en 0.
    expect((await p.pedir(admin, 'POST', '/transferencias', { productoId: queso.id, cantidad: 10, desde: 'materia_prima', hacia: 'frio', lote: null })).status).toBe(200)
    const chiperia = await p.entrar('chiperia')
    const prod = await p.pedir(chiperia, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [{ id: lote.id, cantidad: 4 }], items: [{ productoId: 'prod-chiperia-01', cocinado: 50, guardado: 0 }],
    })
    expect(prod.status).toBe(200)
    expect(await stockMP(p, admin, queso.id)).toBe(-4)
  })

  it('al anular la compra sin usar, su lote de materia prima desaparece', async () => {
    const { p, admin, queso, vence } = await escenario()
    const compra = (await comprar(p, admin, [{ productoId: queso.id, cantidad: 40, precioUnitario: 30000, vencimiento: vence }])).body
    const anular = await p.pedir<Compra>(admin, 'POST', `/compras/${compra.id}/anular`, { motivo: 'Cargada dos veces' })
    expect(anular.status).toBe(200)
    expect((await p.pedir<LoteMP[]>(admin, 'GET', '/lotes-mp')).body.some((l) => l.compraId === compra.id)).toBe(false)
    expect(await stockMP(p, admin, queso.id)).toBe(0)
  })

  it('Chipería compra su materia prima si tiene la categoría habilitada, y los lotes cargados a mano siguen igual', async () => {
    const { p, admin, queso, vence } = await escenario()
    await p.pedir(admin, 'PATCH', '/categorias/cat-otros', { sectores: ['chiperia'] })
    const chiperia = await p.entrar('chiperia')
    const r = await comprar(p, chiperia, [{ productoId: queso.id, cantidad: 12, precioUnitario: 30000, vencimiento: vence }])
    expect(r.status).toBe(200)
    expect((await p.pedir<LoteMP[]>(chiperia, 'GET', '/lotes-mp')).body.filter((l) => l.compraId === r.body.id)).toHaveLength(1)
    const aMano = await p.pedir<LoteMP>(chiperia, 'POST', '/lotes-mp', {
      insumo: 'Huevo', proveedor: 'Granja', fechaIngreso: diaPY(), cantidad: 30, unidad: 'unidades', vencimiento: vence,
    })
    expect(aMano.body).toMatchObject({ productoId: null, compraId: null })
  })
})
