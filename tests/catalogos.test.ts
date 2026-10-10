// B01–B04 (+ nombres de sectores): el administrador carga y edita catálogos; cada operador ve lo activo de su sector.
import { describe, expect, it } from 'vitest'
import { nuevaPrueba } from './ayuda'

describe('sectores', () => {
  it('cualquiera los lee; solo el administrador les cambia el nombre', async () => {
    const p = await nuevaPrueba()
    const op = await p.entrar('cocina')
    const admin = await p.entrar('admin')
    const lista = await p.pedir(op, 'GET', '/sectores')
    expect(lista.body.map((s: any) => s.id)).toEqual(['chiperia', 'chipitas', 'panaderia', 'cocina'])
    expect(lista.body[0]).toEqual({ id: 'chiperia', nombre: 'Chipería', conLotes: true })

    expect((await p.pedir(op, 'PATCH', '/sectores/cocina', { nombre: 'Cocina' })).status).toBe(403)
    const r = await p.pedir(admin, 'PATCH', '/sectores/cocina', { nombre: '  Cocina central ' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: 'cocina', nombre: 'Cocina central', conLotes: false })
    expect((await p.pedir(op, 'GET', '/sectores')).body.find((s: any) => s.id === 'cocina').nombre).toBe('Cocina central')
    const [aud] = await p.sql("SELECT * FROM auditoria WHERE tabla = 'sectores'")
    expect(aud).toMatchObject({ registro_id: 'cocina', accion: 'editar', usuario_id: 'usr-admin' })

    expect((await p.pedir(admin, 'PATCH', '/sectores/cocina', { nombre: '' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/sectores/chipitas', { nombre: 'cocina CENTRAL' })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/sectores/oficina', { nombre: 'Oficina' })).status).toBe(404)
  })
})

describe('productos (B01)', () => {
  it('carga un producto nuevo, le cambia el nombre y aparece así para el sector al registrar producción', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    const chipitas = await p.entrar('chipitas')

    const r = await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Hamburguesa doble' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: expect.any(String), sector: 'cocina', nombre: 'Hamburguesa doble', unidad: 'unidades', activo: true })
    const id = r.body.id

    const ren = await p.pedir(admin, 'PATCH', `/productos/${id}`, { nombre: 'Hamburguesa completa' })
    expect(ren.status).toBe(200)
    expect(ren.body.nombre).toBe('Hamburguesa completa')

    const lista = await p.pedir(cocina, 'GET', '/productos')
    expect(lista.status).toBe(200)
    expect(lista.body.every((x: any) => x.sector === 'cocina' && x.activo)).toBe(true)
    // Va al final de la lista del sector.
    expect(lista.body.at(-1)).toMatchObject({ id, nombre: 'Hamburguesa completa' })
    expect(lista.body.some((x: any) => x.nombre === 'Hamburguesa doble')).toBe(false)

    // Otro sector no lo ve (A03).
    expect((await p.pedir(chipitas, 'GET', '/productos')).body.some((x: any) => x.id === id)).toBe(false)
    expect((await p.pedir(chipitas, 'GET', '/productos?sector=cocina')).status).toBe(403)

    const acciones = (await p.sql('SELECT accion FROM auditoria WHERE registro_id = ? ORDER BY rowid', id)).map((a) => a.accion)
    expect(acciones).toEqual(['crear', 'editar'])
  })

  it('desactiva sin borrar: el operador deja de verlo y el administrador lo ve con todos=1', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    const r = await p.pedir(admin, 'PATCH', '/productos/prod-cocina-10', { activo: false })
    expect(r.body).toMatchObject({ id: 'prod-cocina-10', nombre: 'Empanada frita (carne)', activo: false })
    expect((await p.pedir(cocina, 'GET', '/productos')).body.some((x: any) => x.id === 'prod-cocina-10')).toBe(false)
    // todos=1 no cambia nada para un operador.
    expect((await p.pedir(cocina, 'GET', '/productos?todos=1')).body.some((x: any) => x.id === 'prod-cocina-10')).toBe(false)
    const todos = await p.pedir(admin, 'GET', '/productos?sector=cocina&todos=1')
    expect(todos.body.find((x: any) => x.id === 'prod-cocina-10')).toMatchObject({ activo: false })
    expect((await p.pedir(admin, 'GET', '/productos?sector=cocina')).body.some((x: any) => x.id === 'prod-cocina-10')).toBe(false)
    expect(await p.sql("SELECT id FROM productos WHERE id = 'prod-cocina-10'")).toHaveLength(1)
    const [aud] = await p.sql("SELECT accion FROM auditoria WHERE registro_id = 'prod-cocina-10'")
    expect(aud.accion).toBe('desactivar')

    expect((await p.pedir(admin, 'PATCH', '/productos/prod-cocina-10', { activo: true })).body.activo).toBe(true)
    expect((await p.pedir(cocina, 'GET', '/productos')).body.some((x: any) => x.id === 'prod-cocina-10')).toBe(true)
  })

  it('el administrador ve todos los sectores o uno; el operador solo el suyo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const todos = await p.pedir(admin, 'GET', '/productos')
    expect(new Set(todos.body.map((x: any) => x.sector))).toEqual(new Set(['chiperia', 'chipitas', 'panaderia', 'cocina']))
    const chiperia = await p.pedir(admin, 'GET', '/productos?sector=chiperia')
    expect(chiperia.body.map((x: any) => x.nombre).slice(0, 2)).toEqual(['Chipa tradicional', "Chipa so'o"])
    expect((await p.pedir(admin, 'GET', '/productos?sector=oficina')).status).toBe(400)
    const op = await p.entrar('chiperia')
    const propios = await p.pedir(op, 'GET', '/productos')
    expect(propios.body).toHaveLength(11)
    expect((await p.pedir(op, 'GET', '/productos?sector=chiperia')).status).toBe(200)
  })

  it('valida, no repite nombres en el sector y es solo para el administrador', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('cocina')
    expect((await p.pedir(op, 'POST', '/productos', { sector: 'cocina', nombre: 'Pastel' })).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/productos/prod-cocina-01', { nombre: 'Otro' })).status).toBe(403)
    expect((await p.pedir(admin, 'POST', '/productos', { nombre: 'Pastel' })).body.error.mensaje).toBe('Indicá el sector.')
    expect((await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre: ' ' })).status).toBe(400)
    const rep = await p.pedir(admin, 'POST', '/productos', { sector: 'chiperia', nombre: 'CHIPA QUESU' })
    expect(rep.status).toBe(409)
    expect(rep.body.error.mensaje).toContain('Chipa quesú')
    // El mismo nombre en otro sector sí se puede.
    expect((await p.pedir(admin, 'POST', '/productos', { sector: 'chipitas', nombre: 'Chipa quesú', unidad: 'paquetes' })).body.unidad).toBe('paquetes')
    expect((await p.pedir(admin, 'PATCH', '/productos/prod-chiperia-01', { nombre: "chipa so'o" })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/productos/prod-chiperia-01', {})).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/productos/no-existe', { nombre: 'X' })).status).toBe(404)
  })
})

