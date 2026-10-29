// Guarda archivos (fotos de máquinas y de limpieza, copias semanales) en R2 o, si no hay R2, en la tabla `archivos`.
import { ejecutar, una } from './db'
import type { Env } from './entorno'
import { invalido } from './errores'

const aBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

export async function guardarArchivo(env: Env, clave: string, datos: Uint8Array, tipo: string) {
  if (env.ARCHIVOS) {
    await env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: tipo } })
  } else {
    await ejecutar(
      env.DB,
      'INSERT OR REPLACE INTO archivos (clave, tipo, datos, bytes, creado_en) VALUES (?, ?, ?, ?, ?)',
      clave, tipo, aBase64(datos), datos.length, new Date().toISOString(),
    )
  }
}

export async function leerArchivo(env: Env, clave: string): Promise<{ datos: Uint8Array; tipo: string } | null> {
  if (env.ARCHIVOS) {
    const o = await env.ARCHIVOS.get(clave)
    if (!o) return null
    return { datos: new Uint8Array(await o.arrayBuffer()), tipo: o.httpMetadata?.contentType ?? 'application/octet-stream' }
  }
  const fila = await una<{ tipo: string; datos: string }>(env.DB, 'SELECT tipo, datos FROM archivos WHERE clave = ?', clave)
  return fila ? { datos: deBase64(fila.datos), tipo: fila.tipo } : null
}

const ascii = (b: Uint8Array, desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta))

/** Los primeros bytes de cada formato: un HTML o un SVG con el tipo cambiado no pasa por foto. */
const FIRMAS: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n',
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
}

/** data:image/jpeg;base64,... → bytes y tipo; null si no es una imagen JPEG, PNG o WEBP de verdad. */
export function desdeDataUrl(dataUrl: string): { datos: Uint8Array; tipo: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  let datos: Uint8Array
  try {
    datos = deBase64(m[2])
  } catch {
    return null // base64 mal formado
  }
  return FIRMAS[m[1]](datos) ? { tipo: m[1], datos } : null
}

export function aDataUrl(datos: Uint8Array, tipo: string) {
  return `data:${tipo};base64,${aBase64(datos)}`
}

/** Foto ya achicada en el navegador: hasta 1,5 MB una vez decodificada. */
export const FOTO_MAXIMA_BYTES = 1.5 * 1024 * 1024
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export interface FotoPedida {
  datos: Uint8Array
  tipo: string
  /** Extensión para la clave del archivo: jpg, png o webp. */
  extension: string
}

/** Valida el campo `foto` de un pedido (data URL). Vacío, null o ausente = sin foto. */
export function fotoDelPedido(valor: unknown): FotoPedida | null {
  if (valor === undefined || valor === null || valor === '') return null
  if (typeof valor !== 'string') throw invalido('La foto no es una imagen válida.')
  // base64 ocupa 4/3 de los bytes: el peso se calcula antes de decodificar.
  if (Math.floor(((valor.length - valor.indexOf(',') - 1) * 3) / 4) > FOTO_MAXIMA_BYTES + 2) {
    throw invalido('La foto es muy pesada. Sacala de nuevo o elegí otra.')
  }
  const foto = desdeDataUrl(valor)
  if (!foto) throw invalido('La foto no es una imagen válida (JPEG, PNG o WEBP).')
  if (foto.datos.length > FOTO_MAXIMA_BYTES) throw invalido('La foto es muy pesada. Sacala de nuevo o elegí otra.')
  return { ...foto, extension: EXTENSION[foto.tipo] }
}

/** Borra archivos: en R2 de una sola vez (acepta un arreglo de claves) y sin R2 con un solo DELETE sobre `archivos`. */
export async function borrarArchivos(env: Env, claves: string[]) {
  if (!claves.length) return
  if (env.ARCHIVOS) await env.ARCHIVOS.delete(claves)
  else await ejecutar(env.DB, 'DELETE FROM archivos WHERE clave IN (SELECT value FROM json_each(?))', JSON.stringify(claves))
}
