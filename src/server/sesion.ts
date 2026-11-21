// Sesiones con token Bearer. En la base solo se guarda el hash del token.
import type { Context, MiddlewareHandler } from 'hono'
import type { Rol, SectorId } from '../shared/tipos'
import { SECTOR_IDS } from '../shared/tipos'
import { puede, sectorDeRol, type Permiso } from '../shared/permisos'
import { sha256, tokenAleatorio } from './clave'
import { ejecutar, una } from './db'
import type { BaseD1, Entorno, UsuarioSesion } from './entorno'
import { ErrorApi, invalido, noAutorizado, prohibido } from './errores'

const DURACION_DIAS = 30

export async function crearSesion(db: BaseD1, usuarioId: string): Promise<string> {
  const token = tokenAleatorio()
  const ahora = new Date()
  const vence = new Date(ahora.getTime() + DURACION_DIAS * 86_400_000)
  await ejecutar(
    db,
    'INSERT INTO sesiones (token_hash, usuario_id, creada_en, vence_en) VALUES (?, ?, ?, ?)',
    await sha256(token), usuarioId, ahora.toISOString(), vence.toISOString(),
  )
  return token
}

export async function cerrarSesion(db: BaseD1, token: string) {
  await ejecutar(db, 'DELETE FROM sesiones WHERE token_hash = ?', await sha256(token))
}

/** Cierra todas las sesiones de un usuario (al desactivarlo o cambiarle la contraseña). */
export async function cerrarSesionesDe(db: BaseD1, usuarioId: string) {
  await ejecutar(db, 'DELETE FROM sesiones WHERE usuario_id = ?', usuarioId)
}

export function tokenDe(c: Context): string | null {
  const h = c.req.header('Authorization')
  return h?.startsWith('Bearer ') ? h.slice(7).trim() || null : null
}

interface FilaSesion {
  id: string
  nombre: string
  usuario: string
  rol: Rol
  activo: number
  debe_cambiar_clave: number
  vence_en: string
  super_hasta: string | null
}

/** Exige sesión válida y deja el usuario en `c.get('usuario')`. */
export const conSesion: MiddlewareHandler<Entorno> = async (c, next) => {
  const token = tokenDe(c)
  if (!token) throw noAutorizado()
  const fila = await una<FilaSesion>(
    c.env.DB,
    `SELECT u.id, u.nombre, u.usuario, u.rol, u.activo, u.debe_cambiar_clave, s.vence_en, s.super_hasta
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ?`,
    await sha256(token),
  )
  const ahora = new Date().toISOString()
  if (!fila || !fila.activo || fila.vence_en < ahora) {
    throw noAutorizado('Tu sesión venció. Volvé a entrar.')
  }
  c.set('usuario', {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    sector: sectorDeRol(fila.rol),
    // Solo un administrador puede cambiar su contraseña, así que solo a él se le exige.
    debeCambiarClave: !!fila.debe_cambiar_clave && fila.rol === 'admin',
    superHasta: fila.rol === 'admin' && fila.super_hasta && fila.super_hasta > ahora ? fila.super_hasta : null,
  })
  await next()
}

/**
 * Con la contraseña inicial o una restablecida por el administrador solo se puede cambiarla (/auth/clave):
 * el resto de la API responde 403 hasta que tenga una propia, igual que la pantalla de la app.
 */
export const conClavePropia: MiddlewareHandler<Entorno> = async (c, next) => {
  if (c.get('usuario').debeCambiarClave) {
    throw new ErrorApi(403, 'debe_cambiar_clave', 'Antes de seguir, cambiá tu contraseña.')
  }
  await next()
}

export const esAdmin = (u: UsuarioSesion) => u.rol === 'admin'

/** Minutos que dura el modo super-administrador después de activarlo. */
export const MINUTOS_SUPER = 30

/**
 * Solo el super-administrador (Mati, 2026-11-17): un administrador con el modo activado en Configuración → Ajustes
 * avanzados. Por ahora: crear y borrar almacenes.
 */
export const soloSuper: MiddlewareHandler<Entorno> = async (c, next) => {
  const u = c.get('usuario')
  if (u.rol !== 'admin' || !u.superHasta) {
    throw prohibido('Esto lo hace solo el super-administrador. Activalo en Configuración → Ajustes avanzados.')
  }
  await next()
}

/**
 * Exige un permiso de la tabla de roles (src/shared/permisos.ts); si no lo tiene, 403 con `mensaje`.
 * Va antes de `sectorPara`: el permiso dice qué puede hacer y `sectorPara`, en qué sector.
 */
export function requiere(permiso: Permiso, mensaje = 'No tenés permiso para esto.'): MiddlewareHandler<Entorno> {
  return async (c, next) => {
    if (!puede(c.get('usuario').rol, permiso)) throw prohibido(mensaje)
    await next()
  }
}

export const tienePermiso = (u: UsuarioSesion, permiso: Permiso) => puede(u.rol, permiso)

export function esSector(v: unknown): v is SectorId {
  return typeof v === 'string' && (SECTOR_IDS as string[]).includes(v)
}

/**
 * Sector sobre el que actúa el pedido (A03). Un operador siempre usa el suyo: si pide otro, 403.
 * El administrador (o el supervisor) debe indicarlo cuando `obligatorio`; si no, devuelve null (= todos los sectores).
 */
export function sectorPara(u: UsuarioSesion, pedido: unknown, obligatorio: true): SectorId
export function sectorPara(u: UsuarioSesion, pedido: unknown, obligatorio?: false): SectorId | null
export function sectorPara(u: UsuarioSesion, pedido: unknown, obligatorio = false): SectorId | null {
  const valor = pedido === '' || pedido === undefined || pedido === null ? null : pedido
  if (u.sector) {
    if (valor !== null && valor !== u.sector) throw prohibido('Solo podés ver y cargar datos de tu sector.')
    return u.sector
  }
  if (valor === null) {
    if (obligatorio) throw invalido('Indicá el sector.')
    return null
  }
  if (!esSector(valor)) throw invalido('Sector desconocido.')
  return valor
}
