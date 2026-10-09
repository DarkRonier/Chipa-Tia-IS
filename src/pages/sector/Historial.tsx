import { useState } from 'react'
import Volver from '../../components/Volver'
import { useSector } from '../../components/Layout'
import { diaPY, fechaHora, useDatos, type TipoMovimiento } from '../../mock/store'

export const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  produccion: 'Producción', stock_inicial: 'Stock inicial', salida_venta: 'Salida a venta', envio: 'Envío',
  merma: 'Merma', vencimiento: 'Vencimiento', ajuste: 'Ajuste',
}

export default function Historial() {
  const { datos, usuario } = useDatos()
  const sector = useSector()
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [producto, setProducto] = useState('')

  const salidas = datos.movimientos
    .filter((m) => m.sector === sector && m.cantidad < 0)
    .filter((m) => (!desde || diaPY(m.fecha) >= desde) && (!hasta || diaPY(m.fecha) <= hasta))
    .filter((m) => !sucursal || m.sucursalId === sucursal)
    .filter((m) => !producto || m.productoId === producto)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))

  const nombre = (id: string) => datos.productos.find((p) => p.id === id)?.nombre ?? id

  return (
    <>
      <Volver titulo="Historial de salidas" a={usuario!.rol === 'admin' ? '/admin' : '/sector'} />
      <div className="tarjeta filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo">
          <span>Sucursal</span>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Todas</option>
            {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Producto</span>
          <select value={producto} onChange={(e) => setProducto(e.target.value)}>
            <option value="">Todos</option>
            {datos.productos.filter((p) => p.sector === sector).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
      </div>
      {salidas.length === 0 ? (
        <p className="suave">No hay salidas con esos filtros.</p>
      ) : (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cant.</th></tr></thead>
          <tbody>
            {salidas.map((m) => (
              <tr key={m.id}>
                <td>{fechaHora(m.fecha)}</td>
                <td>
                  {nombre(m.productoId)}
                  {m.lote && <div className="suave chico">Lote {m.lote}</div>}
                </td>
                <td>
                  {NOMBRE_TIPO[m.tipo]}
                  {m.sucursalId && <div className="suave chico">{datos.sucursales.find((s) => s.id === m.sucursalId)?.nombre}</div>}
                  {m.motivo && <div className="suave chico">{m.motivo}</div>}
                </td>
                <td className="num">{-m.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
