// D02, D04: sacar para la venta. Pasa unidades de un almacén (por defecto, el primero con algo) a un depósito de venta:
// «Venta frente» (de ahí descuentan las ventas de la caja) o «Venta comedor». Muestra lo que hay y no deja sacar de más. En Chipería se elige el lote (aparece
// primero el más viejo).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useCategorias, useDepositos } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSector, useSectorActivo } from '../../components/Layout'
import Numero from '../../components/Numero'
import { IconoVenta } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaPY } from '../../shared/hora'
import { DEPOSITO, type Movimiento, type PedidoSalida } from '../../shared/tipos'
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
  const depositos = useDepositos()
  const categorias = useCategorias()
  const [elegido, setElegido] = useState('')
  const [hacia, setHacia] = useState<string>(DEPOSITO.venta)
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const registrar = useAccion((p: PedidoSalida) => post<Movimiento>('/salidas', p))

  const filas = stock.datos ?? []
  const fila = filas.find((f) => f.productoId === productoId)
  // Se saca de un depósito frío (la materia prima no es un depósito: no se vende desde acá).
  const origenes = depositos.almacenes
  const desde = (origenes.find((d) => d.id === elegido) ?? origenes.find((d) => filas.some((f) => (f.porDeposito[d.id] ?? 0) > 0)) ?? origenes[0])?.id ?? ''
  const hay = (f: { porDeposito: Record<string, number> }) => f.porDeposito[desde] ?? 0
  // Cada depósito de venta recibe solo los productos de sus categorías (sin categoría cuenta como «Otros»).
  const ventaElegida = depositos.venta.find((d) => d.id === hacia)
  const otros = categorias.lista.find((c) => c.sistema)?.id
  const recibe = (f: { categoriaId: string | null }) => !ventaElegida || ventaElegida.categorias.includes(f.categoriaId ?? otros ?? '')
  // Se listan los productos con stock en el depósito elegido (y el elegido, aunque se haya quedado en 0).
  const conStock = filas.filter((f) => recibe(f) && (hay(f) > 0 || f.productoId === productoId))
  const lotes = (fila?.lotes ?? []).filter((l) => hay(l) > 0)
  const disponible = !fila ? 0 : conLotes ? hay(lotes.find((l) => l.lote === lote) ?? { porDeposito: {} }) : hay(fila)
  const enOtros = origenes.filter((d) => d.id !== desde && filas.some((f) => (f.porDeposito[d.id] ?? 0) > 0))
  const nombreVenta = depositos.nombre(hacia)

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    registrar.limpiarError()
  }

  const elegirProducto = (id: string) => {
    limpiarMensajes()
    setProductoId(id)
    // Sugiere el lote más viejo: es el que conviene sacar primero.
    setLote(filas.find((f) => f.productoId === id)?.lotes.find((l) => hay(l) > 0)?.lote ?? '')
  }

  const elegirOrigen = (id: string) => {
    limpiarMensajes()
    setElegido(id)
    setProductoId('')
    setLote('')
  }

  const guardar = async () => {
    limpiarMensajes()
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote) return setAviso('Elegí de qué lote sale.')
    if (cantidad <= 0) return setAviso('Cargá la cantidad que sale.')
    if (cantidad > disponible) {
      return setAviso(disponible === 0 ? 'No queda stock de eso.' : `Solo hay ${disponible} en «${depositos.nombre(desde)}»${conLotes ? ' en ese lote' : ''}.`)
    }
    const r = await registrar.ejecutar({ sector, productoId, lote: conLotes ? lote : null, cantidad, desde, hacia })
    if (r) {
      const quedan = disponible - cantidad
      setListo(`Listo: pasaron ${cantidad} de ${r.productoNombre}${r.lote ? ` (lote ${r.lote})` : ''} a «${nombreVenta}». Quedan ${quedan} en «${depositos.nombre(desde)}»${r.lote ? ' en ese lote' : ''}.`)
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
      <p className="suave chico">Pasa lo que sacás a un depósito de venta. Las ventas de la caja del frente descuentan de «{depositos.nombre(DEPOSITO.venta)}».</p>
      <ConDatos consulta={stock}>
        {() => (
          <div className="tarjeta">
            {depositos.venta.length > 1 && (
              <div className="segmentado" role="group" aria-label="Va a">
                {depositos.venta.map((d) => (
                  <button key={d.id} type="button" className={hacia === d.id ? 'activo' : ''} aria-pressed={hacia === d.id} onClick={() => { limpiarMensajes(); setHacia(d.id); setProductoId('') }}>
                    A {d.nombre}
                  </button>
                ))}
              </div>
            )}
            {origenes.length > 1 && (
              <label className="campo">
                <span>Sale de</span>
                <select value={desde} onChange={(e) => elegirOrigen(e.target.value)}>
                  {origenes.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                </select>
              </label>
            )}
            {conStock.length === 0 && !listo ? (
              <p className="suave">
                No hay nada en «{depositos.nombre(desde)}».
                {enOtros.length > 0 && <> Hay en {enOtros.map((d) => `«${d.nombre}»`).join(' y ')}: elegilo arriba.</>}
                {' '}Mirá lo que hay en <Link className="btn-discreto chico" to="/depositos">Depósitos</Link>.
              </p>
            ) : (<>
            <label className="campo">
              <span>Producto</span>
              <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
                <option value="">Elegí un producto</option>
                {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({hay(f)})</option>)}
              </select>
            </label>
            {conLotes && fila && (
              <label className="campo">
                <span>Lote</span>
                <select value={lote} onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}>
                  <option value="">Elegí un lote</option>
                  {lotes.map((l, i) => (
                    <option key={l.lote} value={l.lote}>{l.lote} ({hay(l)}){i === 0 && lotes.length > 1 ? ' · el más viejo' : ''}</option>
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
              {registrar.enviando ? 'Registrando…' : `Pasar a ${nombreVenta}`}
            </button>
            </>)}
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
