// G01–G03: reportes de limpieza (todas las tareas marcadas X, XX o -), historial y "Controlado por".
import { describe, expect, it } from 'vitest'
import { diaPY, sumarDias } from '../src/shared/hora'
import type { AreaLimpieza, Limpieza, Marca } from '../src/shared/tipos'
import type { Alerta } from '../src/shared/alertas'
import { JPEG_1PX, nuevaPrueba, type Prueba } from './ayuda'

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

  it('guarda una foto opcional del reporte y solo la entrega al pedirla (G06)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('panaderia')
    const marcas = await marcasDe(p, t, 'panaderia', {}, 'X')
    const r = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'panaderia', marcas, foto: JPEG_1PX })
    expect(r.status).toBe(200)
    expect(r.body.tieneFoto).toBe(true)
    const [fila] = await p.sql('SELECT foto_clave FROM limpiezas WHERE id = ?', r.body.id)
    expect(fila.foto_clave).toBe(`fotos/limpieza/${r.body.id}.jpg`)
    const [archivo] = await p.sql('SELECT tipo FROM archivos WHERE clave = ?', fila.foto_clave)
    expect(archivo.tipo).toBe('image/jpeg')

    // Los listados dicen que hay foto, pero no la traen.
    const lista = await p.pedir<Limpieza[]>(t, 'GET', '/limpiezas')
    expect(lista.body[0].tieneFoto).toBe(true)
    expect(JSON.stringify(lista.body)).not.toContain('base64')
    expect(lista.body[0]).not.toHaveProperty('foto')

    // Bajo demanda: el dueño del sector y el administrador la ven; otro sector no.
    const foto = await p.pedir(t, 'GET', `/limpiezas/${r.body.id}/foto`)
    expect(foto.status).toBe(200)
    expect(foto.body.dataUrl).toBe(JPEG_1PX)
    expect((await p.pedir(await p.entrar('admin'), 'GET', `/limpiezas/${r.body.id}/foto`)).body.dataUrl).toBe(JPEG_1PX)
    expect((await p.pedir(await p.entrar('chiperia'), 'GET', `/limpiezas/${r.body.id}/foto`)).status).toBe(403)
    expect((await p.pedir(null, 'GET', `/limpiezas/${r.body.id}/foto`)).status).toBe(401)

    // Sin foto: el reporte vale igual y pedir la foto da 404.
    const sin = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'panaderia', marcas })
    expect(sin.body.tieneFoto).toBe(false)
    expect((await p.pedir(t, 'GET', `/limpiezas/${sin.body.id}/foto`)).status).toBe(404)
    expect((await p.pedir(t, 'GET', '/limpiezas/no-existe/foto')).status).toBe(404)
  })

  it('guarda la foto del reporte en R2 cuando hay bucket y rechaza lo que no es una imagen', async () => {
    const guardados = new Map<string, Uint8Array>()
    const p = await nuevaPrueba({
      ARCHIVOS: {
        async put(clave, datos) {
          guardados.set(clave, datos as Uint8Array)
        },
        async get(clave) {
          const g = guardados.get(clave)
          return g ? { arrayBuffer: async () => g.slice().buffer, httpMetadata: { contentType: 'image/jpeg' } } : null
        },
        async delete(claves) {
          for (const k of [claves].flat()) guardados.delete(k)
        },
      },
    })
    const t = await p.entrar('chiperia')
    const marcas = await marcasDe(p, t, 'deposito-mp', {}, 'X')
    for (const foto of ['hola', 'data:text/plain;base64,aG9sYQ==', 42]) {
      const mala = await p.pedir(t, 'POST', '/limpiezas', { areaId: 'deposito-mp', marcas, foto })
      expect(mala.status).toBe(400)
      expect(mala.body.error.mensaje).toMatch(/foto/)
    }
    expect(await p.sql('SELECT id FROM limpiezas')).toEqual([])
    const r = await p.pedir<Limpieza>(t, 'POST', '/limpiezas', { areaId: 'deposito-mp', marcas, foto: JPEG_1PX })
    expect(r.status).toBe(200)
    expect([...guardados.keys()]).toEqual([`fotos/limpieza/${r.body.id}.jpg`])
    expect((await p.sql('SELECT COUNT(*) AS n FROM archivos'))[0].n).toBe(0)
    expect((await p.pedir(t, 'GET', `/limpiezas/${r.body.id}/foto`)).body.dataUrl).toBe(JPEG_1PX)
  })
})

