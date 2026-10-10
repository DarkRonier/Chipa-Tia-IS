// G01–G03: reportes de limpieza (todas las tareas marcadas X, XX o -), historial y "Controlado por".
import { describe, expect, it } from 'vitest'
import { diaPY, sumarDias } from '../src/shared/hora'
import type { AreaLimpieza, Limpieza, Marca } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

/** Marcas para todas las tareas activas del área: las indicadas y el resto con `resto`. */
async function marcasDe(p: Prueba, token: string, areaId: string, elegidas: Record<string, Marca> = {}, resto: Marca = '-') {
  const areas = await p.pedir<AreaLimpieza[]>(token, 'GET', '/areas')
  const area = areas.body.find((a) => a.id === areaId)
  if (!area) throw new Error(`Área ${areaId} no visible`)
  return area.tareas.map((t) => ({ tareaId: t.id, marca: elegidas[t.id] ?? resto }))
}

describe('limpieza', () => {
  it('registra una limpieza marcando 3 tareas, con fecha, hora, sector y usuario automáticos (G01, G02)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('panaderia')
    const marcas = await marcasDe(p, t, 'panaderia', {
      'tarea-panaderia-01': 'X', 'tarea-panaderia-03': 'XX', 'tarea-panaderia-07': 'X',
    })
    const r = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'panaderia', marcas, comentario: ' Faltó lavandina ' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      areaId: 'panaderia', areaNombre: 'Panadería', sector: 'panaderia', usuarioId: 'usr-panaderia',
      usuarioNombre: 'Encargado Panadería', dia: diaPY(), comentario: 'Faltó lavandina',
      controladoPor: null, controladoPorNombre: null, controladoEn: null,
    })
    expect(Date.parse(r.body.fecha)).toBeGreaterThan(Date.now() - 60_000)
    expect(r.body.marcas).toHaveLength(13)
    const hechas = r.body.marcas.filter((m) => m.marca !== '-')
    expect(hechas).toEqual([
      { tareaId: 'tarea-panaderia-01', tareaNombre: 'Techo', marca: 'X', numero: null },
      { tareaId: 'tarea-panaderia-03', tareaNombre: 'Piso', marca: 'XX', numero: null },
      { tareaId: 'tarea-panaderia-07', tareaNombre: 'Horno', marca: 'X', numero: null },
    ])
    const filas = await p.sql("SELECT marca, COUNT(*) AS n FROM limpieza_marcas GROUP BY marca ORDER BY marca")
    expect(filas).toEqual([{ marca: '-', n: 10 }, { marca: 'X', n: 2 }, { marca: 'XX', n: 1 }])
    // Sin comentario también vale (es opcional).
    const sin = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'panaderia', marcas })
    expect(sin.status).toBe(200)
    expect(sin.body.comentario).toBe('')
  })

  it('no deja cuadros en blanco: exige marcar todas las tareas activas del área', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const todas = await marcasDe(p, t, 'sanitario', {}, 'X')
    const falta1 = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: todas.slice(1) })
    expect(falta1.status).toBe(400)
    expect(falta1.body.error.mensaje).toBe('Falta marcar «Piso» (X, XX o -).')
    const faltan = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: todas.slice(0, 2) })
    expect(faltan.body.error.mensaje).toBe('Faltan marcar 6 tareas: Techo, Lavamanos, Inodoro y 3 más.')
    expect((await p.pedir(t, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: [] })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/limpiezas', { areaId: 'sanitario' })).status).toBe(400)
    // Una tarea desactivada ya no se pide, ni se acepta.
    await p.sql("UPDATE tareas_limpieza SET activo = 0 WHERE id = 'tarea-sanitario-01'")
    const conInactiva = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: todas })
    expect(conInactiva.status).toBe(400)
    const r = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: todas.slice(1) })
    expect(r.status).toBe(200)
    expect(r.body.marcas).toHaveLength(7)
    expect((await p.sql('SELECT COUNT(*) AS n FROM limpiezas'))[0].n).toBe(1)
  })

  it('rechaza tareas de otra área, repetidas o con marcas inválidas', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const marcas = await marcasDe(p, t, 'buffet', {}, 'X')
    const ajena = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'buffet', marcas: [...marcas, { tareaId: 'tarea-cocina-01', marca: 'X' }] })
    expect(ajena.status).toBe(400)
    expect(ajena.body.error.mensaje).toMatch(/no es de esta área/)
    const repetida = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'buffet', marcas: [...marcas, marcas[0]] })
    expect(repetida.body.error.mensaje).toBe('«Pared» está marcada dos veces.')
    const mala = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'buffet', marcas: [{ ...marcas[0], marca: 'Y' }, ...marcas.slice(1)] })
    expect(mala.body.error.mensaje).toBe('Elegí X, XX o - para «Pared».')
    const vacia = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'buffet', marcas: [{ ...marcas[0], marca: '' }, ...marcas.slice(1)] })
    expect(vacia.status).toBe(400)
    expect((await p.pedir(t, 'POST', '/limpiezas', { areaId: 'no-existe', marcas })).status).toBe(404)
    expect((await p.pedir(t, 'POST', '/limpiezas', { areaId: 'buffet', marcas, comentario: 'x'.repeat(501) })).status).toBe(400)
    expect((await p.sql('SELECT COUNT(*) AS n FROM limpiezas'))[0].n).toBe(0)
  })

  it('guarda el N° de equipo solo en las tareas que lo piden', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const marcas = await marcasDe(p, t, 'cocina', { 'tarea-cocina-16': 'X', 'tarea-cocina-17': 'XX', 'tarea-cocina-18': '-' }, 'X')
    const conNumero = marcas.map((m) =>
      m.tareaId === 'tarea-cocina-16' ? { ...m, numero: ' 2 ' }
        : m.tareaId === 'tarea-cocina-17' ? { ...m, numero: '1 y 3' }
          : m.tareaId === 'tarea-cocina-18' ? { ...m, numero: '4' } : m)
    const r = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'cocina', marcas: conNumero })
    expect(r.status).toBe(200)
    const porTarea = Object.fromEntries(r.body.marcas.map((m) => [m.tareaNombre, m]))
    expect(porTarea.Freezer).toMatchObject({ marca: 'X', numero: '2' })
    expect(porTarea.Horno).toMatchObject({ marca: 'XX', numero: '1 y 3' })
    // "No se hizo" no lleva número.
    expect(porTarea.Freidoras).toMatchObject({ marca: '-', numero: null })
    expect(porTarea.Techo.numero).toBeNull()
    const mal = await p.pedir(t, 'POST', '/limpiezas', {
      areaId: 'cocina', marcas: marcas.map((m) => (m.tareaId === 'tarea-cocina-01' ? { ...m, numero: '3' } : m)),
    })
    expect(mal.status).toBe(400)
    expect(mal.body.error.mensaje).toBe('«Techo» no lleva N° de equipo.')
  })

  it('un operador solo reporta áreas de su sector y solo ve su sector (A03)', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const chiperia = await p.entrar('chiperia')
    const marcasCocina = await marcasDe(p, cocina, 'cocina', {}, 'X')
    const ajena = await p.pedir(chiperia, 'POST', '/limpiezas', { areaId: 'cocina', marcas: marcasCocina })
    expect(ajena.status).toBe(403)
    const otroSector = await p.pedir(chiperia, 'POST', '/limpiezas', { areaId: 'sanitario', sector: 'cocina', marcas: await marcasDe(p, chiperia, 'sanitario') })
    expect(otroSector.status).toBe(403)
    // El sanitario es común: cada sector lo reporta a su nombre.
    const s1 = await p.pedir<Limpieza>(chiperia, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: await marcasDe(p, chiperia, 'sanitario') })
    expect(s1.body.sector).toBe('chiperia')
    const s2 = await p.pedir<Limpieza>(cocina, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: await marcasDe(p, cocina, 'sanitario') })
    expect(s2.body.sector).toBe('cocina')
    await p.pedir(cocina, 'POST', '/limpiezas', { areaId: 'cocina', marcas: marcasCocina })

    const deChiperia = await p.pedir<Limpieza[]>(chiperia, 'GET', '/limpiezas')
    expect(deChiperia.body.map((l) => l.id)).toEqual([s1.body.id])
    expect((await p.pedir(chiperia, 'GET', '/limpiezas?sector=cocina')).status).toBe(403)
    expect((await p.pedir<Limpieza[]>(chiperia, 'GET', '/limpiezas?area=cocina')).body).toEqual([])
    expect((await p.pedir<Limpieza[]>(cocina, 'GET', '/limpiezas')).body).toHaveLength(2)
    expect((await p.pedir(null, 'GET', '/limpiezas')).status).toBe(401)
  })

  it('el administrador indica el sector cuando el área la cargan varios', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const marcas = await marcasDe(p, admin, 'sanitario')
    const sinSector = await p.pedir(admin, 'POST', '/limpiezas', { areaId: 'sanitario', marcas })
    expect(sinSector.status).toBe(400)
    expect(sinSector.body.error.mensaje).toMatch(/sector/)
    expect((await p.pedir(admin, 'POST', '/limpiezas', { areaId: 'buffet', sector: 'chiperia', marcas: await marcasDe(p, admin, 'buffet') })).status).toBe(400)
    const r = await p.pedir<Limpieza>(admin, 'POST', '/limpiezas', { areaId: 'sanitario', sector: 'panaderia', marcas })
    expect(r.body).toMatchObject({ sector: 'panaderia', usuarioNombre: 'Administración' })
    // Área de un solo sector: lo toma de ahí.
    const buffet = await p.pedir<Limpieza>(admin, 'POST', '/limpiezas', { areaId: 'buffet', marcas: await marcasDe(p, admin, 'buffet') })
    expect(buffet.body.sector).toBe('cocina')
  })

  it('filtra el historial por sector, área y fecha (G03)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    const chipitas = await p.entrar('chipitas')
    const a = await p.pedir<Limpieza>(cocina, 'POST', '/limpiezas', { areaId: 'cocina', marcas: await marcasDe(p, cocina, 'cocina', {}, 'X') })
    const b = await p.pedir<Limpieza>(cocina, 'POST', '/limpiezas', { areaId: 'buffet', marcas: await marcasDe(p, cocina, 'buffet', {}, 'X') })
    const c = await p.pedir<Limpieza>(chipitas, 'POST', '/limpiezas', { areaId: 'chipitas', marcas: await marcasDe(p, chipitas, 'chipitas', {}, 'XX') })
    const hoy = diaPY()
    const hace5 = sumarDias(hoy, -5)
    await p.sql('UPDATE limpiezas SET dia = ?, fecha = ? WHERE id = ?', hace5, `${hace5}T15:00:00.000Z`, a.body.id)

    const ids = async (ruta: string, token = admin) => (await p.pedir<Limpieza[]>(token, 'GET', ruta)).body.map((l) => l.id)
    expect(await ids('/limpiezas')).toEqual([c.body.id, b.body.id, a.body.id])
    expect(await ids('/limpiezas?sector=cocina')).toEqual([b.body.id, a.body.id])
    expect(await ids(`/limpiezas?sector=cocina&desde=${hoy}&hasta=${hoy}`)).toEqual([b.body.id])
    expect(await ids(`/limpiezas?sector=cocina&desde=${hace5}&hasta=${hace5}`)).toEqual([a.body.id])
    expect(await ids(`/limpiezas?hasta=${sumarDias(hoy, -1)}`)).toEqual([a.body.id])
    expect(await ids('/limpiezas?sector=chipitas')).toEqual([c.body.id])
    expect(await ids('/limpiezas?area=buffet')).toEqual([b.body.id])
    expect(await ids(`/limpiezas?desde=${hoy}`, cocina)).toEqual([b.body.id])
    expect((await p.pedir(admin, 'GET', '/limpiezas?desde=10/10/2026')).status).toBe(400)
  })

  it('el administrador da el visto bueno una sola vez (Controlado por)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('chiperia')
    const marcas = await marcasDe(p, t, 'chiperia', {}, 'X')
    const l = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'chiperia', marcas })
    const otra = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'chiperia', marcas })

    expect((await p.pedir(t, 'POST', `/limpiezas/${l.body.id}/control`)).status).toBe(403)
    const r = await p.pedir<Limpieza>(admin, 'POST', `/limpiezas/${l.body.id}/control`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: l.body.id, controladoPor: 'usr-admin', controladoPorNombre: 'Administración' })
    expect(Date.parse(r.body.controladoEn!)).toBeGreaterThan(Date.now() - 60_000)
    const otraVez = await p.pedir(admin, 'POST', `/limpiezas/${l.body.id}/control`)
    expect(otraVez.status).toBe(409)
    expect(otraVez.body.error).toEqual({ codigo: 'ya_controlada', mensaje: 'Esta limpieza ya la controló Administración.' })
    expect((await p.pedir(admin, 'POST', '/limpiezas/no-existe/control')).status).toBe(404)

    const [aud] = await p.sql("SELECT * FROM auditoria WHERE tabla = 'limpiezas'")
    expect(aud).toMatchObject({ registro_id: l.body.id, accion: 'controlar', usuario_id: 'usr-admin' })
    expect(JSON.parse(aud.despues).controladoPor).toBe('usr-admin')

    const pendientes = await p.pedir<Limpieza[]>(admin, 'GET', '/limpiezas?sinControlar=1')
    expect(pendientes.body.map((x) => x.id)).toEqual([otra.body.id])
    // El operador ve que su reporte quedó controlado.
    const propias = await p.pedir<Limpieza[]>(t, 'GET', '/limpiezas')
    expect(propias.body.find((x) => x.id === l.body.id)?.controladoPorNombre).toBe('Administración')
  })

  it('no acepta áreas dadas de baja, pero su historial queda', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const marcas = await marcasDe(p, t, 'deposito-mp', {}, 'X')
    const antes = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'deposito-mp', marcas })
    await p.sql("UPDATE areas_limpieza SET activo = 0 WHERE id = 'deposito-mp'")
    const r = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'deposito-mp', marcas })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toMatch(/baja/)
    const h = await p.pedir<Limpieza[]>(t, 'GET', '/limpiezas')
    expect(h.body.map((l) => [l.id, l.areaNombre])).toEqual([[antes.body.id, 'Depósito de materia prima']])
  })
})
