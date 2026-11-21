// D01, D07, E05: lo que hay de cada producto, por depósito (Directo a Venta, Frío, Para sucursales, Materia prima y los
// que agregue el administrador). En Chipería, también por lote (el más viejo primero). Abajo, «Transferir» pasa unidades
// de un depósito a otro.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useDepositos } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import { IconoStock } from '../../components/Iconos'
import Numero from '../../components/Numero'
import Volver from '../../components/Volver'
import { DEPOSITO, type Deposito, type Movimiento, type PedidoTransferencia, type SectorId, type StockFila } from '../../shared/tipos'
import '../../styles/stock.css'

/** Stock del sector por depósito (activos y desactivados que todavía tienen algo). */
export const useStock = (sector: SectorId) => useConsulta<StockFila[]>('/stock', { sector })

/** Lo que hay en un depósito (o en todos, con ''). */
export const enDeposito = (f: { total?: number; cantidad?: number; porDeposito: Record<string, number> }, deposito: string) =>
  deposito ? (f.porDeposito[deposito] ?? 0) : (f.total ?? f.cantidad ?? 0)

/** «Directo a Venta: 3 · Frío: 8», en el orden de los depósitos y sin los que están en 0. */
export function repartoStock(porDeposito: Record<string, number>, depositos: Deposito[]) {
  const ids = [...depositos.map((d) => d.id), ...Object.keys(porDeposito).filter((id) => !depositos.some((d) => d.id === id))]
  return ids
    .filter((id) => (porDeposito[id] ?? 0) !== 0)
    .map((id) => `${depositos.find((d) => d.id === id)?.nombre ?? id}: ${porDeposito[id]}`)
    .join(' · ')
}

/** Depósitos con algo de stock en estas filas, en su orden. */
const depositosConStock = (filas: StockFila[], depositos: Deposito[]) =>
  depositos.filter((d) => filas.some((f) => (f.porDeposito[d.id] ?? 0) !== 0))

/**
 * Tabla de stock por producto (y por lote en Chipería), con un selector de depósito arriba: «Todos» muestra el total y
 * el reparto por depósito; un depósito muestra solo lo de ese depósito. `ocultarCeros`: arranca escondiendo los en 0.
 */
