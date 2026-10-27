import { createContext, useContext, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSectores } from '../cliente/catalogo'
import { useSesion, useUsuario } from '../cliente/sesion'
import { SECTOR_IDS, type Sector, type SectorId } from '../shared/tipos'

const SectorActivo = createContext<Sector>({ id: 'chiperia', nombre: 'Chipería', conLotes: true })

/** Sector que se está mirando: el propio para un operador; el elegido arriba para el administrador. */
export const useSector = () => useContext(SectorActivo).id
export const useSectorActivo = () => useContext(SectorActivo)

const CLAVE_ELEGIDO = 'chipa-tia-sector'

function leerElegido(): SectorId {
  try {
    const v = sessionStorage.getItem(CLAVE_ELEGIDO)
    return (SECTOR_IDS as string[]).includes(v ?? '') ? (v as SectorId) : 'chiperia'
  } catch {
    return 'chiperia'
  }
}

export default function Layout() {
  const usuario = useUsuario()
  const { salir } = useSesion()
  const sectores = useSectores()
  const esAdmin = usuario.rol === 'admin'
  // «Lotes» vive bajo /sector pero tiene su propia pestaña: «Vista del sector» no se marca ahí.
  const enLotes = useLocation().pathname.startsWith('/sector/lotes')
  const [elegido, setElegido] = useState<SectorId>(leerElegido)
  const id: SectorId = esAdmin ? elegido : (usuario.rol as SectorId)
  const sector: Sector = sectores.lista.find((s) => s.id === id) ?? { id, nombre: '', conLotes: id === 'chiperia' }

  const elegir = (s: SectorId) => {
    setElegido(s)
    try {
      sessionStorage.setItem(CLAVE_ELEGIDO, s)
    } catch {
      // sin almacenamiento
    }
  }

  return (
    <SectorActivo.Provider value={sector}>
      <header className="barra">
        <Link to="/" className="marca"><img className="logo" src="./logo.png" alt="Chipa Tía" width="50" height="40" /></Link>
        <div className="barra-der">
          {esAdmin ? (
            <select aria-label="Sector a ver" title={sector.nombre} value={elegido} onChange={(e) => elegir(e.target.value as SectorId)}>
              {sectores.lista.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          ) : (
            <span className="chip" title={sector.nombre}>{sector.nombre}</span>
          )}
          <NavLink className="btn-texto btn-icono" to="/configuracion" aria-label="Configuración" title="Configuración">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </NavLink>
          <button className="btn-texto" onClick={() => void salir()}>Salir</button>
        </div>
      </header>
      {esAdmin && (
        <nav className="pestanas">
          <NavLink to="/admin" end>Resumen</NavLink>
          <NavLink to="/admin/registros">Producción</NavLink>
          <NavLink to="/admin/stock">Stock</NavLink>
          <NavLink to="/admin/historial">Salidas</NavLink>
          <NavLink to="/admin/controles">Limpieza y temp.</NavLink>
          <NavLink to="/sector/lotes">Lotes</NavLink>
          <NavLink to="/trazabilidad">Trazabilidad</NavLink>
          <NavLink to="/admin/reportes">Reportes</NavLink>
          <NavLink to="/admin/catalogos">Catálogos</NavLink>
          <NavLink to="/admin/usuarios">Usuarios</NavLink>
          <NavLink to="/admin/datos">Datos</NavLink>
          <NavLink to="/sector" className={({ isActive }) => (isActive && !enLotes ? 'active' : '')}>Vista del sector</NavLink>
        </nav>
      )}
      <main className="contenido">
        <Outlet />
      </main>
      <footer className="pie">
        {usuario.nombre}
      </footer>
    </SectorActivo.Provider>
  )
}
