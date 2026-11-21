import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUsuario } from '../cliente/sesion'
import { inicioDe, puede } from '../shared/permisos'
import '../styles/iconos.css'

/** Sin `a`, vuelve al inicio del sector (sectores y administrador) o al inicio propio del rol (supervisor). */
export default function Volver({ titulo, a, icono, accion }: { titulo: string; a?: string; icono?: ReactNode; accion?: ReactNode }) {
  const { rol } = useUsuario()
  a ??= puede(rol, 'produccion.cargar') ? '/sector' : inicioDe(rol)
  return (
    <div className="titulo">
      <Link to={a} className="volver" aria-label="Volver"><Flecha /></Link>
      {icono && <span className="icono-titulo">{icono}</span>}
      <h1>{titulo}</h1>
      {accion && <div className="titulo-accion">{accion}</div>}
    </div>
  )
}

/** Flecha dibujada (no el carácter «‹», que cada fuente ubica distinto): queda centrada en el círculo. */
export function Flecha({ derecha }: { derecha?: boolean }) {
  return (
    <svg className="flecha" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={derecha ? 'M9.5 5.5 16 12l-6.5 6.5' : 'M14.5 5.5 8 12l6.5 6.5'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
