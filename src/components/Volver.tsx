import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUsuario } from '../cliente/sesion'
import { inicioDe, puede } from '../shared/permisos'
import '../styles/iconos.css'

/** Sin `a`, vuelve al inicio del sector (sectores y administrador) o al inicio propio del rol (supervisor). */
export default function Volver({ titulo, a, icono }: { titulo: string; a?: string; icono?: ReactNode }) {
  const { rol } = useUsuario()
  a ??= puede(rol, 'produccion.cargar') ? '/sector' : inicioDe(rol)
  return (
    <div className="titulo">
      <Link to={a} className="volver" aria-label="Volver">‹</Link>
      {icono && <span className="icono-titulo">{icono}</span>}
      <h1>{titulo}</h1>
    </div>
  )
}
