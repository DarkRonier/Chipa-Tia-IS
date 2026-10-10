// A01, A02, A04: entrar, contraseña guardada con hash, usuarios desactivados.
import { describe, expect, it } from 'vitest'
import { nuevaPrueba } from './ayuda'

describe('autenticación', () => {
  it('entra con usuario y contraseña y devuelve el usuario', async () => {
    const p = await nuevaPrueba()
    const r = await p.pedir(null, 'POST', '/auth/login', { usuario: 'Cocina', clave: '1234' })
    expect(r.status).toBe(200)
    expect(r.body.usuario).toMatchObject({ usuario: 'cocina', rol: 'cocina', activo: true })
    const yo = await p.pedir(r.body.token, 'GET', '/auth/yo')
    expect(yo.body.usuario).toBe('cocina')
  })

  it('rechaza contraseña incorrecta y usuario inexistente con el mismo mensaje', async () => {
    const p = await nuevaPrueba()
    const a = await p.pedir(null, 'POST', '/auth/login', { usuario: 'cocina', clave: 'mal' })
    const b = await p.pedir(null, 'POST', '/auth/login', { usuario: 'nadie', clave: '1234' })
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.body.error.mensaje).toBe(b.body.error.mensaje)
  })

  it('guarda la contraseña con hash, nunca en texto plano (A02)', async () => {
    const p = await nuevaPrueba()
    const [u] = await p.sql('SELECT clave_hash FROM usuarios WHERE usuario = ?', 'admin')
    expect(u.clave_hash).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(u.clave_hash).not.toContain('1234')
  })

  it('pide sesión para la API y la cierra al salir', async () => {
    const p = await nuevaPrueba()
    expect((await p.pedir(null, 'GET', '/auth/yo')).status).toBe(401)
    expect((await p.pedir('token-falso', 'GET', '/sectores')).status).toBe(401)
    const t = await p.entrar('admin')
    expect((await p.pedir(t, 'POST', '/auth/logout')).status).toBe(200)
    expect((await p.pedir(t, 'GET', '/auth/yo')).status).toBe(401)
  })

  it('el administrador cambia su propia contraseña y cierra las otras sesiones', async () => {
    const p = await nuevaPrueba()
    const vieja = await p.entrar('admin')
    const r = await p.pedir(vieja, 'POST', '/auth/clave', { actual: '1234', nueva: 'admin-nueva' })
    expect(r.status).toBe(200)
    expect((await p.pedir(vieja, 'GET', '/auth/yo')).status).toBe(401)
    expect((await p.pedir(r.body.token, 'GET', '/auth/yo')).status).toBe(200)
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: 'admin', clave: '1234' })).status).toBe(401)
    await p.entrar('admin', 'admin-nueva')
  })

  it('un operador no puede cambiar su contraseña: la cambia el administrador', async () => {
    const p = await nuevaPrueba()
    for (const u of ['chiperia', 'chipitas', 'panaderia', 'cocina']) {
      const t = await p.entrar(u)
      const r = await p.pedir(t, 'POST', '/auth/clave', { actual: '1234', nueva: 'otra-clave' })
      expect(r.status, u).toBe(403)
      expect(r.body.error.mensaje).toBe('Tu contraseña la cambia el administrador.')
      expect((await p.pedir(t, 'GET', '/auth/yo')).status).toBe(200)
      await p.entrar(u, '1234')
    }
  })
})
