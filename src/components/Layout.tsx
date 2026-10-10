import { createContext, useContext, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { esDemo } from '../cliente/api'
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
  const [elegido, setElegido] = useState<SectorId>(leerElegido)
  const [confirmar, setConfirmar] = useState(false)
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

  const reiniciar = async () => {
    const { reiniciarDemo } = await import('../demo/servidor')
    await reiniciarDemo()
    location.reload()
  }

  return (
    <SectorActivo.Provider value={sector}>
      {esDemo && <div className="aviso">Demo · los datos se guardan solo en este navegador</div>}
      <header className="barra">
        <Link to="/" className="marca">Chipa Tía</Link>
        <div className="barra-der">
          {esAdmin ? (
            <select aria-label="Sector a ver" title={sector.nombre} value={elegido} onChange={(e) => elegir(e.target.value as SectorId)}>
              {sectores.lista.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          ) : (
            <span className="chip" title={sector.nombre}>{sector.nombre}</span>
          )}
          <Link className="btn-texto" to="/clave">Contraseña</Link>
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
          <NavLink to="/sector">Vista del sector</NavLink>
        </nav>
      )}
      <main className="contenido">
        <Outlet />
      </main>
      <footer className="pie">
        {usuario.nombre}
        {esDemo && (
          <>
            {' · '}
            {confirmar ? (
              <>
                ¿Borrar lo cargado y volver a los datos de ejemplo?{' '}
                <button className="btn-texto" onClick={() => void reiniciar()}>Sí, reiniciar</button>
                <button className="btn-texto" onClick={() => setConfirmar(false)}>Cancelar</button>
              </>
            ) : (
              <button className="btn-texto" onClick={() => setConfirmar(true)}>Reiniciar datos de ejemplo</button>
            )}
          </>
        )}
      </footer>
    </SectorActivo.Provider>
  )
}
