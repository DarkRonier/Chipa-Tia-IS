// A01: cambiar la propia contraseña. Obligatorio en el primer ingreso cuando el administrador la reinició.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Volver from '../components/Volver'
import { mensajeDe } from '../cliente/consultas'
import { useSesion, useUsuario } from '../cliente/sesion'

export default function CambiarClave() {
  const usuario = useUsuario()
  const { cambiarClave, salir } = useSesion()
  const navigate = useNavigate()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const obligatorio = usuario.debeCambiarClave

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault()
    if (nueva !== repetida) return setError('Las dos contraseñas nuevas no coinciden.')
    setEnviando(true)
    setError(null)
    try {
      await cambiarClave(actual, nueva)
      navigate('/', { replace: true })
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setEnviando(false)
    }
  }

  const formulario = (
    <form onSubmit={enviar} className="tarjeta">
      {obligatorio && <p>Hola {usuario.nombre}. Antes de seguir, elegí una contraseña nueva.</p>}
      <label className="campo">
        <span>Contraseña actual</span>
        <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required />
      </label>
      <label className="campo">
        <span>Contraseña nueva (mínimo 6 caracteres)</span>
        <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" minLength={6} required />
      </label>
      <label className="campo">
        <span>Repetir contraseña nueva</span>
        <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" minLength={6} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn-primario" type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar contraseña'}</button>
      {obligatorio && <button type="button" className="btn-texto" onClick={() => void salir()}>Salir</button>}
    </form>
  )

  if (obligatorio) {
    return (
      <div className="login">
        <h1 className="marca-grande">Chipa Tía</h1>
        {formulario}
      </div>
    )
  }
  return (
    <>
      <Volver titulo="Cambiar contraseña" a="/" />
      {formulario}
    </>
  )
}
