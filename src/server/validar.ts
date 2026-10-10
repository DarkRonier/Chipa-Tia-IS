// Validación simple de cuerpos JSON. Cada función lanza un 400 con un mensaje para mostrar al usuario.
import type { Context } from 'hono'
import { esDiaValido } from '../shared/hora'
import { ErrorApi, invalido } from './errores'

/** Lo más grande que se acepta: una foto de 1,5 MB en base64 (unos 2,1 MB) más el resto de la lectura. */
export const CUERPO_MAXIMO = 3 * 1024 * 1024
const demasiadoGrande = () => new ErrorApi(413, 'demasiado_grande', 'El pedido es demasiado grande.')

export async function cuerpo<T = Record<string, unknown>>(c: Context): Promise<T> {
  // Un cuerpo enorme (también en el login, sin sesión) se corta antes de leerlo y de armar el JSON.
  if (Number(c.req.header('Content-Length')) > CUERPO_MAXIMO) throw demasiadoGrande()
  const crudo = await c.req.text().catch(() => '')
  if (crudo.length > CUERPO_MAXIMO) throw demasiadoGrande()
  try {
    const v = JSON.parse(crudo)
    if (!v || typeof v !== 'object') throw new Error()
    return v as T
  } catch {
    throw invalido('El pedido no tiene un JSON válido.')
  }
}

/** Con `recortar: false` el texto llega tal cual (las contraseñas: los espacios de los bordes cuentan). */
export function texto(v: unknown, campo: string, { min = 1, max = 200, recortar = true } = {}): string {
  if (typeof v !== 'string') throw invalido(`Falta ${campo}.`)
  const t = recortar ? v.trim() : v
  if (t.length < min) throw invalido(min === 1 ? `Falta ${campo}.` : `${campo} debe tener al menos ${min} caracteres.`)
  if (t.length > max) throw invalido(`${campo} es demasiado largo (máximo ${max} caracteres).`)
  return t
}

export function textoOpcional(v: unknown, campo: string, max = 500): string | null {
  if (v === undefined || v === null || v === '') return null
  return texto(v, campo, { min: 0, max }) || null
}

export function entero(v: unknown, campo: string, { min = 0, max = 1_000_000 } = {}): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalido(`${campo} debe ser un número entero.`)
  if (v < min || v > max) throw invalido(`${campo} debe estar entre ${min} y ${max}.`)
  return v
}

export function numero(v: unknown, campo: string, { min = -1_000_000, max = 1_000_000 } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalido(`${campo} debe ser un número.`)
  if (v < min || v > max) throw invalido(`${campo} debe estar entre ${min} y ${max}.`)
  return v
}

export function numeroOpcional(v: unknown, campo: string): number | null {
  return v === undefined || v === null || v === '' ? null : numero(v, campo)
}

export function booleano(v: unknown, campo: string): boolean {
  if (typeof v !== 'boolean') throw invalido(`${campo} debe ser verdadero o falso.`)
  return v
}

export function opcion<T extends string>(v: unknown, opciones: readonly T[], campo: string): T {
  if (typeof v !== 'string' || !(opciones as readonly string[]).includes(v)) throw invalido(`${campo} no es válido.`)
  return v as T
}

export function dia(v: unknown, campo: string): string {
  if (!esDiaValido(v)) throw invalido(`${campo} debe ser una fecha AAAA-MM-DD.`)
  return v
}

export function diaOpcional(v: unknown, campo: string): string | null {
  return v === undefined || v === null || v === '' ? null : dia(v, campo)
}

export function lista<T>(v: unknown, campo: string, { min = 0, max = 500 } = {}): T[] {
  if (!Array.isArray(v)) throw invalido(`${campo} debe ser una lista.`)
  if (v.length < min) throw invalido(`Falta ${campo}.`)
  if (v.length > max) throw invalido(`${campo} tiene demasiados elementos.`)
  return v as T[]
}
