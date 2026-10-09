import { Link } from 'react-router-dom'

export default function Volver({ titulo, a = '/sector' }: { titulo: string; a?: string }) {
  return (
    <div className="titulo">
      <Link to={a} className="volver" aria-label="Volver">‹</Link>
      <h1>{titulo}</h1>
    </div>
  )
}
