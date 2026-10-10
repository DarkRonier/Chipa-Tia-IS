// F03: la foto de la cámara o de la galería se achica en el navegador antes de subirla
// (lado mayor de 1280 px, JPEG calidad 0,7). Así pesa unos cientos de KB aunque el celular saque 12 MP.
import { useEffect, useState } from 'react'
import { get } from './api'
import { mensajeDe } from './consultas'

/** Lo que acepta el servidor una vez decodificada la imagen. */
const MAXIMO_BYTES = 1.5 * 1024 * 1024

const bytesDeDataUrl = (d: string) => Math.floor(((d.length - d.indexOf(',') - 1) * 3) / 4)

function cargarImagen(archivo: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      ok(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      mal(new Error('No se pudo leer la foto. Probá con otra.'))
    }
    img.src = url
  })
}

function dibujar(img: HTMLImageElement, ladoMaximo: number, calidad: number): string {
  const ancho = img.naturalWidth || img.width
  const alto = img.naturalHeight || img.height
  const escala = Math.min(1, ladoMaximo / Math.max(ancho, alto))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(ancho * escala))
  canvas.height = Math.max(1, Math.round(alto * escala))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Este navegador no puede preparar la foto.')
  // Fondo blanco: un PNG con transparencia no queda negro al pasarlo a JPEG.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Los navegadores actuales ya respetan la orientación EXIF al dibujar (foto vertical del celular).
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', calidad)
}

/**
 * Achica una imagen elegida o sacada con la cámara y la devuelve como data URL JPEG.
 * Si todavía pesa demasiado, prueba con menos resolución y calidad.
 */
export async function achicarFoto(archivo: Blob, { ladoMaximo = 1280, calidad = 0.7 } = {}): Promise<string> {
  if (archivo.type && !archivo.type.startsWith('image/')) throw new Error('Ese archivo no es una foto.')
  const img = await cargarImagen(archivo)
  let lado = ladoMaximo
  let q = calidad
  let dataUrl = dibujar(img, lado, q)
  while (bytesDeDataUrl(dataUrl) > MAXIMO_BYTES && lado > 480) {
    lado = Math.round(lado * 0.75)
    q = Math.max(0.5, q - 0.1)
    dataUrl = dibujar(img, lado, q)
  }
  if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('Este navegador no puede preparar la foto.')
  return dataUrl
}

// Las fotos guardadas no cambian nunca: se piden una sola vez por lectura.
const cache = new Map<string, Promise<string>>()

/** Foto de una lectura (`GET /lecturas/:id/foto`), con caché; null mientras carga. */
export function useFotoLectura(lecturaId: string | null): { dataUrl: string | null; error: string | null } {
  const [estado, setEstado] = useState<{ id: string | null; dataUrl: string | null; error: string | null }>({ id: null, dataUrl: null, error: null })
  useEffect(() => {
    if (!lecturaId) return
    let vigente = true
    let p = cache.get(lecturaId)
    if (!p) {
      p = get<{ dataUrl: string }>(`/lecturas/${lecturaId}/foto`).then((r) => r.dataUrl)
      cache.set(lecturaId, p)
      p.catch(() => cache.delete(lecturaId))
    }
    p.then(
      (dataUrl) => vigente && setEstado({ id: lecturaId, dataUrl, error: null }),
      (e: unknown) => vigente && setEstado({ id: lecturaId, dataUrl: null, error: mensajeDe(e) }),
    )
    return () => {
      vigente = false
    }
  }, [lecturaId])
  return estado.id === lecturaId ? { dataUrl: estado.dataUrl, error: estado.error } : { dataUrl: null, error: null }
}
