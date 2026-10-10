// Sesión del usuario en el navegador (A01). El token queda en localStorage; al recargar se valida con /auth/yo.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { RespuestaLogin, Usuario } from '../shared/tipos'
import { cuandoSePierdaLaSesion, fijarToken, get, hayToken, post } from './api'
import { invalidar } from './consultas'

interface Sesion {
  usuario: Usuario | null
  /** true mientras se valida el token guardado al abrir la app. */
  cargando: boolean
  entrar(usuario: string, clave: string): Promise<void>
  salir(): Promise<void>
  cambiarClave(actual: string, nueva: string): Promise<void>
}

const Contexto = createContext<Sesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [cargando, setCargando] = useState(hayToken())

  useEffect(() => {
    cuandoSePierdaLaSesion(() => {
      fijarToken(null)
      setUsuario(null)
    })
    if (hayToken()) {
      get<Usuario>('/auth/yo')
        .then(setUsuario)
        .catch(() => setUsuario(null))
        .finally(() => setCargando(false))
    }
    return () => cuandoSePierdaLaSesion(null)
  }, [])

  const entrar = useCallback(async (u: string, clave: string) => {
    const r = await post<RespuestaLogin>('/auth/login', { usuario: u, clave })
    fijarToken(r.token)
    setUsuario(r.usuario)
  }, [])

  const salir = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined)
    fijarToken(null)
    setUsuario(null)
  }, [])

  const cambiarClave = useCallback(async (actual: string, nueva: string) => {
    const r = await post<{ token: string }>('/auth/clave', { actual, nueva })
    fijarToken(r.token)
    setUsuario(await get<Usuario>('/auth/yo'))
    invalidar()
  }, [])

  return <Contexto.Provider value={{ usuario, cargando, entrar, salir, cambiarClave }}>{children}</Contexto.Provider>
}

export function useSesion(): Sesion {
  const s = useContext(Contexto)
  if (!s) throw new Error('useSesion fuera de ProveedorSesion')
  return s
}

/** El usuario con sesión iniciada (solo dentro de las pantallas protegidas). */
export function useUsuario(): Usuario {
  const u = useSesion().usuario
  if (!u) throw new Error('useUsuario sin sesión')
  return u
}
