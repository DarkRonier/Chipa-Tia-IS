// Cliente de la API. En Cloudflare habla con el Worker (/api en el mismo dominio); en la demo de
// GitHub Pages (VITE_MODO=demo) la misma API corre dentro del navegador, sin servidor.
import type { ErrorRespuesta } from '../shared/tipos'

export const esDemo = import.meta.env.VITE_MODO === 'demo'

const CLAVE_TOKEN = 'chipa-tia-token'

/** Error que devuelve la API, con el mensaje listo para mostrar. */
export class ErrorDeApi extends Error {
  constructor(
    public estado: number,
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
  }
}

function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN)
  } catch {
    return null
  }
}

let token: string | null = leerToken()
let alPerderSesion: (() => void) | null = null

export function fijarToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t)
    else localStorage.removeItem(CLAVE_TOKEN)
  } catch {
    // sin almacenamiento: la sesión dura lo que la pestaña
  }
}

export const hayToken = () => token !== null

/** La sesión avisa así cuando la API responde 401 (sesión vencida o usuario desactivado). */
export function cuandoSePierdaLaSesion(f: (() => void) | null) {
  alPerderSesion = f
}

type Consulta = Record<string, string | number | boolean | null | undefined>

/** "/movimientos" + { sector: 'cocina', desde: '' } → "/movimientos?sector=cocina" */
export function conConsulta(ruta: string, consulta?: Consulta): string {
  if (!consulta) return ruta
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(consulta)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    p.set(k, v === true ? '1' : String(v))
  }
  const q = p.toString()
  return q ? `${ruta}${ruta.includes('?') ? '&' : '?'}${q}` : ruta
}

async function transportar(pedido: Request): Promise<Response> {
  if (esDemo) {
    const { fetchDemo } = await import('../demo/servidor')
    return fetchDemo(pedido)
  }
  return fetch(pedido)
}

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; consulta?: Consulta } = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, consulta } = opciones
  const base = esDemo ? 'http://demo.local' : location.origin
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json'
  let r: Response
  try {
    r = await transportar(
      new Request(`${base}/api${conConsulta(ruta, consulta)}`, {
        method: metodo,
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      }),
    )
  } catch {
    throw new ErrorDeApi(0, 'sin_conexion', 'No hay conexión con el servidor. Revisá internet y probá de nuevo.')
  }
  const datos = (await r.json().catch(() => null)) as T | ErrorRespuesta | null
  if (!r.ok) {
    const e = (datos as ErrorRespuesta | null)?.error
    if (r.status === 401 && ruta !== '/auth/login') alPerderSesion?.()
    throw new ErrorDeApi(r.status, e?.codigo ?? 'error', e?.mensaje ?? `Error ${r.status}`)
  }
  return datos as T
}

export const get = <T>(ruta: string, consulta?: Consulta) => api<T>(ruta, { consulta })
export const post = <T>(ruta: string, cuerpo?: unknown) => api<T>(ruta, { metodo: 'POST', cuerpo: cuerpo ?? {} })
export const patch = <T>(ruta: string, cuerpo: unknown) => api<T>(ruta, { metodo: 'PATCH', cuerpo })
