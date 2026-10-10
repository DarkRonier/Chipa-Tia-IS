// A01–A04: el administrador crea usuarios, les cambia nombre y rol, los desactiva y les restablece la contraseña.
// Nada se borra: un usuario desactivado no puede entrar y el historial lo sigue mostrando por nombre.
import { Hono } from 'hono'
import type { Rol, Usuario } from '../../shared/tipos'
import { ROLES } from '../../shared/tipos'
import { sentenciaAuditoria } from '../auditoria'
import { CLAVE_MINIMA, hashClave } from '../clave'
import { ahora, nuevoId, sentencia, todas, una } from '../db'
import type { BaseD1, Entorno, SentenciaD1 } from '../entorno'
import { conflicto, invalido, noEncontrado, prohibido } from '../errores'
import { aUsuario, COLUMNAS_USUARIO, type FilaUsuario } from '../mapeo'
import { soloAdmin } from '../sesion'
import { booleano, cuerpo, texto } from '../validar'

export const rutasUsuarios = new Hono<Entorno>()

/** Letras minúsculas (con tildes y ñ), números, punto, guion y guion bajo; sin espacios. */
const FORMATO_USUARIO = /^[\p{Ll}\p{N}._-]{2,40}$/u

function nombreUsuario(v: unknown): string {
  const u = texto(v, 'el usuario', { max: 40 }).toLowerCase()
  if (/\s/.test(u)) throw invalido('El usuario no puede tener espacios.')
  if (!FORMATO_USUARIO.test(u)) throw invalido('El usuario tiene que tener entre 2 y 40 letras o números (se permiten punto y guion).')
  return u
}

function rol(v: unknown): Rol {
  if (typeof v !== 'string' || !(ROLES as string[]).includes(v)) throw invalido('Elegí el rol.')
  return v as Rol
}

/** Espacios al principio o al final: la entrada no los recorta, así que una contraseña así nunca funcionaría. */
const BORDE_ESPACIO = /^\s|\s$/

/**
 * Solo el administrador cambia contraseñas: los operadores entran con la que les pone el administrador y no la
 * cambian. Por eso solo a un administrador nuevo o restablecido se le pide que elija la suya al entrar.
 */
const debeCambiar = (r: Rol) => r === 'admin'

function clave(v: unknown): string {
  if (typeof v !== 'string' || !v) throw invalido('Escribí la contraseña.')
  if (BORDE_ESPACIO.test(v)) throw invalido('La contraseña no puede empezar ni terminar con espacios.')
  if (v.length < CLAVE_MINIMA) throw invalido(`La contraseña tiene que tener al menos ${CLAVE_MINIMA} caracteres.`)
  if (v.length > 200) throw invalido('La contraseña es demasiado larga.')
  return v
}

async function leerUsuario(db: BaseD1, id: string): Promise<Usuario> {
  const fila = await una<FilaUsuario>(db, `SELECT ${COLUMNAS_USUARIO} FROM usuarios WHERE id = ?`, id)
  if (!fila) throw noEncontrado('No se encontró ese usuario.')
  return aUsuario(fila)
}

const esUnico = (e: unknown) => e instanceof Error && /UNIQUE/i.test(e.message)
const repetido = (u: string) => conflicto('usuario_repetido', `Ya existe el usuario «${u}». Elegí otro.`)

rutasUsuarios.get('/usuarios', soloAdmin, async (c) => {
  const filas = await todas<FilaUsuario>(c.env.DB, `SELECT ${COLUMNAS_USUARIO} FROM usuarios`)
  // Activos primero; dentro, por rol (sectores en orden y al final el administrador) y por nombre.
  const lista = filas.map(aUsuario).sort((a, b) =>
    Number(b.activo) - Number(a.activo)
    || ROLES.indexOf(a.rol) - ROLES.indexOf(b.rol)
    || a.nombre.localeCompare(b.nombre, 'es'))
  return c.json<Usuario[]>(lista)
})

