// C08, E10, G08 juntos: GET /alertas para el inicio de cada sector y el Resumen, y la sección del correo.
import { describe, expect, it } from 'vitest'
import { prepararResumen } from '../src/server/correo'
import { diaPY } from '../src/shared/hora'
import { nuevaPrueba } from './ayuda'

describe('avisos juntos', () => {
  it('cada sector ve solo los suyos y el administrador ve todos', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const falla = (maquinaId: string) => p.pedir(admin, 'POST', '/incidencias', { maquinaId, tipo: 'falla', descripcion: 'No enfría bien' })
    expect((await falla('maq-cocina-1')).status).toBe(200)
    expect((await falla('maq-chiperia-1')).status).toBe(200)

    const cocina = await p.pedir(await p.entrar('cocina'), 'GET', '/alertas')
    expect(cocina.status).toBe(200)
    expect(cocina.body.map((a: any) => [a.tipo, a.sector])).toContainEqual(['incidencia_maquina', 'cocina'])
    expect(cocina.body.every((a: any) => a.sector === 'cocina')).toBe(true)

    const todos = await p.pedir(admin, 'GET', '/alertas')
    const sectores = new Set(todos.body.filter((a: any) => a.tipo === 'incidencia_maquina').map((a: any) => a.sector))
    expect(sectores).toEqual(new Set(['cocina', 'chiperia']))
    // El administrador también puede pedir los de un sector.
    const soloChiperia = await p.pedir(admin, 'GET', '/alertas?sector=chiperia')
    expect(soloChiperia.body.every((a: any) => a.sector === 'chiperia')).toBe(true)
    // Un operador no ve los de otro sector.
    expect((await p.pedir(await p.entrar('cocina'), 'GET', '/alertas?sector=chiperia')).status).toBe(403)
    expect((await p.pedir(null, 'GET', '/alertas')).status).toBe(401)
  })

  it('una temperatura fuera de rango avisa al sector, al supervisor y al administrador hasta que haya una lectura buena', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    const supervisor = await p.entrar('supervisor')
    const leer = (temperatura: number) => p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'otro', estado: 'funciona', temperatura })
    const avisos = async (token: string, ruta = '/alertas') =>
      (await p.pedir(token, 'GET', ruta)).body.filter((a: any) => a.tipo === 'temperatura_fuera_de_rango')

    expect((await leer(3)).status).toBe(200)
    expect(await avisos(cocina)).toEqual([])
    expect((await leer(25)).body.fueraDeRango).toBe(true)
    for (const token of [cocina, admin, supervisor]) {
      const lista = await avisos(token)
      expect(lista).toHaveLength(1)
      expect(lista[0]).toMatchObject({ sector: 'cocina', enlace: '/maquinas?maquina=maq-cocina-1' })
      expect(lista[0].texto).toContain('25 °C')
      expect(lista[0].texto).toContain('fuera de rango')
    }
    // Otro sector, el cajero y el propio sector de otra máquina no lo ven.
    expect(await avisos(await p.entrar('chiperia'))).toEqual([])
    expect(await avisos(await p.entrar('cajero'))).toEqual([])

    // No se va con los días: sigue y dice hace cuánto está así, y entra en el correo de cada mañana.
    await p.sql("UPDATE lecturas SET fecha = '2020-01-01T12:00:00.000Z', dia = '2020-01-01' WHERE fuera_de_rango = 1")
    await p.sql("UPDATE lecturas SET fecha = '2019-12-31T12:00:00.000Z', dia = '2019-12-31' WHERE fuera_de_rango = 0")
    const viejo = await avisos(admin)
    expect(viejo).toHaveLength(1)
    expect(viejo[0].texto).toMatch(/Lleva \d+ días así/)
    const correo = await prepararResumen(p.env, 'diario', diaPY())
    expect(correo.html).toContain('fuera de rango (')

    // Una segunda lectura mala no duplica el aviso; una buena lo cierra.
    expect((await leer(12)).status).toBe(200)
    expect(await avisos(cocina)).toHaveLength(1)
    expect((await avisos(cocina))[0].texto).toContain('12 °C')
    expect((await leer(4)).status).toBe(200)
    for (const token of [cocina, admin, supervisor]) expect(await avisos(token)).toEqual([])
  })

  it('el correo de resumen trae los avisos vigentes', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'falla', descripcion: 'No enfría bien' })
    const r = await prepararResumen(p.env, 'diario', diaPY())
    expect(r.html).toContain('Avisos')
    expect(r.html).toMatch(/No enfría bien|falla/i)
  })
})
