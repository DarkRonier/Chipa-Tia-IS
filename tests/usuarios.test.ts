// A01–A04: usuarios y accesos. Solo el administrador gestiona usuarios; nada se borra.
import { describe, expect, it } from 'vitest'
import { hashClave } from '../src/server/clave'
import { nuevaPrueba } from './ayuda'

const nuevo = { nombre: 'Rosa Benítez', usuario: 'Rosa.B', rol: 'cocina', clave: 'empanada1' }

describe('usuarios', () => {
  it('lista los usuarios con los 5 roles: 4 sectores y el administrador (A02)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'GET', '/usuarios')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(5)
    expect(new Set(r.body.map((u: any) => u.rol))).toEqual(new Set(['chiperia', 'chipitas', 'panaderia', 'cocina', 'admin']))
    expect(r.body[0]).toEqual({
      id: expect.any(String), nombre: expect.any(String), usuario: expect.any(String), rol: expect.any(String),
      activo: true, debeCambiarClave: false, creadoEn: expect.any(String),
    })
    expect(JSON.stringify(r.body)).not.toContain('pbkdf2')
  })

  it('solo el administrador ve y cambia usuarios', async () => {
    const p = await nuevaPrueba()
    const op = await p.entrar('chiperia')
    expect((await p.pedir(op, 'GET', '/usuarios')).status).toBe(403)
    expect((await p.pedir(op, 'POST', '/usuarios', nuevo)).status).toBe(403)
    expect((await p.pedir(op, 'PATCH', '/usuarios/usr-cocina', { activo: false })).status).toBe(403)
    expect((await p.pedir(op, 'POST', '/usuarios/usr-cocina/clave', { clave: 'nueva123' })).status).toBe(403)
    expect((await p.pedir(null, 'GET', '/usuarios')).status).toBe(401)
    const [u] = await p.sql('SELECT activo FROM usuarios WHERE id = ?', 'usr-cocina')
    expect(u.activo).toBe(1)
  })

  it('crea un usuario en minúsculas que entra con la contraseña que le puso el administrador (A01, A04)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/usuarios', nuevo)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ nombre: 'Rosa Benítez', usuario: 'rosa.b', rol: 'cocina', activo: true, debeCambiarClave: false })
    const [fila] = await p.sql('SELECT clave_hash FROM usuarios WHERE id = ?', r.body.id)
    expect(fila.clave_hash).toMatch(/^pbkdf2\$/)

    // Entra con su contraseña inicial (sin importar mayúsculas en el usuario) y la usa: solo el administrador cambia contraseñas.
    const login = await p.pedir(null, 'POST', '/auth/login', { usuario: 'ROSA.B', clave: 'empanada1' })
    expect(login.status).toBe(200)
    expect(login.body.usuario.debeCambiarClave).toBe(false)
    expect((await p.pedir(login.body.token, 'GET', '/stock?sector=cocina')).status).toBe(200)
    const cambio = await p.pedir(login.body.token, 'POST', '/auth/clave', { actual: 'empanada1', nueva: 'mia-propia' })
    expect(cambio.status).toBe(403)
    expect(cambio.body.error).toEqual({ codigo: 'prohibido', mensaje: 'Tu contraseña la cambia el administrador.' })
    await p.entrar('rosa.b', 'empanada1')

    // Un administrador nuevo sí elige la suya al entrar.
    const otroAdmin = await p.pedir(admin, 'POST', '/usuarios', { nombre: 'Ana Admin', usuario: 'ana', rol: 'admin', clave: 'inicial1' })
    expect(otroAdmin.body.debeCambiarClave).toBe(true)

    const [aud] = await p.sql("SELECT * FROM auditoria WHERE tabla = 'usuarios' AND registro_id = ?", r.body.id)
    expect(aud).toMatchObject({ accion: 'crear', usuario_id: 'usr-admin' })
    expect(aud.despues).not.toContain('empanada1')
  })

  it('no repite usuarios: 409 usuario_repetido', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/usuarios', { ...nuevo, usuario: 'Cocina' })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('usuario_repetido')
    expect(r.body.error.mensaje).toContain('cocina')
  })

  it('valida los datos del usuario nuevo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ ...nuevo, clave: '12345' }, /al menos 6/],
      [{ ...nuevo, clave: '' }, /contraseña/],
      [{ ...nuevo, rol: 'gerente' }, /rol/],
      [{ ...nuevo, rol: undefined }, /rol/],
      [{ ...nuevo, usuario: 'rosa benitez' }, /espacios/],
      [{ ...nuevo, usuario: '' }, /usuario/],
      [{ ...nuevo, usuario: 'r' }, /entre 2 y 40/],
      [{ ...nuevo, nombre: '   ' }, /nombre/],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await p.pedir(admin, 'POST', '/usuarios', cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error.codigo).toBe('datos_invalidos')
      expect(r.body.error.mensaje).toMatch(mensaje)
    }
    expect(await p.sql('SELECT id FROM usuarios')).toHaveLength(5)
  })

  it('un usuario desactivado no puede entrar y pierde su sesión; reactivado vuelve a entrar (A04)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('chipitas')
    const r = await p.pedir(admin, 'PATCH', '/usuarios/usr-chipitas', { activo: false })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ usuario: 'chipitas', activo: false })
    expect((await p.pedir(op, 'GET', '/auth/yo')).status).toBe(401)
    expect(await p.sql('SELECT * FROM sesiones WHERE usuario_id = ?', 'usr-chipitas')).toHaveLength(0)
    const login = await p.pedir(null, 'POST', '/auth/login', { usuario: 'chipitas', clave: '1234' })
    expect(login.status).toBe(403)
    expect(login.body.error.codigo).toBe('usuario_inactivo')
    // Sigue en la lista (nada se borra).
    const lista = await p.pedir(admin, 'GET', '/usuarios')
    expect(lista.body.find((u: any) => u.id === 'usr-chipitas')).toMatchObject({ activo: false })
    expect(lista.body.at(-1).id).toBe('usr-chipitas')

    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-chipitas', { activo: true })).body.activo).toBe(true)
    await p.entrar('chipitas')
    const acciones = (await p.sql("SELECT accion FROM auditoria WHERE registro_id = 'usr-chipitas' ORDER BY rowid")).map((a) => a.accion)
    expect(acciones).toEqual(['desactivar', 'activar'])
  })

  it('restablece la contraseña: la nueva funciona, la vieja no, y cierra sus sesiones (A04)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('panaderia')
    const r = await p.pedir(admin, 'POST', '/usuarios/usr-panaderia/clave', { clave: 'temporal9' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true })
    expect((await p.pedir(op, 'GET', '/auth/yo')).status).toBe(401)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'panaderia', clave: '1234' })).status).toBe(401)
    const login = await p.pedir(null, 'POST', '/auth/login', { usuario: 'panaderia', clave: 'temporal9' })
    expect(login.status).toBe(200)
    expect(login.body.usuario.debeCambiarClave).toBe(false)
    const [aud] = await p.sql("SELECT * FROM auditoria WHERE registro_id = 'usr-panaderia'")
    expect(aud.accion).toBe('restablecer_clave')
    expect(`${aud.antes}${aud.despues}`).not.toMatch(/temporal9|pbkdf2/)

    const corta = await p.pedir(admin, 'POST', '/usuarios/usr-panaderia/clave', { clave: '123' })
    expect(corta.status).toBe(400)
    expect(corta.body.error.mensaje).toMatch(/al menos 6/)
    expect((await p.pedir(admin, 'POST', '/usuarios/no-existe/clave', { clave: 'temporal9' })).status).toBe(404)
  })

  it('el administrador no puede desactivarse, quitarse el rol ni restablecer su propia contraseña acá', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const a = await p.pedir(admin, 'PATCH', '/usuarios/usr-admin', { activo: false })
    expect(a.status).toBe(403)
    expect(a.body.error.mensaje).toMatch(/propio usuario/)
    const b = await p.pedir(admin, 'PATCH', '/usuarios/usr-admin', { rol: 'cocina' })
    expect(b.status).toBe(403)
    expect(b.body.error.mensaje).toMatch(/rol de administrador/)
    expect((await p.pedir(admin, 'POST', '/usuarios/usr-admin/clave', { clave: 'nueva-clave' })).status).toBe(400)
    // Su nombre sí lo puede cambiar.
    const c = await p.pedir(admin, 'PATCH', '/usuarios/usr-admin', { nombre: 'Doña Tía' })
    expect(c.status).toBe(200)
    expect(c.body).toMatchObject({ nombre: 'Doña Tía', rol: 'admin', activo: true })
    expect((await p.pedir(admin, 'GET', '/auth/yo')).status).toBe(200)
  })

  it('cambia nombre y rol: el usuario vuelve a entrar y pasa a ver solo su nuevo sector (A03)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const viejo = await p.entrar('chipitas')
    const r = await p.pedir(admin, 'PATCH', '/usuarios/usr-chipitas', { nombre: 'Juan Chipitas', rol: 'panaderia' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ nombre: 'Juan Chipitas', rol: 'panaderia', activo: true })
    expect((await p.pedir(viejo, 'GET', '/auth/yo')).status).toBe(401)
    const t = await p.entrar('chipitas')
    const productos = await p.pedir(t, 'GET', '/productos')
    expect(productos.body.length).toBeGreaterThan(0)
    expect(productos.body.every((x: any) => x.sector === 'panaderia')).toBe(true)
    expect((await p.pedir(t, 'GET', '/productos?sector=chipitas')).status).toBe(403)
    const [aud] = await p.sql("SELECT * FROM auditoria WHERE registro_id = 'usr-chipitas'")
    expect(aud.accion).toBe('editar')
    expect(JSON.parse(aud.antes).rol).toBe('chipitas')
    expect(JSON.parse(aud.despues).rol).toBe('panaderia')
  })

  it('valida los cambios y responde 404 si el usuario no existe', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'PATCH', '/usuarios/no-existe', { nombre: 'X' })).status).toBe(404)
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', {})).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', { rol: 'jefe' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', { activo: 'no' })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', { nombre: '' })).status).toBe(400)
    // Otro administrador sí puede pasar a ser operador.
    const otro = await p.pedir(admin, 'POST', '/usuarios', { nombre: 'Otra admin', usuario: 'admin2', rol: 'admin', clave: 'segura123' })
    expect((await p.pedir(admin, 'PATCH', `/usuarios/${otro.body.id}`, { rol: 'chiperia' })).body.rol).toBe('chiperia')
  })

  it('rechaza contraseñas con espacios al principio o al final al crear, restablecer y cambiar la propia (T8)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const op = await p.entrar('panaderia')
    const msg = 'La contraseña no puede empezar ni terminar con espacios.'
    for (const clave of [' empanada1', 'empanada1 ', '   ', ' ab']) {
      const crear = await p.pedir(admin, 'POST', '/usuarios', { ...nuevo, clave })
      expect(crear.status, JSON.stringify(clave)).toBe(400)
      expect(crear.body.error).toEqual({ codigo: 'datos_invalidos', mensaje: msg })
    }
    expect(await p.sql("SELECT id FROM usuarios WHERE usuario = 'rosa.b'")).toHaveLength(0)

    const reset = await p.pedir(admin, 'POST', '/usuarios/usr-panaderia/clave', { clave: ' temporal9' })
    expect(reset.status).toBe(400)
    expect(reset.body.error).toEqual({ codigo: 'datos_invalidos', mensaje: msg })
    expect((await p.pedir(op, 'GET', '/auth/yo')).status).toBe(200)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'panaderia', clave: '1234' })).status).toBe(200)

    const cambio = await p.pedir(admin, 'POST', '/auth/clave', { actual: '1234', nueva: ' pan-nuevo' })
    expect(cambio.status).toBe(400)
    expect(cambio.body.error).toEqual({ codigo: 'datos_invalidos', mensaje: msg })
    const cambio2 = await p.pedir(admin, 'POST', '/auth/clave', { actual: '1234', nueva: 'pan-nuevo ' })
    expect(cambio2.status).toBe(400)
    expect(cambio2.body.error.mensaje).toBe(msg)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'admin', clave: '1234' })).status).toBe(200)
  })

  it('no recorta la contraseña al entrar ni al verificar la actual, pero sí el usuario (T8)', async () => {
    const p = await nuevaPrueba()
    // Una contraseña con espacios de los bordes guardada antes de esta regla.
    await p.sql('UPDATE usuarios SET clave_hash = ? WHERE id = ?', await hashClave(' espacio '), 'usr-admin')
    const sinRecortar = await p.pedir(null, 'POST', '/auth/login', { usuario: 'admin', clave: ' espacio ' })
    expect(sinRecortar.status).toBe(200)
    expect(sinRecortar.body.usuario.usuario).toBe('admin')
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'admin', clave: 'espacio' })).status).toBe(401)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'admin', clave: 'espacio ' })).status).toBe(401)
    // El usuario sí se recorta.
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: '  Admin ', clave: ' espacio ' })).status).toBe(200)

    const cambio = await p.pedir(sinRecortar.body.token, 'POST', '/auth/clave', { actual: ' espacio ', nueva: 'pan-nuevo' })
    expect(cambio.status).toBe(200)
  })

  it('una contraseña con un espacio en el medio se crea, se restablece y entra (T8)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const creado = await p.pedir(admin, 'POST', '/usuarios', { ...nuevo, rol: 'admin', clave: 'hola mundo' })
    expect(creado.status).toBe(200)
    const login = await p.pedir(null, 'POST', '/auth/login', { usuario: 'rosa.b', clave: 'hola mundo' })
    expect(login.status).toBe(200)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'rosa.b', clave: 'holamundo' })).status).toBe(401)

    const reset = await p.pedir(admin, 'POST', '/usuarios/usr-panaderia/clave', { clave: 'pan dulce' })
    expect(reset.status).toBe(200)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'panaderia', clave: 'pan dulce' })).status).toBe(200)

    const cambio = await p.pedir(login.body.token, 'POST', '/auth/clave', { actual: 'hola mundo', nueva: 'la casa grande' })
    expect(cambio.status).toBe(200)
    await p.entrar('rosa.b', 'la casa grande')
  })
})
