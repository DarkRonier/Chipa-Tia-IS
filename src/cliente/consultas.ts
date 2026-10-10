// Lectura de datos con recarga automática: después de cualquier acción que cambia algo (useAccion),
// todas las pantallas abiertas vuelven a pedir sus datos.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, conConsulta, ErrorDeApi } from './api'

type Consulta = Record<string, string | number | boolean | null | undefined>

let version = 0
const oyentes = new Set<() => void>()

/** Avisa a todas las consultas abiertas que los datos cambiaron. */
export function invalidar() {
  version++
  for (const o of oyentes) o()
}

export interface EstadoConsulta<T> {
  datos: T | undefined
  error: string | null
  cargando: boolean
  recargar: () => void
}

/** GET a la API. Con `ruta` null no pide nada (por ejemplo, mientras falta elegir un filtro). */
export function useConsulta<T>(ruta: string | null, consulta?: Consulta): EstadoConsulta<T> {
  const clave = ruta === null ? null : conConsulta(ruta, consulta)
  const [estado, setEstado] = useState<{ clave: string | null; datos?: T; error: string | null }>({ clave: null, error: null })
  const [v, setV] = useState(version)
  const pedido = useRef(0)

  useEffect(() => {
    const o = () => setV(version)
    oyentes.add(o)
    return () => {
      oyentes.delete(o)
    }
  }, [])

  useEffect(() => {
    if (clave === null) return
    const n = ++pedido.current
    api<T>(clave)
      .then((datos) => n === pedido.current && setEstado({ clave, datos, error: null }))
      .catch((e: unknown) => n === pedido.current && setEstado((s) => ({ clave, datos: s.clave === clave ? s.datos : undefined, error: mensajeDe(e) })))
  }, [clave, v])

  const recargar = useCallback(() => setV((x) => x + 1), [])
  const vigente = estado.clave === clave
  return {
    datos: vigente ? estado.datos : undefined,
    error: vigente ? estado.error : null,
    cargando: clave !== null && (!vigente || (estado.datos === undefined && estado.error === null)),
    recargar,
  }
}

export function mensajeDe(e: unknown): string {
  if (e instanceof ErrorDeApi) return e.message
  return 'Ocurrió un error inesperado. Probá de nuevo.'
}

/**
 * Acción que cambia datos (POST/PATCH). Mientras corre, `enviando` evita doble envío;
 * si sale bien recarga todas las consultas; si falla deja el mensaje en `error`.
 */
export function useAccion<A extends unknown[], R>(f: (...args: A) => Promise<R>) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(f)
  ref.current = f
  const ejecutar = useCallback(async (...args: A): Promise<R | undefined> => {
    setEnviando(true)
    setError(null)
    try {
      const r = await ref.current(...args)
      invalidar()
      return r
    } catch (e) {
      setError(mensajeDe(e))
      return undefined
    } finally {
      setEnviando(false)
    }
  }, [])
  return { ejecutar, enviando, error, limpiarError: () => setError(null) }
}
