import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { esVistaDeSector, menuDe, SIGLA_SECTOR } from '../cliente/menu'
import { useSectores } from '../cliente/catalogo'
import { useSesion, useUsuario } from '../cliente/sesion'
import { Icono } from './Iconos'
import { NOMBRE_ROL_GENERAL, sectorDeRol, veTodosLosSectores } from '../shared/permisos'
import { SECTOR_IDS, type Sector, type SectorId } from '../shared/tipos'
import '../styles/lateral.css'

const SectorActivo = createContext<Sector>({ id: 'chiperia', nombre: 'Chipería', conLotes: true })
const ElegirSector = createContext<(s: SectorId) => void>(() => undefined)

/** Sector que se está mirando: el propio para un operador; el elegido en el menú o en cada pantalla para el administrador y el supervisor. */
export const useSector = () => useContext(SectorActivo).id
export const useSectorActivo = () => useContext(SectorActivo)
/** Cambia el sector elegido (administrador y supervisor); para un operador no hace nada. */
export const useElegirSector = () => useContext(ElegirSector)

const CLAVE_ELEGIDO = 'chipa-tia-sector'
const CLAVE_PLEGADO = 'chipa-tia-menu-plegado'

function leerElegido(): SectorId {
  try {
    const v = sessionStorage.getItem(CLAVE_ELEGIDO)
    return (SECTOR_IDS as string[]).includes(v ?? '') ? (v as SectorId) : 'chiperia'
  } catch {
    return 'chiperia'
  }
}

function leerPlegado(): boolean {
  try {
    return localStorage.getItem(CLAVE_PLEGADO) === '1'
  } catch {
    return false
  }
}

const NOMBRE_ROL: Record<string, string> = { ...NOMBRE_ROL_GENERAL }

