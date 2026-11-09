// D03, D04, E05, C05: un envío a una sucursal con varios productos (y en Chipería, el lote de cada uno).
// Sale de lo guardado para sucursales. Se confirma una sola vez y se registra todo junto: si una línea no alcanza,
// no se registra nada.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSector, useSectorActivo } from '../../components/Layout'
import Numero from '../../components/Numero'
import { IconoEnvio } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { fechaHoraPY } from '../../shared/hora'
import type { PedidoEnvio, RespuestaEnvio, StockFila, Sucursal } from '../../shared/tipos'
import { useStock } from './Stock'
import '../../styles/stock.css'

interface Linea { clave: number; productoId: string; lote: string; cantidad: number }

let siguiente = 0
const lineaVacia = (): Linea => ({ clave: ++siguiente, productoId: '', lote: '', cantidad: 0 })

export default function Envio() {
  // Al cambiar de sector (administrador) el formulario empieza de cero.
  const sector = useSector()
  return <Formulario key={sector} />
}

function Formulario() {
  const { id: sector, conLotes } = useSectorActivo()
  const stock = useStock(sector)
  const sucursales = useConsulta<Sucursal[]>('/sucursales')
  const [sucursalId, setSucursalId] = useState('')
  const [lineas, setLineas] = useState<Linea[]>(() => [lineaVacia()])
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [listo, setListo] = useState<RespuestaEnvio | null>(null)
  const registrar = useAccion((p: PedidoEnvio) => post<RespuestaEnvio>('/envios', p))

  const filas = stock.datos ?? []
  const filaDe = (id: string): StockFila | undefined => filas.find((f) => f.productoId === id)
  const activas = (sucursales.datos ?? []).filter((s) => s.activo)
  const sucursal = activas.find((s) => s.id === sucursalId)

  /** Lo que hay del producto (o del lote, en Chipería). */
  const hay = (l: Linea) => {
    const f = filaDe(l.productoId)
    if (!f) return 0
    return conLotes ? (f.lotes.find((x) => x.lote === l.lote)?.distribucion ?? 0) : f.distribucion
  }
  const listaParaHay = (l: Linea) => !!l.productoId && (!conLotes || !!l.lote)
  const conCantidad = lineas.filter((l) => l.productoId && l.cantidad > 0)
  const unidades = conCantidad.reduce((s, l) => s + l.cantidad, 0)

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    setConfirmando(false)
    registrar.limpiarError()
  }

  const cambiar = (clave: number, cambio: Partial<Linea>) => {
    limpiarMensajes()
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)))
  }

  /** Lotes del producto que todavía no están en otra línea. */
  const lotesLibres = (l: Linea) =>
    (filaDe(l.productoId)?.lotes ?? []).filter((x) => x.distribucion > 0).filter((x) => x.lote === l.lote || !lineas.some((o) => o.clave !== l.clave && o.productoId === l.productoId && o.lote === x.lote))

  const elegirProducto = (l: Linea, productoId: string) => {
    const libres = lotesLibres({ ...l, productoId, lote: '' })
    cambiar(l.clave, { productoId, lote: conLotes ? (libres[0]?.lote ?? '') : '' })
  }

  /** Productos para elegir en una línea: con stock y que no estén ya en otra (en Chipería, con algún lote libre). */
  const opciones = (l: Linea) =>
    filas.filter((f) => {
      if (f.productoId === l.productoId) return true
      if (f.distribucion <= 0) return false
      if (!conLotes) return !lineas.some((o) => o.clave !== l.clave && o.productoId === f.productoId)
      return f.lotes.some((x) => x.distribucion > 0 && !lineas.some((o) => o.clave !== l.clave && o.productoId === f.productoId && o.lote === x.lote))
    })

  const revisar = () => {
    limpiarMensajes()
    if (!sucursal) return setAviso('Elegí la sucursal.')
    if (conCantidad.length === 0) return setAviso('Cargá al menos un producto con su cantidad.')
    for (const l of conCantidad) {
      const nombre = filaDe(l.productoId)?.productoNombre ?? 'un producto'
      if (conLotes && !l.lote) return setAviso(`Elegí el lote de ${nombre}.`)
      if (l.cantidad > hay(l)) return setAviso(`No alcanza ${nombre}${conLotes ? ` del lote ${l.lote}` : ''}: hay ${hay(l)}.`)
    }
    setConfirmando(true)
  }

  const enviar = async () => {
    const r = await registrar.ejecutar({
      sector,
      sucursalId,
      items: conCantidad.map((l) => ({ productoId: l.productoId, lote: conLotes ? l.lote : null, cantidad: l.cantidad })),
    })
    setConfirmando(false)
    if (r) {
      setListo(r)
      setLineas([lineaVacia()])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const error = aviso ?? registrar.error
  const hayParaEnviar = filas.some((f) => f.distribucion > 0)
  const soloParaVenta = filas.some((f) => f.reposicion > 0)

  return (
    <>
      <Volver titulo="Envío a sucursal" icono={<IconoEnvio />} />
      {listo && (
        <div className="ok stk-listo" role="status">
          <strong>Envío a {listo.movimientos[0]?.sucursalNombre} registrado.</strong>
          <span>{fechaHoraPY(listo.movimientos[0]?.fecha ?? new Date().toISOString())} · {listo.movimientos[0]?.usuarioNombre}</span>
          <ul>
            {listo.movimientos.map((m) => (
              <li key={m.id}>{-m.cantidad} × {m.productoNombre}{m.lote ? ` · lote ${m.lote}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      <ConDatos consulta={stock}>
        {() => !hayParaEnviar ? (
          <p className="suave">
            No hay nada guardado en frío para sucursales.
            {soloParaVenta && <> Lo que hay está guardado para reponer la venta: podés cambiarle la finalidad desde <Link to="/sector/stock">Stock en frío</Link>.</>}
          </p>
        ) : (
          <>
            <div className="tarjeta">
              <label className="campo">
                <span>Sucursal</span>
                <select value={sucursalId} onChange={(e) => { limpiarMensajes(); setSucursalId(e.target.value) }}>
                  <option value="">{sucursales.datos ? 'Elegí la sucursal' : 'Cargando…'}</option>
                  {activas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
              {sucursales.error && <Aviso>{sucursales.error}</Aviso>}
              {sucursales.datos && activas.length === 0 && (
                <p className="suave chico">No hay sucursales cargadas.</p>
              )}
            </div>
            {lineas.map((l, i) => {
              const f = filaDe(l.productoId)
              const pasa = listaParaHay(l) && l.cantidad > hay(l)
              return (
                <div className={`tarjeta stk-linea${pasa ? ' stk-linea-mal' : ''}`} key={l.clave}>
                  <div className="stk-linea-cabeza">
                    <strong>Producto {i + 1}</strong>
                    {lineas.length > 1 && (
                      <button
                        type="button"
                        className="btn-texto"
                        onClick={() => { limpiarMensajes(); setLineas((ls) => ls.filter((x) => x.clave !== l.clave)) }}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  <label className="campo">
                    <span>Producto</span>
                    <select value={l.productoId} onChange={(e) => elegirProducto(l, e.target.value)}>
                      <option value="">Elegí un producto</option>
                      {opciones(l).map((o) => <option key={o.productoId} value={o.productoId}>{o.productoNombre} ({o.distribucion})</option>)}
                    </select>
                  </label>
                  {conLotes && f && (
                    <label className="campo">
                      <span>Lote</span>
                      <select value={l.lote} onChange={(e) => cambiar(l.clave, { lote: e.target.value })}>
                        <option value="">Elegí un lote</option>
                        {lotesLibres(l).map((x) => <option key={x.lote} value={x.lote}>{x.lote} ({x.distribucion})</option>)}
                      </select>
                    </label>
                  )}
                  <Numero
                    etiqueta={listaParaHay(l) ? `Cantidad (hay ${hay(l)})` : 'Cantidad'}
                    valor={l.cantidad}
                    onChange={(n) => cambiar(l.clave, { cantidad: n })}
                  />
                  {pasa && <p className="error">No alcanza: hay {hay(l)}.</p>}
                </div>
              )
            })}
            <button className="btn-secundario" onClick={() => { limpiarMensajes(); setLineas((ls) => [...ls, lineaVacia()]) }}>
              + Agregar otro producto
            </button>
          </>
        )}
      </ConDatos>
      {hayParaEnviar && (
        <div className="accion-fija">
          <div className="stk-barra">
            <Aviso>{error}</Aviso>
            {confirmando && sucursal ? (
              <div className="stk-confirmar" role="group" aria-label="Confirmar envío">
                <p>
                  ¿Registrar el envío de <strong>{unidades}</strong> {unidades === 1 ? 'unidad' : 'unidades'}
                  {conCantidad.length > 1 && ` (${conCantidad.length} productos)`} a <strong>{sucursal.nombre}</strong>?
                </p>
                <div className="stk-botones">
                  <button className="btn-secundario" onClick={() => setConfirmando(false)} disabled={registrar.enviando}>Volver</button>
                  <button className="btn-primario" onClick={() => void enviar()} disabled={registrar.enviando}>
                    {registrar.enviando ? 'Registrando…' : 'Sí, registrar envío'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-primario" onClick={revisar}>
                {unidades > 0 ? `Registrar envío (${unidades})` : 'Registrar envío'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
