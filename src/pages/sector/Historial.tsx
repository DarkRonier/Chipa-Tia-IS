// D05, D06: historial de salidas del frío (ventas, envíos, mermas, vencimientos y ajustes),
// filtrable por fecha, sucursal, producto y tipo. Cada fila dice quién, cuándo y por qué.
import { useState } from 'react'
import { useConsulta } from '../../cliente/consultas'
import { ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import Volver from '../../components/Volver'
import { useUsuario } from '../../cliente/sesion'
import { fechaHoraPY } from '../../shared/hora'
import { NOMBRE_TIPO_MOVIMIENTO, type Movimiento, type Producto, type Sucursal, type TipoMovimiento } from '../../shared/tipos'
import { useStock } from './Stock'
import '../../styles/stock.css'

/** "+8" o "−3" (con signo menos tipográfico). */
export const conSigno = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

const SALIDAS: TipoMovimiento[] = ['salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste']

/** Opciones del filtro de tipo: el valor es la lista que entiende `GET /movimientos?tipo=`. */
const OPCIONES_TIPO: { valor: string; texto: string }[] = [
  { valor: SALIDAS.join(','), texto: 'Todas las salidas' },
  { valor: 'salida_venta', texto: NOMBRE_TIPO_MOVIMIENTO.salida_venta },
  { valor: 'envio', texto: 'Envíos a sucursal' },
  { valor: 'merma', texto: NOMBRE_TIPO_MOVIMIENTO.merma },
  { valor: 'vencimiento', texto: NOMBRE_TIPO_MOVIMIENTO.vencimiento },
  { valor: 'ajuste', texto: 'Ajustes' },
  { valor: 'stock_inicial', texto: NOMBRE_TIPO_MOVIMIENTO.stock_inicial },
  { valor: 'produccion', texto: 'Producción (lo guardado)' },
  { valor: '', texto: 'Todos los movimientos' },
]

/** Lista de movimientos: tabla en la computadora, tarjetas en el celular. */
export function TablaMovimientos({ movimientos }: { movimientos: Movimiento[] }) {
  return (
    <table className="tabla stk-movs">
      <thead>
        <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cant.</th></tr>
      </thead>
      <tbody>
        {movimientos.map((m) => (
          <tr key={m.id}>
            <td className="stk-cuando">
              {fechaHoraPY(m.fecha)}
              <div className="suave chico">{m.usuarioNombre}</div>
            </td>
            <td className="stk-que">
              {m.productoNombre}
              {m.lote && <div className="suave chico">Lote {m.lote}</div>}
            </td>
            <td className="stk-tipo">
              <span className={`stk-etiqueta stk-${m.tipo}`}>{NOMBRE_TIPO_MOVIMIENTO[m.tipo]}</span>
              {m.sucursalNombre && <div className="chico">{m.sucursalNombre}</div>}
              {m.motivo && <div className="suave chico">Motivo: {m.motivo}</div>}
            </td>
            <td className={`num stk-cant ${m.cantidad < 0 ? 'stk-resta' : 'stk-suma'}`}>{conSigno(m.cantidad)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Historial() {
  const { id: sector } = useSectorActivo()
  // Al cambiar de sector (administrador) los filtros de producto vuelven a cero.
  return <Pantalla key={sector} />
}

function Pantalla() {
  const usuario = useUsuario()
  const esAdmin = usuario.rol === 'admin'
  const { id: sector, nombre: nombreSector } = useSectorActivo()
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [producto, setProducto] = useState('')
  const [tipo, setTipo] = useState(OPCIONES_TIPO[0].valor)

  const sucursales = useConsulta<Sucursal[]>('/sucursales', { todos: esAdmin })
  const productos = useConsulta<Producto[]>('/productos', { sector, todos: esAdmin })
  const stock = useStock(sector)
  const fechasAlReves = !!desde && !!hasta && desde > hasta
  const movimientos = useConsulta<Movimiento[]>(fechasAlReves ? null : '/movimientos', {
    sector, desde, hasta, sucursal, producto, tipo,
  })

  // Productos para filtrar: los del catálogo y los desactivados que todavía tienen stock.
  const opcionesProducto = [...(productos.datos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))]
  for (const f of stock.datos ?? []) {
    if (!opcionesProducto.some((p) => p.id === f.productoId)) opcionesProducto.push({ id: f.productoId, nombre: f.productoNombre })
  }
  const hayFiltros = !!(desde || hasta || sucursal || producto || tipo !== OPCIONES_TIPO[0].valor)
  const limpiar = () => {
    setDesde('')
    setHasta('')
    setSucursal('')
    setProducto('')
    setTipo(OPCIONES_TIPO[0].valor)
  }

  return (
    <>
      <Volver titulo={esAdmin ? `Historial de salidas · ${nombreSector}` : 'Historial de salidas'} a={esAdmin ? '/admin' : '/sector'} />
      <div className="tarjeta filtros stk-filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo">
          <span>Sucursal</span>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Todas</option>
            {(sucursales.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.activo ? '' : ' (desactivada)'}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Producto</span>
          <select value={producto} onChange={(e) => setProducto(e.target.value)}>
            <option value="">Todos</option>
            {opcionesProducto.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {OPCIONES_TIPO.map((o) => <option key={o.texto} value={o.valor}>{o.texto}</option>)}
          </select>
        </label>
        {hayFiltros && <button type="button" className="btn-texto stk-limpiar" onClick={limpiar}>Quitar filtros</button>}
      </div>
      {fechasAlReves ? (
        <p className="error" role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>
      ) : (
        <ConDatos consulta={movimientos}>
          {(lista) => {
            if (lista.length === 0) return <p className="suave">{hayFiltros ? 'No hay movimientos con esos filtros.' : 'Todavía no hay salidas registradas.'}</p>
            const salieron = lista.filter((m) => m.cantidad < 0).reduce((s, m) => s - m.cantidad, 0)
            const entraron = lista.filter((m) => m.cantidad > 0).reduce((s, m) => s + m.cantidad, 0)
            return (
              <>
                <p className="suave stk-resumen" role="status">
                  {lista.length === 1 ? '1 movimiento' : `${lista.length} movimientos`}
                  {salieron > 0 && <> · salieron <strong>{salieron}</strong></>}
                  {entraron > 0 && <> · entraron <strong>{entraron}</strong></>}
                </p>
                <TablaMovimientos movimientos={lista} />
              </>
            )
          }}
        </ConDatos>
      )}
    </>
  )
}