export default function Layout() {
  const usuario = useUsuario()
  const { salir } = useSesion()
  const sectores = useSectores()
  // Administrador y supervisor miran todos los sectores y eligen cuál en el menú; el cajero no tiene sector.
  const general = veTodosLosSectores(usuario.rol)
  const propio = sectorDeRol(usuario.rol)
  const { pathname, search } = useLocation()
  const [elegido, setElegido] = useState<SectorId>(leerElegido)
  const id: SectorId = propio ?? elegido
  const sector: Sector = sectores.lista.find((s) => s.id === id) ?? { id, nombre: '', conLotes: id === 'chiperia' }
  const grupos = menuDe(usuario.rol, sector.conLotes, sectores.lista)
  const enVistaDeSector = esVistaDeSector(pathname)
  const verActual = new URLSearchParams(search).get('ver') ?? ''

  // Escritorio: la barra se pliega a solo íconos y lo recuerda. Celular: el menú se abre como una página entera.
  const [plegado, setPlegado] = useState(leerPlegado)
  const [abierto, setAbierto] = useState(false)
  const botonAbrir = useRef<HTMLButtonElement>(null)
  const botonCerrar = useRef<HTMLButtonElement>(null)

  const plegar = () => {
    setPlegado((v) => {
      try {
        localStorage.setItem(CLAVE_PLEGADO, v ? '0' : '1')
      } catch {
        // sin almacenamiento
      }
      return !v
    })
  }

  // Al navegar, el menú del celular se cierra solo.
  useEffect(() => setAbierto(false), [pathname, search])

  // Menú abierto en el celular: la página de abajo no se desplaza, Escape lo cierra y el foco va al botón de cerrar.
  useEffect(() => {
    if (!abierto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    botonCerrar.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    document.addEventListener('keydown', tecla)
    // Si la pantalla se agranda a escritorio con el menú abierto, se cierra.
    const ancho = matchMedia('(min-width: 900px)')
    const alCambiar = () => ancho.matches && setAbierto(false)
    ancho.addEventListener('change', alCambiar)
    return () => {
      document.body.style.overflow = anterior
      // El foco quedó en el menú que se ocultó: vuelve al botón ☰ (después de quitar el inert).
      const foco = document.activeElement
      if (!foco || foco === document.body || foco.closest('.lateral')) requestAnimationFrame(() => botonAbrir.current?.focus())
      document.removeEventListener('keydown', tecla)
      ancho.removeEventListener('change', alCambiar)
    }
  }, [abierto])

  const cerrar = () => setAbierto(false)

  const elegir = (s: SectorId) => {
    if (!general || s === elegido) return
    setElegido(s)
    try {
      sessionStorage.setItem(CLAVE_ELEGIDO, s)
    } catch {
      // sin almacenamiento
    }
  }

  const nombreRol = propio ? sector.nombre : NOMBRE_ROL[usuario.rol] ?? ''
  const iniciales = (texto: string) => texto.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  const logo = <img className="logo" src="./logo.png" alt="Chipa Tía, ir al inicio" width="50" height="40" />

  return (
    <SectorActivo.Provider value={sector}>
    <ElegirSector.Provider value={elegir}>
      <div className={`app${plegado ? ' plegado' : ''}${abierto ? ' menu-abierto' : ''}`}>
        {/* Celular: barra de arriba con el botón del menú. */}
        <header className="barra-movil" inert={abierto}>
          <button
            ref={botonAbrir}
            type="button"
            className="btn-lateral"
            onClick={() => setAbierto(true)}
            aria-label="Abrir menú"
            aria-expanded={abierto}
            aria-controls="menu-principal"
          >
            <Icono nombre="menu" />
          </button>
          <Link to="/" className="marca">{logo}</Link>
          <button type="button" className="sector-movil" onClick={() => setAbierto(true)} >
            {general && enVistaDeSector ? sector.nombre : nombreRol}
          </button>
        </header>

        <aside id="menu-principal" className="lateral" aria-label="Menú principal">
          <div className="lateral-cabeza">
            <Link to="/" className="marca" title="Inicio">{logo}</Link>
            <button
              type="button"
              className="btn-lateral solo-escritorio"
              onClick={plegar}
              aria-label={plegado ? 'Desplegar menú' : 'Plegar menú'}
              aria-expanded={!plegado}
              title={plegado ? 'Desplegar menú' : 'Plegar menú'}
            >
              <Icono nombre={plegado ? 'desplegar' : 'plegar'} />
            </button>
            <button ref={botonCerrar} type="button" className="btn-lateral solo-movil" onClick={cerrar} aria-label="Cerrar menú">
              <Icono nombre="cancelar" />
            </button>
          </div>

          {!general && (
            <div className="lateral-sector">
              <span className="lateral-etiqueta" aria-hidden="true">{propio ? 'Sector' : 'Rol'}</span>
              <span className="sector-fijo" title={nombreRol}>
                <span className="sector-plegado" aria-hidden="true">{(propio && SIGLA_SECTOR[propio]) || iniciales(nombreRol)}</span>
                <span className="lateral-texto">{nombreRol}</span>
              </span>
            </div>
          )}

          <nav className="lateral-nav" aria-label="Secciones">
            {grupos.map((g) => (
              <div key={g.titulo} className="lateral-grupo">
                <p className="lateral-titulo" id={`grupo-${g.titulo}`}>{g.titulo}</p>
                <ul aria-labelledby={`grupo-${g.titulo}`}>
                  {g.opciones.map((o) => (
                    <li key={o.a + o.texto}>
                      {o.sector ? (
                        // Un sector (administrador): lo elige y abre su vista; se marca mientras se mira ese sector.
                        <Link
                          to={o.a}
                          onClick={() => elegir(o.sector!)}
                          title={plegado ? o.texto : undefined}
                          className={enVistaDeSector && sector.id === o.sector ? 'active' : ''}
                          aria-current={enVistaDeSector && sector.id === o.sector ? 'page' : undefined}
                        >
                          <span className="sigla-sector" aria-hidden="true">{SIGLA_SECTOR[o.sector]}</span>
                          <span className="lateral-texto">{o.texto}</span>
                        </Link>
                      ) : (
                        o.ver ? (
                          // Una pestaña de una pantalla (Productos y Catálogos): se marca según ?ver.
                          <Link
                            to={o.a}
                            title={plegado ? o.texto : undefined}
                            className={pathname === o.a.split('?')[0] && o.ver.includes(verActual) ? 'active' : ''}
                            aria-current={pathname === o.a.split('?')[0] && o.ver.includes(verActual) ? 'page' : undefined}
                          >
                            <Icono nombre={o.icono} />
                            <span className="lateral-texto">{o.texto}</span>
                          </Link>
                        ) : (
                          <NavLink to={o.a} end={o.exacta} title={plegado ? o.texto : undefined}>
                            <Icono nombre={o.icono} />
                            <span className="lateral-texto">{o.texto}</span>
                          </NavLink>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="lateral-pie">
            <NavLink to="/configuracion" title={plegado ? 'Configuración' : undefined}>
              <Icono nombre="configuracion" />
              <span className="lateral-texto">Configuración</span>
            </NavLink>
            <div className="lateral-usuario">
              <span className="avatar" aria-hidden="true">{iniciales(usuario.nombre)}</span>
              <span className="lateral-texto">
                <strong title={usuario.nombre}>{usuario.nombre}</strong>
                <small>{nombreRol}</small>
              </span>
              <button type="button" className="btn-lateral" onClick={() => void salir()} aria-label="Salir" title="Salir">
                <Icono nombre="salir" />
              </button>
            </div>
          </div>
        </aside>

        <main className="contenido" inert={abierto}>
          <Outlet />
        </main>
      </div>
    </ElegirSector.Provider>
    </SectorActivo.Provider>
  )
}

/**
 * Elegir el sector dentro de una pantalla (administrador y supervisor): Producción, Stock, Salidas, Máquinas…
 * Para un operador no muestra nada, porque solo ve su sector. Con `todos`, suma la opción «Todos los sectores».
 */
export function SelectorSector({ todos }: { todos?: { activo: boolean; cambiar: (v: boolean) => void } }) {
  const usuario = useUsuario()
  const sectores = useSectores()
  const actual = useSector()
  const elegir = useElegirSector()
  if (!veTodosLosSectores(usuario.rol) || !sectores.lista.length) return null
  return (
    <div className="segmentado chico selector-sector" role="group" aria-label="Sector">
      {sectores.lista.map((s) => {
        const activo = !todos?.activo && s.id === actual
        return (
          <button
            key={s.id} type="button" aria-pressed={activo} className={activo ? 'activo' : ''}
            onClick={() => { todos?.cambiar(false); elegir(s.id) }}
          >
            {s.nombre}
          </button>
        )
      })}
      {todos && (
        <button type="button" aria-pressed={todos.activo} className={todos.activo ? 'activo' : ''} onClick={() => todos.cambiar(true)}>
          Todos los sectores
        </button>
      )}
    </div>
  )
}