rutasUsuarios.post('/usuarios', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const yo = c.get('usuario')
  const nombre = texto(b.nombre, 'el nombre', { max: 80 })
  const usuario = nombreUsuario(b.usuario)
  const r = rol(b.rol)
  const hash = await hashClave(clave(b.clave))
  if (await una(c.env.DB, 'SELECT id FROM usuarios WHERE usuario = ?', usuario)) throw repetido(usuario)
  const id = nuevoId()
  const nuevo: Usuario = { id, nombre, usuario, rol: r, activo: true, debeCambiarClave: debeCambiar(r), creadoEn: ahora().fecha }
  try {
    await c.env.DB.batch([
      sentencia(
        c.env.DB,
        'INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        id, nombre, usuario, hash, r, Number(nuevo.debeCambiarClave), nuevo.creadoEn,
      ),
      sentenciaAuditoria(c.env.DB, { tabla: 'usuarios', registroId: id, accion: 'crear', usuarioId: yo.id, despues: nuevo }),
    ])
  } catch (e) {
    if (esUnico(e)) throw repetido(usuario)
    throw e
  }
  return c.json<Usuario>(await leerUsuario(c.env.DB, id))
})

rutasUsuarios.patch('/usuarios/:id', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const yo = c.get('usuario')
  const db = c.env.DB
  const antes = await leerUsuario(db, c.req.param('id'))
  const despues: Usuario = { ...antes }
  if (b.nombre !== undefined) despues.nombre = texto(b.nombre, 'el nombre', { max: 80 })
  if (b.rol !== undefined) despues.rol = rol(b.rol)
  if (b.activo !== undefined) despues.activo = booleano(b.activo, 'activo')
  if (b.nombre === undefined && b.rol === undefined && b.activo === undefined) throw invalido('No hay nada para cambiar.')

  if (antes.id === yo.id) {
    if (!despues.activo) throw prohibido('No podés desactivar tu propio usuario.')
    if (despues.rol !== 'admin') throw prohibido('No podés quitarte el rol de administrador.')
  }

  const cambios: SentenciaD1[] = [
    sentencia(db, 'UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?', despues.nombre, despues.rol, despues.activo, antes.id),
  ]
  // Un operador no puede cambiar su contraseña: si deja de ser administrador, no se le pide que la cambie.
  if (antes.debeCambiarClave && !debeCambiar(despues.rol)) {
    despues.debeCambiarClave = false
    cambios.push(sentencia(db, 'UPDATE usuarios SET debe_cambiar_clave = 0 WHERE id = ?', antes.id))
  }
  // Al desactivarlo o cambiarle el rol se cierran sus sesiones: vuelve a entrar con lo nuevo (o ya no puede).
  if (!despues.activo || despues.rol !== antes.rol) cambios.push(sentencia(db, 'DELETE FROM sesiones WHERE usuario_id = ?', antes.id))
  const accion = antes.activo && !despues.activo ? 'desactivar' : !antes.activo && despues.activo ? 'activar' : 'editar'
  cambios.push(sentenciaAuditoria(db, { tabla: 'usuarios', registroId: antes.id, accion, usuarioId: yo.id, antes, despues }))
  await db.batch(cambios)
  return c.json<Usuario>(await leerUsuario(db, antes.id))
})

rutasUsuarios.post('/usuarios/:id/clave', soloAdmin, async (c) => {
  const b = await cuerpo(c)
  const yo = c.get('usuario')
  const db = c.env.DB
  const u = await leerUsuario(db, c.req.param('id'))
  if (u.id === yo.id) throw invalido('Para cambiar tu propia contraseña usá «Configuración → Cambiar mi contraseña».')
  const hash = await hashClave(clave(b.clave))
  const debe = debeCambiar(u.rol)
  await db.batch([
    sentencia(db, 'UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = ? WHERE id = ?', hash, Number(debe), u.id),
    sentencia(db, 'DELETE FROM sesiones WHERE usuario_id = ?', u.id),
    sentenciaAuditoria(db, {
      tabla: 'usuarios', registroId: u.id, accion: 'restablecer_clave', usuarioId: yo.id,
      antes: { debeCambiarClave: u.debeCambiarClave }, despues: { debeCambiarClave: debe },
    }),
  ])
  return c.json({ ok: true })
})
