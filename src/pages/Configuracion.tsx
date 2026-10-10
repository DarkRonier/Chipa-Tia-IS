// Configuración de este aparato: tema claro / oscuro y, para el administrador, el acceso a cambiar su contraseña.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Volver from '../components/Volver'
import { useUsuario } from '../cliente/sesion'

type Tema = 'claro' | 'oscuro' | 'sistema'

const CLAVE_TEMA = 'chipa-tia-tema'
const COLOR_BARRA = { light: '#b8001a', dark: '#c8102e' }

function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE_TEMA)
    return v === 'claro' || v === 'oscuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

/** Aplica el tema al documento: «Como el celular» quita el atributo y deja mandar a prefers-color-scheme. */
function aplicarTema(tema: Tema) {
  const raiz = document.documentElement
  if (tema === 'claro') raiz.dataset.theme = 'light'
  else if (tema === 'oscuro') raiz.dataset.theme = 'dark'
  else delete raiz.dataset.theme
  const oscuro = tema === 'oscuro' || (tema === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? COLOR_BARRA.dark : COLOR_BARRA.light)
}

const icono = (trazo: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {trazo}
  </svg>
)

const OPCIONES: { valor: Tema; nombre: string; detalle: string; icono: ReactNode }[] = [
  {
    valor: 'claro', nombre: 'Claro', detalle: 'Fondo claro, el de siempre.',
    icono: icono(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  },
  {
    valor: 'oscuro', nombre: 'Oscuro', detalle: 'Fondo oscuro, más cómodo con poca luz.',
    icono: icono(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  },
  {
    valor: 'sistema', nombre: 'Como el celular', detalle: 'Sigue el modo claro u oscuro del aparato.',
    icono: icono(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>),
  },
]

export default function Configuracion() {
  const usuario = useUsuario()
  const [tema, setTema] = useState<Tema>(leerTema)

  const elegir = (t: Tema) => {
    setTema(t)
    aplicarTema(t)
    try {
      if (t === 'sistema') localStorage.removeItem(CLAVE_TEMA)
      else localStorage.setItem(CLAVE_TEMA, t)
    } catch {
      // sin almacenamiento: el tema vale hasta que se cierre la pestaña
    }
  }

  return (
    <div className="configuracion">
      <Volver titulo="Configuración" a="/" />
      <form className="tarjeta" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend>Aspecto</legend>
          {OPCIONES.map((o) => (
            <label key={o.valor} className="opcion-tema">
              <input type="radio" name="tema" checked={tema === o.valor} onChange={() => elegir(o.valor)} />
              {o.icono}
              <span>
                {o.nombre}
                <small>{o.detalle}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
      {usuario.rol === 'admin' && (
        <div className="tarjeta">
          <Link to="/clave">Cambiar mi contraseña</Link>
        </div>
      )}
    </div>
  )
}
