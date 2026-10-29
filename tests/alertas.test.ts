// C08, E10, G08 juntos: GET /alertas para el inicio de cada sector y el Resumen, y la sección del correo.
import { describe, expect, it } from 'vitest'
import { prepararResumen } from '../src/server/correo'
import { diaPY } from '../src/shared/hora'
import { nuevaPrueba } from './ayuda'

const EMPANADA = 'prod-cocina-10'

describe('avisos juntos', () => {
  it('cada sector ve solo los suyos y el administrador ve todos', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: 5 })).status).toBe(200)
    expect((await p.pedir(admin, 'PATCH', '/productos/prod-chiperia-01', { stockMinimo: 5 })).status).toBe(200)

    const cocina = await p.pedir(await p.entrar('cocina'), 'GET', '/alertas')
    expect(cocina.status).toBe(200)
    expect(cocina.body.map((a: any) => [a.tipo, a.sector])).toContainEqual(['stock_minimo', 'cocina'])
    expect(cocina.body.every((a: any) => a.sector === 'cocina')).toBe(true)

    const todos = await p.pedir(admin, 'GET', '/alertas')
    const sectores = new Set(todos.body.filter((a: any) => a.tipo === 'stock_minimo').map((a: any) => a.sector))
    expect(sectores).toEqual(new Set(['cocina', 'chiperia']))
    // El administrador también puede pedir los de un sector.
    const soloChiperia = await p.pedir(admin, 'GET', '/alertas?sector=chiperia')
    expect(soloChiperia.body.every((a: any) => a.sector === 'chiperia')).toBe(true)
    // Un operador no ve los de otro sector.
    expect((await p.pedir(await p.entrar('cocina'), 'GET', '/alertas?sector=chiperia')).status).toBe(403)
    expect((await p.pedir(null, 'GET', '/alertas')).status).toBe(401)
  })

  it('el correo de resumen trae los avisos vigentes', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', `/productos/${EMPANADA}`, { stockMinimo: 5 })
    const r = await prepararResumen(p.env, 'diario', diaPY())
    expect(r.html).toContain('Avisos')
    expect(r.html).toMatch(/mínimo 5/)
  })
})
