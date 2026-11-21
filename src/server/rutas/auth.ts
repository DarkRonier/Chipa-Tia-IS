// A01: entrar con usuario y contraseña; cambiar la propia contraseña.
import { Hono } from 'hono'
import type { RespuestaLogin } from '../../shared/tipos'
import { CLAVE_MINIMA, HASH_DE_RELLENO, hashClave, verificarClave } from '../clave'
import { ejecutar, una } from '../db'
import type { Entorno } from '../entorno'
import { ErrorApi, invalido, prohibido } from '../errores'
import { aUsuario, COLUMNAS_USUARIO, type FilaUsuario } from '../mapeo'
import { cerrarSesion, cerrarSesionesDe, conSesion, crearSesion, MINUTOS_SUPER, tokenDe } from '../sesion'
import { sha256 } from '../clave'
import { cuerpo, texto } from '../validar'

export const rutasAuth = new Hono<Entorno>()

rutasAuth.post('/login', async (c) => {
  const b = await cuerpo(c)
  const usuario = texto(b.usuario, 'el usuario', { max: 60 }).toLowerCase()
  // La contraseña no se recorta: la que se guardó es la que se escribe.
  const clave = texto(b.clave, 'la contraseña', { max: 200, recortar: false })
  const fila = await una<FilaUsuario & { clave_hash: string }>(
    c.env.DB, `SELECT ${COLUMNAS_USUARIO}, clave_hash FROM usuarios WHERE usuario = ?`, usuario,
  )
  // Mismo mensaje y mismo tiempo si el usuario no existe o la contraseña está mal.
  const ok = (await verificarClave(clave, fila?.clave_hash ?? HASH_DE_RELLENO)) && !!fila
  if (!fila || !ok) throw new ErrorApi(401, 'credenciales', 'Usuario o contraseña incorrectos.')
  if (!fila.activo) throw new ErrorApi(403, 'usuario_inactivo', 'Este usuario está desactivado. Hablá con el administrador.')
  const token = await crearSesion(c.env.DB, fila.id)
  return c.json<RespuestaLogin>({ token, usuario: aUsuario(fila) })
})

rutasAuth.use('/yo', conSesion)
rutasAuth.get('/yo', async (c) => {
  const fila = await una<FilaUsuario>(c.env.DB, `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE id = ?`, c.get('usuario').id)
  return c.json({ ...aUsuario(fila!), superHasta: c.get('usuario').superHasta })
})

// Modo super-administrador: el administrador lo activa con su contraseña, por MINUTOS_SUPER minutos, solo en esta sesión.
rutasAuth.use('/super', conSesion)
rutasAuth.post('/super', async (c) => {
  const u = c.get('usuario')
  if (u.rol !== 'admin') throw prohibido('Solo un administrador puede activar el modo super-administrador.')
  const b = await cuerpo(c)
  const clave = texto(b.clave, 'tu contraseña', { max: 200, recortar: false })
  const fila = await una<{ clave_hash: string }>(c.env.DB, 'SELECT clave_hash FROM usuarios WHERE id = ?', u.id)
  if (!fila || !(await verificarClave(clave, fila.clave_hash))) throw invalido('La contraseña no es correcta.')
  const superHasta = new Date(Date.now() + MINUTOS_SUPER * 60_000).toISOString()
  await ejecutar(c.env.DB, 'UPDATE sesiones SET super_hasta = ? WHERE token_hash = ?', superHasta, await sha256(tokenDe(c)!))
  return c.json({ superHasta })
})

rutasAuth.use('/super/salir', conSesion)
rutasAuth.post('/super/salir', async (c) => {
  await ejecutar(c.env.DB, 'UPDATE sesiones SET super_hasta = NULL WHERE token_hash = ?', await sha256(tokenDe(c)!))
  return c.json({ superHasta: null })
})

rutasAuth.use('/logout', conSesion)
rutasAuth.post('/logout', async (c) => {
  await cerrarSesion(c.env.DB, tokenDe(c)!)
  return c.json({ ok: true })
})

rutasAuth.use('/clave', conSesion)
rutasAuth.post('/clave', async (c) => {
  const b = await cuerpo(c)
  const u = c.get('usuario')
  // Solo el administrador cambia contraseñas; a los operadores se las pone y restablece él (Usuarios).
  if (u.rol !== 'admin') throw prohibido('Tu contraseña la cambia el administrador.')
  const actual = texto(b.actual, 'la contraseña actual', { max: 200, recortar: false })
  // Sin recortar: la nueva se valida como se va a guardar. Los espacios de los bordes se rechazan antes del largo.
  const nueva = texto(b.nueva, 'la contraseña nueva', { min: 0, max: 200, recortar: false })
  if (/^\s|\s$/.test(nueva)) throw invalido('La contraseña no puede empezar ni terminar con espacios.')
  if (nueva.length < CLAVE_MINIMA) throw invalido(`La contraseña nueva tiene que tener al menos ${CLAVE_MINIMA} caracteres.`)
  const fila = await una<{ clave_hash: string }>(c.env.DB, 'SELECT clave_hash FROM usuarios WHERE id = ?', u.id)
  if (!fila || !(await verificarClave(actual, fila.clave_hash))) throw invalido('La contraseña actual no es correcta.')
  if (actual === nueva) throw invalido('La contraseña nueva tiene que ser distinta de la actual.')
  await ejecutar(c.env.DB, 'UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = 0 WHERE id = ?', await hashClave(nueva), u.id)
  // Cierra las otras sesiones y abre una nueva para este dispositivo.
  await cerrarSesionesDe(c.env.DB, u.id)
  const token = await crearSesion(c.env.DB, u.id)
  return c.json({ token })
})
