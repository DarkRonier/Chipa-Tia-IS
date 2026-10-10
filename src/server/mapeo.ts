import type { Rol, Usuario } from '../shared/tipos'

export interface FilaUsuario {
  id: string
  nombre: string
  usuario: string
  rol: Rol
  activo: number
  debe_cambiar_clave: number
  creado_en: string
}

export const COLUMNAS_USUARIO = 'id, nombre, usuario, rol, activo, debe_cambiar_clave, creado_en'

export const aUsuario = (f: FilaUsuario): Usuario => ({
  id: f.id,
  nombre: f.nombre,
  usuario: f.usuario,
  rol: f.rol,
  activo: !!f.activo,
  // Solo un administrador puede cambiar su contraseña, así que solo a él se le pide.
  debeCambiarClave: !!f.debe_cambiar_clave && f.rol === 'admin',
  creadoEn: f.creado_en,
})
