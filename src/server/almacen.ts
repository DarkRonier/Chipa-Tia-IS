// Guarda archivos (fotos de máquinas, copias semanales) en R2 o, si no hay R2, en la tabla `archivos`.
import { ejecutar, una } from './db'
import type { Env } from './entorno'

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

/** data:image/jpeg;base64,... → bytes y tipo. */
export function desdeDataUrl(dataUrl: string): { datos: Uint8Array; tipo: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  return m ? { tipo: m[1], datos: deBase64(m[2]) } : null
}

export function aDataUrl(datos: Uint8Array, tipo: string) {
  return `data:${tipo};base64,${aBase64(datos)}`
}
