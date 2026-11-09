// D01, D07, E05, C05, C08: lo que hay guardado en frío, por producto y por finalidad (reponer la venta o enviar
// a sucursales). En Chipería, también por lote (el más viejo primero). Arriba, los avisos de stock mínimo.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import { IconoStock } from '../../components/Iconos'
import Numero from '../../components/Numero'
import Volver from '../../components/Volver'
import type { Alerta } from '../../shared/alertas'
import { NOMBRE_FINALIDAD, type Finalidad, type Movimiento, type PedidoReasignacion, type SectorId, type StockFila } from '../../shared/tipos'
import '../../styles/stock.css'

/** Stock en frío del sector (activos y desactivados que todavía tienen algo). */
export const useStock = (sector: SectorId) => useConsulta<StockFila[]>('/stock', { sector })

/** Avisos de stock mínimo del sector (C08). No muestra nada si no hay o todavía no cargaron. */
export function AlertasStock({ sector }: { sector: SectorId }) {
  const alertas = useConsulta<Alerta[]>('/stock/alertas', { sector })
  if (!alertas.datos?.length) return null
  return (
    <div className="stk-alertas" role="status">
      <strong>{alertas.datos.length === 1 ? 'Stock bajo' : `Stock bajo en ${alertas.datos.length} productos`}</strong>
      <ul>
        {alertas.datos.map((a) => <li key={a.texto}>{a.texto}</li>)}
      </ul>
    </div>
  )
}

/** «Reponer venta: 8 · Sucursales: 4» */
export const repartoStock = (f: { reposicion: number; distribucion: number }) =>
  `${NOMBRE_FINALIDAD.reposicion}: ${f.reposicion} · ${NOMBRE_FINALIDAD.distribucion}: ${f.distribucion}`

