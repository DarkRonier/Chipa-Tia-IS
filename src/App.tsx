import { Navigate, Route, Routes } from 'react-router-dom'
import { useSesion } from './cliente/sesion'
import { Cargando } from './components/Estado'
import Layout from './components/Layout'
import Login from './pages/Login'
import CambiarClave from './pages/CambiarClave'
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
  const esAdmin = usuario.rol === 'admin'
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={esAdmin ? '/admin' : '/sector'} replace />} />
        <Route path="sector" element={<InicioSector />} />
        <Route path="sector/produccion" element={<Produccion />} />
        <Route path="sector/stock" element={<Stock />} />
        <Route path="sector/salida" element={<Salida />} />
        <Route path="sector/envio" element={<Envio />} />
        <Route path="sector/historial" element={<Historial />} />
        <Route path="sector/maquinas" element={<Maquinas />} />
        <Route path="sector/limpieza" element={<LimpiezaPage />} />
        <Route path="sector/lotes" element={<Lotes />} />
        <Route path="trazabilidad" element={<Trazabilidad />} />
        <Route path="clave" element={<CambiarClave />} />
        {esAdmin && (
          <>
            <Route path="admin" element={<Resumen />} />
            <Route path="admin/usuarios" element={<Usuarios />} />
            <Route path="admin/catalogos" element={<Catalogos />} />
            <Route path="admin/stock" element={<Ajustes />} />
            <Route path="admin/registros" element={<Registros />} />
            <Route path="admin/controles" element={<Controles />} />
            <Route path="admin/historial" element={<Historial />} />
            <Route path="admin/reportes" element={<Reportes />} />
            <Route path="admin/datos" element={<Datos />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
