import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import '../styles/iconos.css'

export default function Volver({ titulo, a = '/sector', icono }: { titulo: string; a?: string; icono?: ReactNode }) {
  return (
    <div className="titulo">
      <Link to={a} className="volver" aria-label="Volver">‹</Link>
      {icono && <span className="icono-titulo">{icono}</span>}
      <h1>{titulo}</h1>
    </div>
  )
}