/** Tabla de stock por producto (y por lote en Chipería). `ocultarCeros`: arranca escondiendo los productos en 0. */
export function TablaStock({ filas, conLotes, ocultarCeros = false }: { filas: StockFila[]; conLotes: boolean; ocultarCeros?: boolean }) {
  const [soloConStock, setSoloConStock] = useState(ocultarCeros)
  const hayCeros = filas.some((f) => f.total === 0)
  const visibles = soloConStock ? filas.filter((f) => f.total !== 0) : filas
  if (filas.length === 0) return <p className="suave">Este sector no tiene productos cargados.</p>
  return (
    <>
      {hayCeros && (
        <label className="check stk-filtro">
          <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
          Ocultar los productos en 0
        </label>
      )}
      {visibles.length === 0 ? (
        <p className="suave">No hay nada guardado en frío.</p>
      ) : (
        <table className="tabla stk-tabla">
          <thead>
            <tr><th>Producto</th><th className="num">En frío</th></tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.productoId} className={f.total === 0 ? 'apagado' : ''}>
                <td>
                  {f.productoNombre}
                  {!f.activo && <span className="stk-desactivado">desactivado</span>}
                  {f.minimo !== null && f.total < f.minimo && <span className="stk-bajo">bajo el mínimo ({f.minimo})</span>}
                  {f.total !== 0 && <div className="suave chico stk-reparto">{repartoStock(f)}</div>}
                  {conLotes && f.lotes.length > 0 && (
                    <ul className="stk-lotes" aria-label={`Lotes de ${f.productoNombre}`}>
                      {f.lotes.map((l) => (
                        <li key={l.lote} title={repartoStock(l)}><span>{l.lote}</span><strong>{l.cantidad}</strong></li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="num stk-total">{f.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/** C05: pasa unidades de un producto (y lote) de «Reponer venta» a «Sucursales», o al revés. */
export function CambiarFinalidad({ sector, conLotes, filas }: { sector: SectorId; conLotes: boolean; filas: StockFila[] }) {
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [desde, setDesde] = useState<Finalidad>('reposicion')
  const [cantidad, setCantidad] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const registrar = useAccion((p: PedidoReasignacion) => post<Movimiento[]>('/reasignaciones', p))

  const hacia: Finalidad = desde === 'reposicion' ? 'distribucion' : 'reposicion'
  const conStock = filas.filter((f) => f.reposicion > 0 || f.distribucion > 0)
  const fila = filas.find((f) => f.productoId === productoId)
  const lotes = (fila?.lotes ?? []).filter((l) => l[desde] > 0)
  const disponible = !fila ? 0 : conLotes ? (fila.lotes.find((l) => l.lote === lote)?.[desde] ?? 0) : fila[desde]
  const listaParaHay = !!fila && (!conLotes || !!lote)

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    registrar.limpiarError()
  }
  const elegirProducto = (id: string) => {
    limpiarMensajes()
    setProductoId(id)
    setLote('')
  }
  const elegirSentido = (f: Finalidad) => {
    limpiarMensajes()
    setDesde(f)
    setLote('')
  }

  const guardar = async () => {
    limpiarMensajes()
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote) return setAviso('Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá cuántas unidades cambian de finalidad.')
    if (cantidad > disponible) return setAviso(`Solo hay ${disponible} en «${NOMBRE_FINALIDAD[desde]}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await registrar.ejecutar({ sector, productoId, lote: conLotes ? lote : null, cantidad, desde })
    if (r) {
      setListo(`Listo: ${cantidad} de ${fila.productoNombre}${conLotes ? ` (lote ${lote})` : ''} pasaron a «${NOMBRE_FINALIDAD[hacia]}».`)
      setCantidad(0)
    }
  }

  const error = aviso ?? registrar.error
  if (conStock.length === 0 && !listo) return null
  return (
    <>
      <h2>Cambiar finalidad</h2>
      <div className="tarjeta">
        <p className="suave chico stk-ayuda">Pasá unidades que ya están en frío de «{NOMBRE_FINALIDAD.reposicion}» a «{NOMBRE_FINALIDAD.distribucion}», o al revés.</p>
        <div className="segmentado" role="group" aria-label="Sentido del cambio">
          {(['reposicion', 'distribucion'] as Finalidad[]).map((f) => (
            <button key={f} type="button" className={desde === f ? 'activo' : ''} aria-pressed={desde === f} onClick={() => elegirSentido(f)}>
              {NOMBRE_FINALIDAD[f]} → {NOMBRE_FINALIDAD[f === 'reposicion' ? 'distribucion' : 'reposicion']}
            </button>
          ))}
        </div>
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">Elegí un producto</option>
            {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({repartoStock(f)})</option>)}
          </select>
        </label>
        {conLotes && fila && (
          <label className="campo">
            <span>Lote</span>
            <select value={lote} onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}>
              <option value="">{lotes.length ? 'Elegí un lote' : `Ningún lote con stock en «${NOMBRE_FINALIDAD[desde]}»`}</option>
              {lotes.map((l) => <option key={l.lote} value={l.lote}>{l.lote} ({l[desde]})</option>)}
            </select>
          </label>
        )}
        <Numero
          etiqueta={listaParaHay ? `Cantidad (hay ${disponible} en ${NOMBRE_FINALIDAD[desde]})` : 'Cantidad'}
          valor={cantidad}
          onChange={(n) => { limpiarMensajes(); setCantidad(n) }}
        />
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{listo}</Aviso>
        <button className="btn-primario" onClick={() => void guardar()} disabled={registrar.enviando}>
          {registrar.enviando ? 'Guardando…' : 'Cambiar finalidad'}
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
      <Volver titulo="Stock en frío" icono={<IconoStock />} />
      <AlertasStock sector={sector} />
      <ConDatos consulta={stock}>
        {(filas) => (
          <>
            <TablaStock filas={filas} conLotes={conLotes} />
            <CambiarFinalidad key={sector} sector={sector} conLotes={conLotes} filas={filas} />
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