export function TablaStock({ filas, conLotes, ocultarCeros = false }: { filas: StockFila[]; conLotes: boolean; ocultarCeros?: boolean }) {
  const depositos = useDepositos()
  const [deposito, setDeposito] = useState('')
  const [soloConStock, setSoloConStock] = useState(ocultarCeros)
  const opciones = depositos.lista.filter((d) => d.activo || filas.some((f) => (f.porDeposito[d.id] ?? 0) !== 0))
  const cantidad = (f: StockFila) => enDeposito(f, deposito)
  const hayCeros = filas.some((f) => cantidad(f) === 0)
  const visibles = soloConStock ? filas.filter((f) => cantidad(f) !== 0) : filas
  const nombreDeposito = deposito ? depositos.nombre(deposito) : ''
  if (filas.length === 0) return <p className="suave">Este sector no tiene productos cargados.</p>
  return (
    <>
      {opciones.length > 0 && (
        <div className="segmentado stk-depositos" role="group" aria-label="Depósito">
          <button type="button" className={deposito === '' ? 'activo' : ''} aria-pressed={deposito === ''} onClick={() => setDeposito('')}>Todos</button>
          {opciones.map((d) => (
            <button key={d.id} type="button" className={deposito === d.id ? 'activo' : ''} aria-pressed={deposito === d.id} onClick={() => setDeposito(d.id)}>
              {d.nombre}
            </button>
          ))}
        </div>
      )}
      {hayCeros && (
        <label className="check stk-filtro">
          <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
          Ocultar los productos en 0
        </label>
      )}
      {visibles.length === 0 ? (
        <p className="suave">{deposito ? `No hay nada en «${nombreDeposito}».` : 'No hay nada en stock.'}</p>
      ) : (
        <table className="tabla stk-tabla">
          <thead>
            <tr><th>Producto</th><th className="num">{deposito ? nombreDeposito : 'En stock'}</th></tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const n = cantidad(f)
              const lotes = f.lotes.filter((l) => enDeposito(l, deposito) > 0)
              return (
                <tr key={f.productoId} className={n === 0 ? 'apagado' : ''}>
                  <td>
                    {f.productoNombre}
                    {!f.activo && <span className="stk-desactivado">desactivado</span>}
                    {!deposito && f.total !== 0 && <div className="suave chico stk-reparto">{repartoStock(f.porDeposito, depositos.lista)}</div>}
                    {deposito === DEPOSITO.venta && n < 0 && (
                      <div className="chico stk-negativo">Se vendió más de lo que se cargó: faltan {-n} por cargar.</div>
                    )}
                    {conLotes && lotes.length > 0 && (
                      <ul className="stk-lotes" aria-label={`Lotes de ${f.productoNombre}`}>
                        {lotes.map((l) => (
                          <li key={l.lote} title={repartoStock(l.porDeposito, depositos.lista)}><span>{l.lote}</span><strong>{enDeposito(l, deposito)}</strong></li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={`num stk-total${n < 0 ? ' stk-negativo' : ''}`}>{n}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

/** Pasa unidades de un producto (y lote) de un depósito a otro. */
export function Transferir({ sector, conLotes, filas }: { sector: SectorId; conLotes: boolean; filas: StockFila[] }) {
  const depositos = useDepositos()
  const origenes = depositosConStock(filas, depositos.lista).filter((d) => filas.some((f) => (f.porDeposito[d.id] ?? 0) > 0))
  const [desde, setDesde] = useState('')
  const [hacia, setHacia] = useState('')
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const registrar = useAccion((p: PedidoTransferencia) => post<Movimiento[]>('/transferencias', p))

  const origen = desde || origenes[0]?.id || ''
  const destinos = depositos.activos.filter((d) => d.id !== origen)
  const destino = destinos.some((d) => d.id === hacia) ? hacia : ''
  const conStock = filas.filter((f) => (f.porDeposito[origen] ?? 0) > 0 || f.productoId === productoId)
  const fila = filas.find((f) => f.productoId === productoId)
  const lotes = (fila?.lotes ?? []).filter((l) => (l.porDeposito[origen] ?? 0) > 0)
  const disponible = !fila ? 0 : conLotes ? (fila.lotes.find((l) => l.lote === lote)?.porDeposito[origen] ?? 0) : (fila.porDeposito[origen] ?? 0)
  const listaParaHay = !!fila && (!conLotes || !!lote)

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    registrar.limpiarError()
  }
  const elegirOrigen = (id: string) => {
    limpiarMensajes()
    setDesde(id)
    if (hacia === id) setHacia('')
    setProductoId('')
    setLote('')
  }
  const elegirProducto = (id: string) => {
    limpiarMensajes()
    setProductoId(id)
    // Sugiere el lote más viejo: es el que conviene mover primero.
    setLote(filas.find((f) => f.productoId === id)?.lotes.find((l) => (l.porDeposito[origen] ?? 0) > 0)?.lote ?? '')
  }

  const guardar = async () => {
    limpiarMensajes()
    if (!destino) return setAviso('Elegí a qué depósito va.')
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote) return setAviso('Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá cuántas unidades pasan.')
    if (cantidad > disponible) return setAviso(`Solo hay ${disponible} en «${depositos.nombre(origen)}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await registrar.ejecutar({ sector, productoId, lote: conLotes ? lote : null, cantidad, desde: origen, hacia: destino })
    if (r) {
      setListo(`Listo: ${cantidad} de ${fila.productoNombre}${conLotes ? ` (lote ${lote})` : ''} pasaron de «${depositos.nombre(origen)}» a «${depositos.nombre(destino)}».`)
      setCantidad(0)
    }
  }

  const error = aviso ?? registrar.error
  if (origenes.length === 0 && !listo) return null
  return (
    <>
      <h2>Transferir entre depósitos</h2>
      <div className="tarjeta">
        <p className="suave chico stk-ayuda">
          Pasá unidades de un depósito a otro. Por ejemplo, 20 empanadas de «Frío» a «Para sucursales» para mandarlas mañana.
        </p>
        <div className="stk-de-a">
          <label className="campo">
            <span>Desde</span>
            <select value={origen} onChange={(e) => elegirOrigen(e.target.value)}>
              {origenes.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>
          <span className="stk-flecha" aria-hidden="true">→</span>
          <label className="campo">
            <span>Hacia</span>
            <select value={destino} onChange={(e) => { limpiarMensajes(); setHacia(e.target.value) }}>
              <option value="">Elegí el depósito</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>
        </div>
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">Elegí un producto</option>
            {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({f.porDeposito[origen] ?? 0})</option>)}
          </select>
        </label>
        {conLotes && fila && (
          <label className="campo">
            <span>Lote</span>
            <select value={lote} onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}>
              <option value="">{lotes.length ? 'Elegí un lote' : `Ningún lote con stock en «${depositos.nombre(origen)}»`}</option>
              {lotes.map((l, i) => (
                <option key={l.lote} value={l.lote}>{l.lote} ({l.porDeposito[origen]}){i === 0 && lotes.length > 1 ? ' · el más viejo' : ''}</option>
              ))}
            </select>
          </label>
        )}
        <Numero
          etiqueta={listaParaHay ? `Cantidad (hay ${disponible} en ${depositos.nombre(origen)})` : 'Cantidad'}
          valor={cantidad}
          onChange={(n) => { limpiarMensajes(); setCantidad(n) }}
        />
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{listo}</Aviso>
        <button className="btn-primario" onClick={() => void guardar()} disabled={registrar.enviando}>
          {registrar.enviando ? 'Guardando…' : 'Transferir'}
        </button>
      </div>
    </>
  )
}

export default function Stock() {
  const { id: sector, conLotes } = useSectorActivo()
  const stock = useStock(sector)
  return (
    <>
      <Volver titulo="Stock" icono={<IconoStock />} />
      <ConDatos consulta={stock}>
        {(filas) => (
          <>
            <TablaStock filas={filas} conLotes={conLotes} />
            <Transferir key={sector} sector={sector} conLotes={conLotes} filas={filas} />
            <div className="stk-atajos">
              <Link className="boton-grande" to="/sector/salida"><strong>Sacar para la venta</strong></Link>
              <Link className="boton-grande" to="/sector/envio"><strong>Envío a sucursal</strong></Link>
            </div>
          </>
        )}
      </ConDatos>
    </>
  )
}
