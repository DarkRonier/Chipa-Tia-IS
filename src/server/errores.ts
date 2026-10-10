import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Error que la API devuelve como `{ error: { codigo, mensaje } }` con el estado indicado. */
export class ErrorApi extends Error {
  constructor(
    public estado: ContentfulStatusCode,
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
  }
}

export const noAutorizado = (m = 'Tenés que iniciar sesión.') => new ErrorApi(401, 'no_autorizado', m)
export const prohibido = (m = 'No tenés permiso para esto.') => new ErrorApi(403, 'prohibido', m)
export const noEncontrado = (m = 'No se encontró lo que buscás.') => new ErrorApi(404, 'no_encontrado', m)
export const invalido = (m: string) => new ErrorApi(400, 'datos_invalidos', m)
export const conflicto = (codigo: string, m: string) => new ErrorApi(409, codigo, m)

/** Traduce el error del trigger de stock (D04) a un mensaje para el operador. */
export function esStockInsuficiente(e: unknown): boolean {
  return e instanceof Error && e.message.includes('STOCK_INSUFICIENTE')
}
