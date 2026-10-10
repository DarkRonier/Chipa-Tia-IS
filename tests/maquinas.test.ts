// F01–F05: lecturas de máquinas con estado, temperatura obligatoria, rango, foto e historial.
import { describe, expect, it } from 'vitest'
import { diaPY, sumarDias } from '../src/shared/hora'
import type { Lectura } from '../src/shared/tipos'
import { nuevaPrueba } from './ayuda'

// JPEG mínimo de 1×1 px (válido) como data URL.
const JPEG_1PX =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBtFFFeWeyf/9k='

describe('lecturas de máquinas', () => {
  it('registra una máquina con fallas y una observación (F01)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chipitas')
    const r = await p.pedir<Lectura>(t, 'POST', '/lecturas', {
      maquinaId: 'maq-chipitas-1', momento: 'inicio', estado: 'con_fallas', temperatura: null,
      observacion: '  Hace ruido al arrancar  ',
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      maquinaId: 'maq-chipitas-1', maquinaNombre: 'Máquina de chipitas', maquinaNumero: 1, sector: 'chipitas',
      usuarioId: 'usr-chipitas', usuarioNombre: 'Encargado Chipitas', estado: 'con_fallas', temperatura: null,
      fueraDeRango: false, observacion: 'Hace ruido al arrancar', mantenimiento: null, tieneFoto: false,
      momento: 'inicio', dia: diaPY(),
    })
    expect(Date.parse(r.body.fecha)).toBeGreaterThan(Date.now() - 60_000)
    const lista = await p.pedir<Lectura[]>(t, 'GET', '/lecturas')
    expect(lista.body.map((l) => l.id)).toEqual([r.body.id])
  })

  it('no deja guardar la heladera sin temperatura (F02)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    for (const temperatura of [null, undefined, '']) {
      const r = await p.pedir(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura })
      expect(r.status).toBe(400)
      expect(r.body.error.mensaje).toMatch(/temperatura/)
    }
    // Freezer (solo máximo) y bufetera caliente (solo mínimo) también la piden.
    for (const maquinaId of ['maq-cocina-2', 'maq-cocina-7']) {
      const r = await p.pedir(t, 'POST', '/lecturas', { maquinaId, momento: 'inicio', estado: 'con_fallas', temperatura: null })
      expect(r.status).toBe(400)
    }
    // Fuera de servicio no se puede medir: ahí no es obligatoria.
    const fuera = await p.pedir(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'fin', estado: 'fuera_de_servicio', temperatura: null })
    expect(fuera.status).toBe(200)
    expect(fuera.body.fueraDeRango).toBe(false)
    // Una máquina sin rango (horno) no la pide.
    const horno = await p.pedir(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-5', momento: 'otro', estado: 'funciona', temperatura: null })
    expect(horno.status).toBe(200)
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas'))[0].n).toBe(2)
  })

  it('marca en rojo 9 °C en una heladera de 0 a 5 °C (F04) y respeta rangos de un solo lado', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    // B02 del anexo: heladera de 0 °C a 5 °C.
    await p.sql("UPDATE maquinas SET temp_min = 0, temp_max = 5 WHERE id = 'maq-cocina-1'")
    const t = await p.entrar('cocina')
    const leer = (maquinaId: string, temperatura: number, momento = 'inicio') =>
      p.pedir<Lectura>(t, 'POST', '/lecturas', { maquinaId, momento, estado: 'funciona', temperatura })

    expect((await leer('maq-cocina-1', 9)).body.fueraDeRango).toBe(true)
    expect((await leer('maq-cocina-1', 4.5)).body.fueraDeRango).toBe(false)
    expect((await leer('maq-cocina-1', 0)).body.fueraDeRango).toBe(false)
    expect((await leer('maq-cocina-1', -0.5)).body.fueraDeRango).toBe(true)
    // Freezer: −18 °C o menos.
    expect((await leer('maq-cocina-2', -18)).body.fueraDeRango).toBe(false)
    expect((await leer('maq-cocina-2', -22.3)).body.fueraDeRango).toBe(false)
    expect((await leer('maq-cocina-2', -15)).body.fueraDeRango).toBe(true)
    // Bufetera caliente: 63 °C o más; lecturas inicial e intermedia del buffet.
    expect((await leer('maq-cocina-7', 63, 'inicial')).body.fueraDeRango).toBe(false)
    const fria = await leer('maq-cocina-7', 58, 'intermedia')
    expect(fria.body).toMatchObject({ fueraDeRango: true, momento: 'intermedia', temperatura: 58 })

    // El servidor lo calcula: no confía en lo que mande el navegador.
    const r = await p.pedir<Lectura>(t, 'POST', '/lecturas', {
      maquinaId: 'maq-cocina-1', momento: 'fin', estado: 'funciona', temperatura: 9, fueraDeRango: false,
    })
    expect(r.body.fueraDeRango).toBe(true)

    const rojas = await p.pedir<Lectura[]>(admin, 'GET', '/lecturas?fueraDeRango=1')
    expect(rojas.body.map((l) => l.temperatura).sort()).toEqual([-0.5, -15, 58, 9, 9].sort())
    expect(rojas.body.every((l) => l.fueraDeRango)).toBe(true)
  })

  it('guarda la foto achicada y la devuelve para verla en el reporte (F03)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const r = await p.pedir<Lectura>(t, 'POST', '/lecturas', {
      maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3, foto: JPEG_1PX,
    })
    expect(r.status).toBe(200)
    expect(r.body.tieneFoto).toBe(true)
    const [fila] = await p.sql('SELECT foto_clave FROM lecturas WHERE id = ?', r.body.id)
    expect(fila.foto_clave).toBe(`fotos/${r.body.id}.jpg`)
    const [archivo] = await p.sql('SELECT tipo, bytes FROM archivos WHERE clave = ?', fila.foto_clave)
    expect(archivo.tipo).toBe('image/jpeg')
    const foto = await p.pedir(t, 'GET', `/lecturas/${r.body.id}/foto`)
    expect(foto.status).toBe(200)
    expect(foto.body.dataUrl).toBe(JPEG_1PX)
    // El administrador también la ve; otro sector no.
    expect((await p.pedir(await p.entrar('admin'), 'GET', `/lecturas/${r.body.id}/foto`)).body.dataUrl).toBe(JPEG_1PX)
    expect((await p.pedir(await p.entrar('chiperia'), 'GET', `/lecturas/${r.body.id}/foto`)).status).toBe(403)
  })

  it('guarda la foto en R2 cuando hay bucket', async () => {
    const guardados = new Map<string, { datos: Uint8Array; tipo?: string }>()
    const p = await nuevaPrueba({
      ARCHIVOS: {
        async put(clave, datos, opciones) {
          guardados.set(clave, { datos: datos as Uint8Array, tipo: opciones?.httpMetadata?.contentType })
        },
        async get(clave) {
          const g = guardados.get(clave)
          return g ? { arrayBuffer: async () => g.datos.slice().buffer, httpMetadata: { contentType: g.tipo } } : null
        },
        async delete(clave) {
          guardados.delete(clave)
        },
      },
    })
    const t = await p.entrar('chiperia')
    const r = await p.pedir<Lectura>(t, 'POST', '/lecturas', {
      maquinaId: 'maq-chiperia-1', momento: 'fin', estado: 'funciona', temperatura: -20, foto: JPEG_1PX,
    })
    expect(r.status).toBe(200)
    expect([...guardados.keys()]).toEqual([`fotos/${r.body.id}.jpg`])
    expect((await p.sql('SELECT COUNT(*) AS n FROM archivos'))[0].n).toBe(0)
    expect((await p.pedir(t, 'GET', `/lecturas/${r.body.id}/foto`)).body.dataUrl).toBe(JPEG_1PX)
  })

  it('rechaza fotos que no son imágenes o que pesan demasiado', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const base = { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 }
    for (const foto of ['hola', 'data:text/plain;base64,aG9sYQ==', 'data:image/gif;base64,R0lGODlh', 42]) {
      const r = await p.pedir(t, 'POST', '/lecturas', { ...base, foto })
      expect(r.status).toBe(400)
      expect(r.body.error.mensaje).toMatch(/foto/)
    }
    const grande = `data:image/jpeg;base64,${'A'.repeat(2_200_000)}`
    const r = await p.pedir(t, 'POST', '/lecturas', { ...base, foto: grande })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toMatch(/pesada/)
    // Un poco más de 1,5 MB decodificada.
    const justo = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((1.5 * 1024 * 1024 + 10) / 3) * 4)}`
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, foto: justo })).status).toBe(400)
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas'))[0].n).toBe(0)
    expect((await p.sql('SELECT COUNT(*) AS n FROM archivos'))[0].n).toBe(0)
  })

  it('guarda el mantenimiento y quién lo hizo (planilla RE-04.01)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('panaderia')
    const r = await p.pedir<Lectura>(t, 'POST', '/lecturas', {
      maquinaId: 'maq-panaderia-2', momento: 'fin', estado: 'funciona', temperatura: null,
      mantenimiento: 'Cambio de burlete', mantenimientoPor: 'Frío Sur SRL',
    })
    expect(r.body).toMatchObject({ mantenimiento: 'Cambio de burlete', mantenimientoPor: 'Frío Sur SRL' })
    const sinQue = await p.pedir(t, 'POST', '/lecturas', {
      maquinaId: 'maq-panaderia-2', momento: 'fin', estado: 'funciona', temperatura: null, mantenimientoPor: 'Juan',
    })
    expect(sinQue.status).toBe(400)
  })

  it('valida máquina, momento, estado y temperatura', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const base = { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 }
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, maquinaId: 'no-existe' })).status).toBe(404)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, maquinaId: undefined })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, momento: 'mediodia' })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, estado: 'roto' })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, temperatura: '3' })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, temperatura: 900 })).status).toBe(400)
    expect((await p.pedir(t, 'POST', '/lecturas', { ...base, observacion: 'x'.repeat(501) })).status).toBe(400)
    // Máquina dada de baja: no se puede elegir, pero su historial queda.
    await p.sql("UPDATE maquinas SET activo = 0 WHERE id = 'maq-cocina-3'")
    const baja = await p.pedir(t, 'POST', '/lecturas', { ...base, maquinaId: 'maq-cocina-3', temperatura: -20 })
    expect(baja.status).toBe(400)
    expect(baja.body.error.mensaje).toMatch(/baja/)
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas'))[0].n).toBe(0)
  })

  it('un operador solo carga y ve máquinas de su sector (A03)', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const chiperia = await p.entrar('chiperia')
    const admin = await p.entrar('admin')
    const ajena = await p.pedir(chiperia, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 })
    expect(ajena.status).toBe(403)
    await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 })
    await p.pedir(chiperia, 'POST', '/lecturas', { maquinaId: 'maq-chiperia-1', momento: 'inicio', estado: 'funciona', temperatura: -19 })
    // El administrador puede cargar en cualquier sector.
    const deAdmin = await p.pedir<Lectura>(admin, 'POST', '/lecturas', { maquinaId: 'maq-panaderia-1', momento: 'inicio', estado: 'funciona', temperatura: null })
    expect(deAdmin.body).toMatchObject({ sector: 'panaderia', usuarioNombre: 'Administración' })

    const propias = await p.pedir<Lectura[]>(chiperia, 'GET', '/lecturas')
    expect(propias.body.map((l) => l.sector)).toEqual(['chiperia'])
    expect((await p.pedir(chiperia, 'GET', '/lecturas?sector=cocina')).status).toBe(403)
    expect((await p.pedir<Lectura[]>(chiperia, 'GET', '/lecturas?maquina=maq-cocina-1')).body).toEqual([])
    expect((await p.pedir<Lectura[]>(admin, 'GET', '/lecturas')).body).toHaveLength(3)
    expect((await p.pedir<Lectura[]>(admin, 'GET', '/lecturas?sector=cocina')).body.map((l) => l.maquinaId)).toEqual(['maq-cocina-1'])
    expect((await p.pedir(admin, 'GET', '/lecturas?sector=bodega')).status).toBe(400)
    expect((await p.pedir(null, 'GET', '/lecturas')).status).toBe(401)
  })

  it('muestra el historial de la heladera con fecha, usuario, temperatura, observación y foto (F05)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    const pedir = (cuerpo: object) => p.pedir<Lectura>(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', estado: 'funciona', ...cuerpo })
    const a = await pedir({ momento: 'inicio', temperatura: 3, observacion: 'Todo bien' })
    const b = await pedir({ momento: 'fin', temperatura: 9, observacion: 'Puerta mal cerrada', foto: JPEG_1PX })
    await p.pedir(admin, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'otro', estado: 'con_fallas', temperatura: 6, observacion: 'Revisión' })
    await pedir({ maquinaId: 'maq-cocina-2', momento: 'inicio', temperatura: -20 })
    // Una lectura de hace 10 días.
    await p.sql('UPDATE lecturas SET dia = ?, fecha = ? WHERE id = ?', sumarDias(diaPY(), -10), '2020-01-01T10:00:00.000Z', a.body.id)

    const h = await p.pedir<Lectura[]>(t, 'GET', '/lecturas?maquina=maq-cocina-1')
    expect(h.body).toHaveLength(3)
    expect(h.body.every((l) => l.maquinaId === 'maq-cocina-1')).toBe(true)
    // Más nueva primero.
    expect(h.body[0].usuarioNombre).toBe('Administración')
    expect(h.body[1]).toMatchObject({
      id: b.body.id, usuarioNombre: 'Encargado Cocina', temperatura: 9, fueraDeRango: true,
      observacion: 'Puerta mal cerrada', tieneFoto: true,
    })
    expect(h.body[2].id).toBe(a.body.id)

    const hoy = diaPY()
    const deHoy = await p.pedir<Lectura[]>(t, 'GET', `/lecturas?maquina=maq-cocina-1&desde=${hoy}&hasta=${hoy}`)
    expect(deHoy.body.map((l) => l.id)).not.toContain(a.body.id)
    expect(deHoy.body).toHaveLength(2)
    const fallas = await p.pedir<Lectura[]>(admin, 'GET', '/lecturas?conFallas=1')
    expect(fallas.body.map((l) => l.observacion)).toEqual(['Revisión'])
    expect((await p.pedir(t, 'GET', '/lecturas?desde=ayer')).status).toBe(400)
  })

  it('pide la foto de una lectura que existe y la tiene', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const sin = await p.pedir<Lectura>(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 2 })
    expect((await p.pedir(t, 'GET', `/lecturas/${sin.body.id}/foto`)).status).toBe(404)
    expect((await p.pedir(t, 'GET', '/lecturas/no-existe/foto')).status).toBe(404)
  })
})