describe('máquinas (B02)', () => {
  it('carga una heladera de 0 °C a 5 °C y aparece en su sector con ese rango', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/maquinas', {
      sector: 'cocina', numero: 8, nombre: 'Heladera de bebidas', tipo: 'heladera', tempMin: 0, tempMax: 5,
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      id: expect.any(String), sector: 'cocina', numero: 8, nombre: 'Heladera de bebidas', tipo: 'heladera', tempMin: 0, tempMax: 5, activo: true,
    })
    const cocina = await p.entrar('cocina')
    const lista = await p.pedir(cocina, 'GET', '/maquinas')
    expect(lista.body.find((m: any) => m.id === r.body.id)).toMatchObject({ tempMin: 0, tempMax: 5 })
    expect(lista.body.every((m: any) => m.sector === 'cocina')).toBe(true)
    expect(lista.body.map((m: any) => m.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const chiperia = await p.entrar('chiperia')
    expect((await p.pedir(chiperia, 'GET', '/maquinas')).body.some((m: any) => m.id === r.body.id)).toBe(false)
    expect((await p.pedir(chiperia, 'GET', '/maquinas?sector=cocina')).status).toBe(403)
    const [aud] = await p.sql('SELECT accion FROM auditoria WHERE registro_id = ?', r.body.id)
    expect(aud.accion).toBe('crear')
  })

  it('acepta rangos de un solo lado y "otra" sin rango; numera sola si falta el N°', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const freezer = await p.pedir(admin, 'POST', '/maquinas', { sector: 'chiperia', nombre: 'Freezer 2', tipo: 'congelador', tempMin: null, tempMax: -18 })
    expect(freezer.body).toMatchObject({ numero: 5, tempMin: null, tempMax: -18 })
    const buffet = await p.pedir(admin, 'POST', '/maquinas', { sector: 'cocina', numero: 9, nombre: 'Bufetera 2', tipo: 'exhibidora_caliente', tempMin: 63, tempMax: '' })
    expect(buffet.body).toMatchObject({ tempMin: 63, tempMax: null })
    const otra = await p.pedir(admin, 'POST', '/maquinas', { sector: 'panaderia', nombre: 'Sobadora', tipo: 'otra', tempMin: 3, tempMax: 9 })
    expect(otra.body).toMatchObject({ numero: 3, tipo: 'otra', tempMin: null, tempMax: null })
  })

  it('valida tipo, rango y número', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const base = { sector: 'cocina', nombre: 'Heladera nueva', tipo: 'heladera', tempMin: 1, tempMax: 5 }
    const casos: [Record<string, unknown>, number, RegExp][] = [
      [{ ...base, tempMin: 8 }, 400, /mínima no puede ser mayor/],
      [{ ...base, tempMin: null, tempMax: null }, 400, /Indicá la temperatura/],
      [{ ...base, tipo: 'horno' }, 400, /tipo de máquina/],
      [{ ...base, tempMax: '5' }, 400, /número/],
      [{ ...base, tempMax: 500 }, 400, /entre -60/],
      [{ ...base, numero: 0 }, 400, /N° de máquina/],
      [{ ...base, numero: 1.5 }, 400, /N° de máquina/],
      [{ ...base, nombre: '' }, 400, /nombre/],
      [{ ...base, sector: undefined }, 400, /sector/],
      [{ ...base, numero: 1 }, 409, /N° 1/],
    ]
    for (const [cuerpo, estado, mensaje] of casos) {
      const r = await p.pedir(admin, 'POST', '/maquinas', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(estado)
      expect(r.body.error.mensaje).toMatch(mensaje)
    }
    const op = await p.entrar('cocina')
    expect((await p.pedir(op, 'POST', '/maquinas', base)).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/maquinas/maq-cocina-1', { nombre: 'X' })).status).toBe(403)
  })

  it('edita: cambia un lado del rango, pasa a "otra", desactiva y libera el número', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    // Solo la mínima: la máxima queda como estaba.
    const a = await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tempMin: 0 })
    expect(a.body).toMatchObject({ tempMin: 0, tempMax: 5 })
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tempMax: -1 })).status).toBe(400)
    // Un lado vacío.
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tempMin: null })).body).toMatchObject({ tempMin: null, tempMax: 5 })
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tempMax: null })).status).toBe(400)
    // "Otra" borra el rango; volver a heladera pide rango.
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tipo: 'otra' })).body).toMatchObject({ tipo: 'otra', tempMin: null, tempMax: null })
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tipo: 'heladera' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { tipo: 'heladera', tempMin: 1, tempMax: 4 })).body)
      .toMatchObject({ tipo: 'heladera', tempMin: 1, tempMax: 4 })
    // Número repetido con otra activa.
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { numero: 2 })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-2', { activo: false })).body.activo).toBe(false)
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-1', { numero: 2, nombre: 'Heladera inox grande' })).body)
      .toMatchObject({ numero: 2, nombre: 'Heladera inox grande' })
    // Reactivar la vieja N° 2 choca con la nueva N° 2.
    expect((await p.pedir(admin, 'PATCH', '/maquinas/maq-cocina-2', { activo: true })).status).toBe(409)

    const cocina = await p.entrar('cocina')
    const ids = (await p.pedir(cocina, 'GET', '/maquinas')).body.map((m: any) => m.id)
    expect(ids).not.toContain('maq-cocina-2')
    const todos = (await p.pedir(admin, 'GET', '/maquinas?sector=cocina&todos=1')).body
    expect(todos.find((m: any) => m.id === 'maq-cocina-2')).toMatchObject({ activo: false })
    expect((await p.pedir(admin, 'PATCH', '/maquinas/no-existe', { nombre: 'X' })).status).toBe(404)
    const acciones = (await p.sql("SELECT accion FROM auditoria WHERE registro_id = 'maq-cocina-2'")).map((x) => x.accion)
    expect(acciones).toEqual(['desactivar'])
  })
})