describe('frecuencia mínima de limpieza (G08)', () => {
  /** Limpieza vieja cargada directo en la base. */
  const cargarVieja = (p: Prueba, areaId: string, sector: string, dia: string) =>
    p.sql(
      'INSERT INTO limpiezas (id, area_id, sector, usuario_id, fecha, dia) VALUES (?, ?, ?, ?, ?, ?)',
      `vieja-${areaId}`, areaId, sector, `usr-${sector}`, `${dia}T15:00:00.000Z`, dia,
    )

  it('el administrador fija la frecuencia del área y la puede quitar', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const areas = await p.pedir<AreaLimpieza[]>(admin, 'GET', '/areas')
    expect(areas.body.every((a) => a.frecuenciaDias === null)).toBe(true)
    const r = await p.pedir<AreaLimpieza>(admin, 'PATCH', '/areas/panaderia', { frecuenciaDias: 7 })
    expect(r.status).toBe(200)
    expect(r.body.frecuenciaDias).toBe(7)
    expect((await p.pedir<AreaLimpieza[]>(admin, 'GET', '/areas?sector=panaderia')).body[0].frecuenciaDias).toBe(7)
    for (const frecuenciaDias of [0, -1, 1.5, 400, '7']) {
      expect((await p.pedir(admin, 'PATCH', '/areas/panaderia', { frecuenciaDias })).status).toBe(400)
    }
    expect((await p.pedir<AreaLimpieza>(admin, 'PATCH', '/areas/panaderia', { frecuenciaDias: null })).body.frecuenciaDias).toBeNull()
    // Un operador no la cambia.
    expect((await p.pedir(await p.entrar('panaderia'), 'PATCH', '/areas/panaderia', { frecuenciaDias: 3 })).status).toBe(403)
  })

  it('avisa cuando el área pasó la frecuencia sin limpiarse y el aviso se va al limpiar', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('panaderia')
    // Sin exigencia no hay aviso, aunque nunca se haya limpiado.
    expect((await p.pedir<Alerta[]>(t, 'GET', '/limpieza/alertas')).body).toEqual([])

    await p.pedir(admin, 'PATCH', '/areas/panaderia', { frecuenciaDias: 2 })
    await cargarVieja(p, 'panaderia', 'panaderia', sumarDias(diaPY(), -5))
    const r = await p.pedir<Alerta[]>(t, 'GET', '/limpieza/alertas')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([{
      tipo: 'limpieza_atrasada', sector: 'panaderia', enlace: '/limpieza',
      texto: 'Panadería: hace 5 días que no se limpia (se pide limpiar cada 2 días).',
    }])

    const marcas = await marcasDe(p, t, 'panaderia', {}, 'X')
    await p.pedir(t, 'POST', '/limpiezas', { areaId: 'panaderia', marcas })
    expect((await p.pedir<Alerta[]>(t, 'GET', '/limpieza/alertas')).body).toEqual([])
  })

  it('cuenta los días justos: con «todos los días» avisa recién cuando se saltó uno, y un área sin ninguna limpieza avisa', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', '/areas/panaderia', { frecuenciaDias: 1 })
    await p.pedir(admin, 'PATCH', '/areas/cocina', { frecuenciaDias: 7 })
    const hoy = diaPY()
    // Panadería se limpió ayer: todavía está al día. Cocina nunca.
    await cargarVieja(p, 'panaderia', 'panaderia', sumarDias(hoy, -1))
    const a = await p.pedir<Alerta[]>(admin, 'GET', '/limpieza/alertas')
    expect(a.body.map((x) => x.texto)).toEqual(['Cocina: todavía no tiene limpiezas registradas (se pide limpiar cada 7 días).'])
    await p.sql('UPDATE limpiezas SET dia = ?', sumarDias(hoy, -2))
    const b = await p.pedir<Alerta[]>(admin, 'GET', '/limpieza/alertas')
    expect(b.body.map((x) => x.texto)).toEqual([
      'Panadería: hace 2 días que no se limpia (se pide limpiar todos los días).',
      'Cocina: todavía no tiene limpiezas registradas (se pide limpiar cada 7 días).',
    ])
  })

  it('cada sector ve solo las suyas; el administrador ve todas o filtra por sector; las áreas de baja no avisan', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    for (const id of ['panaderia', 'cocina', 'sanitario', 'lavadero']) await p.pedir(admin, 'PATCH', `/areas/${id}`, { frecuenciaDias: 1 })
    await p.pedir(admin, 'PATCH', '/areas/lavadero', { activo: false })
    const nombres = async (token: string, ruta = '/limpieza/alertas') =>
      (await p.pedir<Alerta[]>(token, 'GET', ruta)).body.map((x) => x.texto.split(':')[0])
    expect(await nombres(await p.entrar('panaderia'))).toEqual(['Panadería', 'Sanitario'])
    expect(await nombres(await p.entrar('cocina'))).toEqual(['Cocina', 'Sanitario'])
    expect(await nombres(await p.entrar('chiperia'))).toEqual(['Sanitario'])
    expect(await nombres(admin)).toEqual(['Panadería', 'Cocina', 'Sanitario'])
    expect(await nombres(admin, '/limpieza/alertas?sector=cocina')).toEqual(['Cocina', 'Sanitario'])
    // Un operador no puede pedir otro sector.
    expect((await p.pedir(await p.entrar('panaderia'), 'GET', '/limpieza/alertas?sector=cocina')).status).toBe(403)
    expect((await p.pedir(null, 'GET', '/limpieza/alertas')).status).toBe(401)
  })
})
