import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSesion } from './cliente/sesion'
import { inicioDe, puede, type Permiso } from './shared/permisos'
import { Cargando } from './components/Estado'
import Layout from './components/Layout'
import Login from './pages/Login'
import CambiarClave from './pages/CambiarClave'
import Configuracion from './pages/Configuracion'
import InicioSector from './pages/sector/Inicio'
import Produccion from './pages/sector/Produccion'
import Stock from './pages/sector/Stock'
import Salida from './pages/sector/Salida'
import Envio from './pages/sector/Envio'
import Historial from './pages/sector/Historial'
import Maquinas from './pages/sector/Maquinas'
import LimpiezaPage from './pages/sector/Limpieza'
import Lotes from './pages/sector/Lotes'
import Trazabilidad from './pages/sector/Trazabilidad'
import Resumen from './pages/admin/Resumen'
import Usuarios from './pages/admin/Usuarios'
import Catalogos from './pages/admin/Catalogos'
import Ajustes from './pages/admin/Ajustes'
import Registros from './pages/admin/Registros'
import Controles from './pages/admin/Controles'
import Reportes, { RecordarEnlaceReporte } from './pages/admin/Reportes'
import Datos from './pages/admin/Datos'
import InicioCaja from './pages/caja/Inicio'
import Compras from './pages/compras/Compras'

export default function App() {
  const { usuario, cargando } = useSesion()
  if (cargando) return <div className="login"><Cargando /></div>
  if (!usuario) {
    return (
      <>
        {/* El enlace del correo (H04) abre el reporte después de entrar. */}
        <RecordarEnlaceReporte />
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </>
    )
  }
  if (usuario.debeCambiarClave) return <CambiarClave />
  const p = (permiso: Permiso) => puede(usuario.rol, permiso)
  // Cada pantalla se monta solo si el rol tiene el permiso (src/shared/permisos.ts); si no, vuelve a su inicio.
  const ruta = (path: string, permiso: Permiso | Permiso[], element: ReactElement) =>
    ([] as Permiso[]).concat(permiso).every(p) ? <Route key={path} path={path} element={element} /> : null
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={inicioDe(usuario.rol)} replace />} />
        {/* Inicio del sector: los sectores y el administrador (que carga en cualquier sector). */}
        {ruta('sector', 'produccion.cargar', <InicioSector />)}
        {ruta('sector/produccion', 'produccion.cargar', <Produccion />)}
        {ruta('sector/stock', 'stock.mover', <Stock />)}
        {ruta('sector/salida', 'stock.mover', <Salida />)}
        {ruta('sector/envio', 'stock.mover', <Envio />)}
        {ruta('sector/historial', 'stock.ver', <Historial />)}
        {ruta('sector/maquinas', 'maquinas.ver', <Maquinas />)}
        {ruta('sector/limpieza', 'limpieza.cargar', <LimpiezaPage />)}
        {ruta('sector/lotes', 'lotes.ver', <Lotes />)}
        {ruta('trazabilidad', 'trazabilidad.ver', <Trazabilidad />)}
        <Route path="clave" element={<CambiarClave />} />
        <Route path="configuracion" element={<Configuracion />} />
        {ruta('admin', 'reportes.ver', <Resumen />)}
        {ruta('admin/usuarios', 'usuarios.gestionar', <Usuarios />)}
        {ruta('admin/catalogos', 'catalogos.editar', <Catalogos />)}
        {ruta('admin/stock', 'stock.ver', <Ajustes />)}
        {ruta('admin/registros', 'produccion.ver', <Registros />)}
        {ruta('admin/controles', 'limpieza.ver', <Controles />)}
        {ruta('admin/historial', 'stock.ver', <Historial />)}
        {ruta('admin/reportes', 'reportes.ver', <Reportes />)}
        {ruta('admin/datos', 'datos.gestionar', <Datos />)}
        {ruta('compras', 'compras.registrar', <Compras />)}
        {/* Etapa 3: venta, factura y caja. Por ahora, el inicio del cajero. */}
        {usuario.rol === 'cajero' && <Route path="caja" element={<InicioCaja />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
