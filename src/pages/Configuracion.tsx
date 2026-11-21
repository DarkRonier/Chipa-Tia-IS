// Configuración de este aparato: tema claro / oscuro y, para el administrador, el acceso a cambiar su contraseña y los
// ajustes avanzados (modo super-administrador: por un rato, con la contraseña, para crear y borrar almacenes).
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Volver from '../components/Volver'
import { useEsSuper, useSesion, useUsuario } from '../cliente/sesion'
import { Aviso } from '../components/Estado'
import { fechaHoraPY } from '../shared/hora'

type Tema = 'claro' | 'oscuro' | 'sistema'

const CLAVE_TEMA = 'chipa-tia-tema'
const COLOR_BARRA = { light: '#b8001a', dark: '#c8102e' }

/** Sin elección guardada el tema es claro (también lo aplica el script de index.html antes del primer render). */
function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE_TEMA)
    return v === 'oscuro' || v === 'sistema' ? v : 'claro'
  } catch {
    return 'claro'
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

const OPCIONES: { valor: Tema; nombre: string; icono: ReactNode }[] = [
  {
    valor: 'claro', nombre: 'Claro',
    icono: icono(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  },
  {
    valor: 'oscuro', nombre: 'Oscuro',
    icono: icono(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  },
  {
    valor: 'sistema', nombre: 'Como el celular',
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
      localStorage.setItem(CLAVE_TEMA, t)
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
              <span>{o.nombre}</span>
            </label>
          ))}
        </fieldset>
      </form>
      {usuario.rol === 'admin' && (
        <div className="tarjeta">
          <Link className="btn-discreto" to="/clave">Cambiar mi contraseña</Link>
        </div>
      )}
      {usuario.rol === 'admin' && <AjustesAvanzados />}
    </div>
  )
}

/** Modo super-administrador: se pide la contraseña y dura 30 minutos en esta sesión. Escondido en «Ajustes avanzados». */
function AjustesAvanzados() {
  const { usuario, activarSuper, salirSuper } = useSesion()
  const esSuper = useEsSuper()
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const hasta = usuario?.superHasta ? fechaHoraPY(usuario.superHasta).slice(11) : ''

  const correr = async (f: () => Promise<void>) => {
    setError(null)
    setEnviando(true)
    try {
      await f()
      setClave('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="tarjeta ajustes-avanzados" open={esSuper}>
      <summary>Ajustes avanzados</summary>
      {esSuper ? (
        <>
          <p><strong>Modo super-administrador activo</strong> hasta las {hasta}. Ahora podés crear y borrar almacenes en Depósitos.</p>
          <Aviso>{error}</Aviso>
          <button className="btn-secundario" disabled={enviando} onClick={() => void correr(salirSuper)}>Salir del modo super-administrador</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (clave) void correr(() => activarSuper(clave)) }}>
          <p className="suave chico">
            El modo super-administrador habilita cambios que se hacen cada tanto, como crear o borrar almacenes en frío.
            Dura 30 minutos y solo en este aparato.
          </p>
          <label className="campo">
            <span>Tu contraseña</span>
            <input type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          <Aviso>{error}</Aviso>
          <button className="btn-primario" type="submit" disabled={enviando || !clave}>{enviando ? 'Activando…' : 'Activar modo super-administrador'}</button>
        </form>
      )}
    </details>
  )
}
