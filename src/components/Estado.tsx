// Mensajes de estado comunes: cargando, error y confirmación.
import type { ReactNode } from 'react'

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="suave" role="status">{texto}</p>
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok'; children: ReactNode }) {
  if (!children) return null
  return <p className={tipo} role={tipo === 'error' ? 'alert' : 'status'}>{children}</p>
}

/** Muestra el error o "cargando" de una consulta; si hay datos, dibuja `children`. */
export function ConDatos<T>({ consulta, children }: {
  consulta: { datos: T | undefined; error: string | null; cargando: boolean }
  children: (datos: T) => ReactNode
}) {
  if (consulta.error) return <Aviso>{consulta.error}</Aviso>
  if (consulta.datos === undefined) return <Cargando />
  return <>{children(consulta.datos)}</>
}