describe('áreas y tareas de limpieza (B03)', () => {
  it('agrega una tarea y aparece en la lista del área al reportar una limpieza', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/areas/cocina/tareas', { nombre: 'Hojas de la ventana', pideNumero: false })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: expect.any(String), areaId: 'cocina', nombre: 'Hojas de la ventana', pideNumero: false, activo: true })
    const freidora = await p.pedir(admin, 'POST', '/areas/cocina/tareas', { nombre: 'Freidora chica', pideNumero: true })
    expect(freidora.body.pideNumero).toBe(true)

    const cocina = await p.entrar('cocina')
    const areas = (await p.pedir(cocina, 'GET', '/areas')).body
    expect(areas.every((a: any) => a.sectores.includes('cocina') && a.activo)).toBe(true)
    const area = areas.find((a: any) => a.id === 'cocina')
    expect(area).toMatchObject({ nombre: 'Cocina', codigo: 'RE-09.03', sectores: ['cocina'] })
    expect(area.tareas[0].nombre).toBe('Techo')
    expect(area.tareas.slice(-2).map((t: any) => [t.nombre, t.pideNumero])).toEqual([['Hojas de la ventana', false], ['Freidora chica', true]])
    expect(area.tareas.find((t: any) => t.nombre === 'Freezer').pideNumero).toBe(true)

    // Chipería no ve el área de Cocina.
    const chiperia = await p.entrar('chiperia')
    const suyas = (await p.pedir(chiperia, 'GET', '/areas')).body.map((a: any) => a.id)
    expect(suyas).not.toContain('cocina')
    expect(suyas).toEqual(['chiperia', 'sanitario', 'deposito-mp'])
    expect((await p.pedir(chiperia, 'GET', '/areas?sector=cocina')).status).toBe(403)
    const [aud] = await p.sql('SELECT accion, tabla FROM auditoria WHERE registro_id = ?', r.body.id)
    expect(aud).toEqual({ accion: 'crear', tabla: 'tareas_limpieza' })
  })

  it('el área común la ven todos los sectores que la cargan', async () => {
    const p = await nuevaPrueba()
    for (const u of ['chiperia', 'chipitas', 'panaderia', 'cocina']) {
      const t = await p.entrar(u)
      const ids = (await p.pedir(t, 'GET', '/areas')).body.map((a: any) => a.id)
      expect(ids, u).toContain('sanitario')
    }
    const admin = await p.entrar('admin')
    const todas = (await p.pedir(admin, 'GET', '/areas')).body
    expect(todas.find((a: any) => a.id === 'sanitario').sectores).toEqual(['chiperia', 'chipitas', 'panaderia', 'cocina'])
    expect(todas).toHaveLength(10)
  })

  it('crea un área con varios sectores, le cambia sectores y nombre, y la desactiva', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/areas', { nombre: 'Vestuario', codigo: 'RE-09.10', sectores: ['panaderia', 'chipitas', 'chipitas'] })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: expect.any(String), nombre: 'Vestuario', codigo: 'RE-09.10', sectores: ['chipitas', 'panaderia'], activo: true, tareas: [] })
    const id = r.body.id
    await p.pedir(admin, 'POST', `/areas/${id}/tareas`, { nombre: 'Piso' })
    await p.pedir(admin, 'POST', `/areas/${id}/tareas`, { nombre: 'Lockers' })

    const panaderia = await p.entrar('panaderia')
    const chiperia = await p.entrar('chiperia')
    const ver = async (t: string) => (await p.pedir(t, 'GET', '/areas')).body.find((a: any) => a.id === id)
    expect((await ver(panaderia)).tareas.map((t: any) => t.nombre)).toEqual(['Piso', 'Lockers'])
    expect(await ver(chiperia)).toBeUndefined()

    const e = await p.pedir(admin, 'PATCH', `/areas/${id}`, { nombre: 'Vestuario del personal', sectores: ['chiperia'] })
    expect(e.status).toBe(200)
    expect(e.body).toMatchObject({ nombre: 'Vestuario del personal', sectores: ['chiperia'], codigo: 'RE-09.10' })
    expect(e.body.tareas).toHaveLength(2)
    expect(await ver(panaderia)).toBeUndefined()
    expect((await ver(chiperia)).nombre).toBe('Vestuario del personal')

    expect((await p.pedir(admin, 'PATCH', `/areas/${id}`, { activo: false })).body.activo).toBe(false)
    expect(await ver(chiperia)).toBeUndefined()
    expect((await p.pedir(admin, 'GET', '/areas?sector=chiperia&todos=1')).body.find((a: any) => a.id === id)).toMatchObject({ activo: false })
    expect((await p.pedir(admin, 'GET', '/areas?sector=chiperia')).body.some((a: any) => a.id === id)).toBe(false)
    const acciones = (await p.sql('SELECT accion FROM auditoria WHERE registro_id = ? ORDER BY rowid', id)).map((x) => x.accion)
    expect(acciones).toEqual(['crear', 'editar', 'desactivar'])
  })

  it('edita y desactiva tareas sin borrarlas', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = 'tarea-lavadero-05'
    expect((await p.pedir(admin, 'PATCH', `/tareas/${t}`, { pideNumero: false, nombre: 'Pileta grande' })).body)
      .toEqual({ id: t, areaId: 'lavadero', nombre: 'Pileta grande', pideNumero: false, activo: true })
    expect((await p.pedir(admin, 'PATCH', `/tareas/${t}`, { activo: false })).body.activo).toBe(false)
    const cocina = await p.entrar('cocina')
    const lavadero = (await p.pedir(cocina, 'GET', '/areas')).body.find((a: any) => a.id === 'lavadero')
    expect(lavadero.tareas.some((x: any) => x.id === t)).toBe(false)
    expect((await p.pedir(cocina, 'GET', '/areas?todos=1')).body.find((a: any) => a.id === 'lavadero').tareas.some((x: any) => x.id === t)).toBe(false)
    const todas = (await p.pedir(admin, 'GET', '/areas?todos=1')).body.find((a: any) => a.id === 'lavadero')
    expect(todas.tareas.find((x: any) => x.id === t)).toMatchObject({ activo: false, nombre: 'Pileta grande' })
    expect(await p.sql('SELECT id FROM tareas_limpieza WHERE id = ?', t)).toHaveLength(1)
  })

  it('valida áreas y tareas y es solo para el administrador', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('cocina')
    expect((await p.pedir(op, 'POST', '/areas', { nombre: 'X', sectores: ['cocina'] })).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/areas/cocina', { nombre: 'X' })).status).toBe(403)
    expect((await p.pedir(op, 'POST', '/areas/cocina/tareas', { nombre: 'X' })).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/tareas/tarea-cocina-01', { nombre: 'X' })).status).toBe(403)

    const sinSector = await p.pedir(admin, 'POST', '/areas', { nombre: 'Patio', sectores: [] })
    expect(sinSector.status).toBe(400)
    expect(sinSector.body.error.mensaje).toMatch(/al menos un sector/)
    expect((await p.pedir(admin, 'POST', '/areas', { nombre: 'Patio', sectores: ['oficina'] })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/areas', { nombre: 'sanitario', sectores: ['cocina'] })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/areas/cocina', { sectores: [] })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/areas/cocina', {})).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/areas/cocina/tareas', { nombre: 'piso' })).status).toBe(409)
    expect((await p.pedir(admin, 'POST', '/areas/cocina/tareas', { nombre: '' })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/areas/cocina/tareas', { nombre: 'Algo', pideNumero: 'si' })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/areas/no-existe/tareas', { nombre: 'Algo' })).status).toBe(404)
    expect((await p.pedir(admin, 'PATCH', '/areas/no-existe', { nombre: 'Algo' })).status).toBe(404)
    expect((await p.pedir(admin, 'PATCH', '/tareas/no-existe', { nombre: 'Algo' })).status).toBe(404)
    // La misma tarea en otra área sí se puede.
    expect((await p.pedir(admin, 'POST', '/areas/buffet/tareas', { nombre: 'Azulejos' })).status).toBe(200)
  })
})

