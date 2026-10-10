import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { esDemo } from '../cliente/api'
import { mensajeDe } from '../cliente/consultas'
import { useSesion } from '../cliente/sesion'

const USUARIOS_DEMO = ['chiperia', 'chipitas', 'panaderia', 'cocina', 'admin']

export default function Login() {
  const { entrar } = useSesion()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      await entrar(usuario, clave)
      // Cada rol arranca en su pantalla de inicio, sin importar la URL anterior.
      navigate('/', { replace: true })
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="login">
      <form onSubmit={enviar} className="tarjeta">
        <h1 className="marca-grande">Chipa Tía</h1>
        <p className="suave">Registro de producción</p>
        <label className="campo">
          <span>Usuario</span>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoCapitalize="none" autoComplete="username" required />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primario" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      {esDemo && (
        <div className="tarjeta suave pista">
          <strong>Demo:</strong> la contraseña de todos es <code>1234</code>. Usuarios:{' '}
          {USUARIOS_DEMO.map((u) => (
            <button key={u} type="button" className="btn-texto" onClick={() => { setUsuario(u); setClave('1234') }}>
              {u}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
