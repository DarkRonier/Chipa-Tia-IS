import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatos } from '../mock/store'

export default function Login() {
  const { entrar, datos } = useDatos()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const enviar = (ev: FormEvent) => {
    ev.preventDefault()
    const err = entrar(usuario, clave)
    setError(err)
    // Cada rol arranca en su pantalla de inicio, sin importar la URL anterior.
    if (!err) navigate('/', { replace: true })
  }

  return (
    <div className="login">
      <form onSubmit={enviar} className="tarjeta">
        <h1 className="marca-grande">Chipa Tía</h1>
        <p className="suave">Registro de producción</p>
        <label className="campo">
          <span>Usuario</span>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoCapitalize="none" autoComplete="username" />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primario" type="submit">Entrar</button>
      </form>
      <div className="tarjeta suave pista">
        <strong>Prototipo:</strong> la contraseña de todos es <code>1234</code>. Usuarios:{' '}
        {datos.usuarios.map((u) => (
          <button key={u.id} type="button" className="btn-texto" onClick={() => { setUsuario(u.usuario); setClave('1234') }}>
            {u.usuario}
          </button>
        ))}
      </div>
    </div>
  )
}
