import { createContext, useContext, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { SECTORES, type SectorId } from '../mock/data'
import { useDatos } from '../mock/store'

const SectorActivo = createContext<SectorId>('chiperia')

// Para un operador es su propio sector; el administrador elige cuál mirar.
export const useSector = () => useContext(SectorActivo)

export default function Layout() {
  const { usuario, salir, reiniciar } = useDatos()
  const esAdmin = usuario!.rol === 'admin'
  const [elegido, setElegido] = useState<SectorId>('chiperia')
  const [confirmar, setConfirmar] = useState(false)
  const sector = esAdmin ? elegido : (usuario!.rol as SectorId)
  const nombreSector = SECTORES.find((s) => s.id === sector)!.nombre

  return (
    <SectorActivo.Provider value={sector}>
      <div className="aviso">Prototipo con datos de ejemplo · nada se guarda en el servidor</div>
      <header className="barra">
        <Link to="/" className="marca">Chipa Tía</Link>
        <div className="barra-der">
          {esAdmin ? (
            <select aria-label="Sector a ver" value={elegido} onChange={(e) => setElegido(e.target.value as SectorId)}>
              {SECTORES.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          ) : (
            <span className="chip">{nombreSector}</span>
          )}
          <button className="btn-texto" onClick={salir}>Salir</button>
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
          <NavLink to="/admin/catalogos">Catálogos</NavLink>
          <NavLink to="/admin/usuarios">Usuarios</NavLink>
          <NavLink to="/sector">Vista del sector</NavLink>
        </nav>
      )}
      <main className="contenido">
        <Outlet />
      </main>
      <footer className="pie">
        {usuario!.nombre} ·{' '}
        {confirmar ? (
          <>
            ¿Borrar lo cargado y volver a los datos de ejemplo?{' '}
            <button className="btn-texto" onClick={() => { reiniciar(); setConfirmar(false) }}>Sí, reiniciar</button>
            <button className="btn-texto" onClick={() => setConfirmar(false)}>Cancelar</button>
          </>
        ) : (
          <button className="btn-texto" onClick={() => setConfirmar(true)}>Reiniciar datos de ejemplo</button>
        )}
      </footer>
    </SectorActivo.Provider>
  )
}
