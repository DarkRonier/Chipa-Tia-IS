// D02, D04, C05: sacar del frío para reponer la venta. Sale de lo guardado con esa finalidad («Reponer venta»);
// muestra lo que hay y no deja sacar de más. En Chipería se elige el lote (aparece primero el más viejo).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSector, useSectorActivo } from '../../components/Layout'
import Numero from '../../components/Numero'
import { IconoVenta } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaPY } from '../../shared/hora'
import type { Movimiento, PedidoSalida } from '../../shared/tipos'
import { TablaMovimientos } from './Historial'
import { useStock } from './Stock'
import '../../styles/stock.css'

export default function Salida() {
  // Al cambiar de sector (administrador) el formulario empieza de cero.
  const sector = useSector()
  return <Formulario key={sector} />
}

function Formulario() {
  const { id: sector, conLotes } = useSectorActivo()
  const stock = useStock(sector)
  const hoy = diaPY()
  const deHoy = useConsulta<Movimiento[]>('/movimientos', { sector, desde: hoy, hasta: hoy, tipo: 'salida_venta' })
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const registrar = useAccion((p: PedidoSalida) => post<Movimiento>('/salidas', p))

  const filas = stock.datos ?? []
  const fila = filas.find((f) => f.productoId === productoId)
  // Se listan los productos con stock para reponer la venta (y el elegido, aunque se haya quedado en 0).
  const conStock = filas.filter((f) => f.reposicion > 0 || f.productoId === productoId)
  const lotes = (fila?.lotes ?? []).filter((l) => l.reposicion > 0)
  const disponible = !fila ? 0 : conLotes ? (lotes.find((l) => l.lote === lote)?.reposicion ?? 0) : fila.reposicion
  const soloParaSucursales = filas.some((f) => f.distribucion > 0)

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    registrar.limpiarError()
  }

  const elegirProducto = (id: string) => {
    limpiarMensajes()
    setProductoId(id)
    // Sugiere el lote más viejo: es el que conviene sacar primero.
    setLote(filas.find((f) => f.productoId === id)?.lotes.find((l) => l.reposicion > 0)?.lote ?? '')
  }

  const guardar = async () => {
    limpiarMensajes()
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote) return setAviso('Elegí de qué lote sale.')
    if (cantidad <= 0) return setAviso('Cargá la cantidad que sale.')
    if (cantidad > disponible) {
      return setAviso(disponible === 0 ? 'No queda stock de eso.' : `Solo hay ${disponible} en stock${conLotes ? ' en ese lote' : ''}.`)
    }
    const r = await registrar.ejecutar({ sector, productoId, lote: conLotes ? lote : null, cantidad })
    if (r) {
      const quedan = disponible - cantidad
      setListo(`Listo: salieron ${cantidad} de ${r.productoNombre}${r.lote ? ` (lote ${r.lote})` : ''}. Quedan ${quedan}${r.lote ? ' en ese lote' : ''}.`)
      setCantidad(0)
      if (quedan === 0) {
        setProductoId('')
        setLote('')
      }
    }
  }

  const error = aviso ?? registrar.error

  return (
    <>
      <Volver titulo="Sacar para la venta" icono={<IconoVenta />} />
      <ConDatos consulta={stock}>
        {() => conStock.length === 0 && !listo ? (
          <p className="suave">
            No hay nada guardado en frío para reponer la venta.
            {soloParaSucursales && <> Lo que hay está guardado para sucursales: podés cambiarle la finalidad desde <Link to="/sector/stock">Stock en frío</Link>.</>}
          </p>
        ) : (
          <div className="tarjeta">
            <label className="campo">
              <span>Producto</span>
              <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
                <option value="">Elegí un producto</option>
                {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({f.reposicion})</option>)}
              </select>
            </label>
            {conLotes && fila && (
              <label className="campo">
                <span>Lote</span>
                <select value={lote} onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}>
                  <option value="">Elegí un lote</option>
                  {lotes.map((l, i) => (
                    <option key={l.lote} value={l.lote}>{l.lote} ({l.reposicion}){i === 0 && lotes.length > 1 ? ' · el más viejo' : ''}</option>
                  ))}
                </select>
              </label>
            )}
            <Numero
              etiqueta={fila && (!conLotes || lote) ? `Cantidad (hay ${disponible})` : 'Cantidad'}
              valor={cantidad}
              onChange={(n) => { limpiarMensajes(); setCantidad(n) }}
            />
            {fila && cantidad > disponible && !error && (
              <p className="error">Es más de lo que hay ({disponible}).</p>
            )}
            <Aviso>{error}</Aviso>
            <Aviso tipo="ok">{listo}</Aviso>
            <button className="btn-primario" onClick={() => void guardar()} disabled={registrar.enviando}>
              {registrar.enviando ? 'Registrando…' : 'Registrar salida'}
            </button>
          </div>
        )}
      </ConDatos>
      {!!deHoy.datos?.length && (
        <>
          <h2>Salidas de hoy</h2>
          <TablaMovimientos movimientos={deHoy.datos} />
        </>
      )}
    </>
  )
}