describe('sucursales (B04)', () => {
  it('agrega una sucursal y aparece como destino para todos los sectores', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/sucursales', { nombre: 'Sucursal Luque' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: expect.any(String), nombre: 'Sucursal Luque', activo: true })
    for (const u of ['chiperia', 'cocina']) {
      const t = await p.entrar(u)
      const lista = (await p.pedir(t, 'GET', '/sucursales')).body
      expect(lista.map((s: any) => s.nombre)).toContain('Sucursal Luque')
      expect(lista).toHaveLength(4)
    }
    const [aud] = await p.sql('SELECT accion FROM auditoria WHERE registro_id = ?', r.body.id)
    expect(aud.accion).toBe('crear')
  })

  it('renombra y desactiva: deja de ser destino pero no se borra', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('chipitas')
    expect((await p.pedir(admin, 'PATCH', '/sucursales/suc-ruta1', { nombre: 'Sucursal Ruta 1' })).body.nombre).toBe('Sucursal Ruta 1')
    expect((await p.pedir(admin, 'PATCH', '/sucursales/suc-ruta1', { activo: false })).body.activo).toBe(false)
    expect((await p.pedir(op, 'GET', '/sucursales')).body.map((s: any) => s.id)).not.toContain('suc-ruta1')
    expect((await p.pedir(op, 'GET', '/sucursales?todos=1')).body.map((s: any) => s.id)).not.toContain('suc-ruta1')
    const todas = (await p.pedir(admin, 'GET', '/sucursales?todos=1')).body
    expect(todas.find((s: any) => s.id === 'suc-ruta1')).toMatchObject({ nombre: 'Sucursal Ruta 1', activo: false })
    const acciones = (await p.sql("SELECT accion FROM auditoria WHERE registro_id = 'suc-ruta1' ORDER BY rowid")).map((x) => x.accion)
    expect(acciones).toEqual(['editar', 'desactivar'])
  })

  it('valida, no repite nombres y es solo para el administrador', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('cocina')
    expect((await p.pedir(op, 'POST', '/sucursales', { nombre: 'X' })).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/sucursales/suc-centro', { activo: false })).status).toBe(403)
    expect((await p.pedir(admin, 'POST', '/sucursales', { nombre: '' })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/sucursales', { nombre: 'sucursal centro (EJEMPLO)' })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/sucursales/suc-centro', { nombre: 'Sucursal Ruta 1 (ejemplo)' })).status).toBe(409)
    expect((await p.pedir(admin, 'PATCH', '/sucursales/suc-centro', {})).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/sucursales/no-existe', { nombre: 'X' })).status).toBe(404)
  })
})
