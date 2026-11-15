// M11–M13: la caja del local. El cajero (y el administrador) abre la caja con el fondo inicial, vende, imprime la
// factura preimpresa, carga ingresos y retiros, arquea y cierra. El administrador además configura la factura y ve el
// historial de cajas.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { usePuede } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { Icono } from '../../components/Iconos'
import Avisos from '../../components/Avisos'
import { gs, leerImporte, miles } from '../../shared/dinero'
import { diaLegible, fechaHoraPY } from '../../shared/hora'
import {
  MEDIOS_PAGO, NOMBRE_MEDIO_PAGO,
  type Caja as TipoCaja, type ConfigFactura, type MedioPago, type PedidoVenta, type ProductoVenta, type Venta,
} from '../../shared/tipos'
import { ConfigurarFactura, ImprimirFactura } from './Factura'
import '../../styles/compras.css'

type Pestana = 'vender' | 'ventas' | 'caja' | 'factura' | 'historial'

export default function Caja() {
  const puede = usePuede()
  const [params, setParams] = useSearchParams()
  const caja = useConsulta<TipoCaja | null>('/caja')
  const pestanas: [Pestana, string][] = [
    ['vender', 'Vender'],
    ['ventas', 'Ventas'],
    ['caja', 'Caja y cierre'],
    ...(puede('facturas.configurar') ? [['factura', 'Factura'] as [Pestana, string]] : []),
    ...(puede('reportes.detallados') ? [['historial', 'Cajas anteriores'] as [Pestana, string]] : []),
  ]
  const pedida = params.get('ver')
  const pestana: Pestana = pestanas.some(([p]) => p === pedida) ? (pedida as Pestana) : 'vender'
  const ir = (p: Pestana) => setParams({ ver: p }, { replace: true })
  const necesitaCaja = pestana === 'vender' || pestana === 'ventas' || pestana === 'caja'
  return (
    <>
      <div className="titulo"><span className="icono-titulo"><Icono nombre="caja" /></span><h1>Caja</h1></div>
      <Avisos />
      <div className="segmentado" role="tablist">
        {pestanas.map(([p, t]) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''} onClick={() => ir(p)}>{t}</button>
        ))}
      </div>
      {necesitaCaja && (
        <ConDatos consulta={caja}>
          {(c) => !c ? <AbrirCaja /> : (
            <>
              {pestana === 'vender' && <Vender />}
              {pestana === 'ventas' && <VentasDeLaCaja cajaId={c.id} />}
              {pestana === 'caja' && <EstadoCaja caja={c} />}
            </>
          )}
        </ConDatos>
      )}
      {pestana === 'factura' && <ConfigurarFactura />}
      {pestana === 'historial' && <Historial />}
    </>
  )
}

function CampoImporte({ etiqueta, valor, onChange, autoFocus }: { etiqueta: string; valor: number; onChange: (n: number) => void; autoFocus?: boolean }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      <input inputMode="numeric" value={valor ? miles(valor) : ''} placeholder="0" autoFocus={autoFocus} onChange={(e) => onChange(leerImporte(e.target.value))} />
    </label>
  )
}

function AbrirCaja() {
  const [fondo, setFondo] = useState(0)
  const abrir = useAccion(() => post<TipoCaja>('/caja/abrir', { fondoInicial: fondo }))
  return (
    <div className="tarjeta">
      <p>La caja está cerrada. Para empezar a vender, abrila con el efectivo que hay para dar cambio.</p>
      <CampoImporte etiqueta="Fondo inicial en efectivo (Gs.)" valor={fondo} onChange={setFondo} autoFocus />
      <Aviso>{abrir.error}</Aviso>
      <button type="button" className="btn-primario" disabled={abrir.enviando} onClick={() => void abrir.ejecutar()}>Abrir caja</button>
    </div>
  )
}

// ---------- Vender (M11) ----------

/** Hace la factura (le asigna número la primera vez) y abre la impresión. */
function useFactura() {
  const [imprimiendo, setImprimiendo] = useState<{ venta: Venta; config: ConfigFactura } | null>(null)
  const hacer = useAccion((id: string) => post<{ venta: Venta; config: ConfigFactura }>(`/ventas/${id}/factura`))
  const imprimir = async (id: string) => {
    const r = await hacer.ejecutar(id)
    if (r) setImprimiendo(r)
  }
  const vista = imprimiendo && <ImprimirFactura venta={imprimiendo.venta} config={imprimiendo.config} alTerminar={() => setImprimiendo(null)} />
  return { imprimir, vista, error: hacer.error, enviando: hacer.enviando, ultima: imprimiendo?.venta }
}

function Vender() {
  const productos = useConsulta<ProductoVenta[]>('/ventas/productos')
  const [buscar, setBuscar] = useState('')
  const [carrito, setCarrito] = useState<Map<string, number>>(new Map())
  const [descuento, setDescuento] = useState(0)
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [recibido, setRecibido] = useState(0)
  const [cliente, setCliente] = useState({ nombre: '', ruc: '' })
  const [conCliente, setConCliente] = useState(false)
  const [hecha, setHecha] = useState<Venta | null>(null)
  const vender = useAccion((p: PedidoVenta) => post<Venta>('/ventas', p))
  const factura = useFactura()

  const lista = productos.datos ?? []
  const porId = useMemo(() => new Map(lista.map((p) => [p.id, p])), [lista])
  const filtrados = lista.filter((p) => !buscar.trim() || p.nombre.toLowerCase().includes(buscar.trim().toLowerCase()))
  const lineas = [...carrito.entries()].map(([id, n]) => ({ p: porId.get(id)!, n })).filter((l) => l.p)
  const subtotal = lineas.reduce((s, l) => s + l.n * l.p.precio, 0)
  const total = Math.max(0, subtotal - descuento)
  const vuelto = medio === 'efectivo' && recibido >= total && recibido > 0 ? recibido - total : null

  const sumar = (id: string, d: number) => {
    setHecha(null)
    setCarrito((c) => {
      const m = new Map(c)
      const n = (m.get(id) ?? 0) + d
      if (n <= 0) m.delete(id)
      else m.set(id, n)
      return m
    })
  }
  const limpiar = () => {
    setCarrito(new Map())
    setDescuento(0)
    setRecibido(0)
    setCliente({ nombre: '', ruc: '' })
    setConCliente(false)
    setMedio('efectivo')
  }
  const cobrar = async () => {
    const v = await vender.ejecutar({
      items: lineas.map((l) => ({ productoId: l.p.id, cantidad: l.n })),
      descuento,
      medio,
      recibido: medio === 'efectivo' && recibido ? recibido : null,
      clienteNombre: cliente.nombre,
      clienteRuc: cliente.ruc,
    })
    if (v) {
      setHecha(v)
      limpiar()
    }
  }

  if (productos.datos && !lista.length) {
    return <Aviso>Todavía no hay productos con precio de venta. El administrador los carga en Catálogos → Productos.</Aviso>
  }

  return (
    <>
      {hecha && (
        <div className="tarjeta">
          <Aviso tipo="ok">
            Venta N° {hecha.numero} por {gs(hecha.total)} ({NOMBRE_MEDIO_PAGO[hecha.medio].toLowerCase()}).
            {hecha.vuelto !== null && hecha.vuelto > 0 && <> Vuelto: <strong>{gs(hecha.vuelto)}</strong>.</>}
          </Aviso>
          <div className="fila-acciones">
            <button type="button" className="btn-secundario" disabled={factura.enviando} onClick={() => void factura.imprimir(hecha.id)}>
              Imprimir factura
            </button>
            <button type="button" className="btn-texto" onClick={() => setHecha(null)}>Sin factura, seguir</button>
          </div>
          <Aviso>{factura.error}</Aviso>
          {factura.ultima?.id === hecha.id && factura.ultima.factura && <p className="chico">Factura {factura.ultima.factura.numeroCompleto}</p>}
        </div>
      )}
      <input className="buscar" type="search" placeholder="Buscar producto…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      <ConDatos consulta={productos}>
        {() => (
          <div className="grilla-venta">
            {filtrados.map((p) => {
              const agotado = p.descuentaStock && p.stockObligatorio && (p.stock ?? 0) - (carrito.get(p.id) ?? 0) <= 0
              return (
                <button key={p.id} type="button" className="producto-venta" disabled={agotado} onClick={() => sumar(p.id, 1)}>
                  <strong>{p.nombre}</strong>
                  <span>{gs(p.precio)}</span>
                  {p.descuentaStock && <span className="suave chico">Stock: {p.stock ?? 0}</span>}
                  {carrito.get(p.id) ? <span className="etq-compra pagada">× {carrito.get(p.id)}</span> : null}
                </button>
              )
            })}
          </div>
        )}
      </ConDatos>

      <div className="tarjeta">
        <h2>Venta</h2>
        {lineas.length ? (
          <div className="carrito">
            {lineas.map(({ p, n }) => (
              <div key={p.id} className="linea-carrito">
                <span>{p.nombre}<br /><span className="suave chico">{gs(p.precio)} c/u</span></span>
                <span className="cantidad-carrito">
                  <button type="button" aria-label={`Uno menos de ${p.nombre}`} onClick={() => sumar(p.id, -1)}>−</button>
                  <span>{n}</span>
                  <button type="button" aria-label={`Uno más de ${p.nombre}`} onClick={() => sumar(p.id, 1)}>+</button>
                </span>
                <strong>{miles(n * p.precio)}</strong>
              </div>
            ))}
          </div>
        ) : <p className="suave">Tocá los productos para agregarlos.</p>}
        <div className="filtros">
          <CampoImporte etiqueta="Descuento (Gs.)" valor={descuento} onChange={setDescuento} />
          <label className="campo">
            <span>Medio de pago</span>
            <select value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
              {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
            </select>
          </label>
          {medio === 'efectivo' && <CampoImporte etiqueta="Entregó (para el vuelto)" valor={recibido} onChange={setRecibido} />}
        </div>
        <label className="check">
          <input type="checkbox" checked={conCliente} onChange={(e) => setConCliente(e.target.checked)} />
          <span>Datos del cliente para la factura</span>
        </label>
        {conCliente && (
          <div className="filtros">
            <label className="campo"><span>Nombre o razón social</span><input value={cliente.nombre} maxLength={120} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /></label>
            <label className="campo"><span>RUC o CI</span><input value={cliente.ruc} maxLength={30} onChange={(e) => setCliente({ ...cliente, ruc: e.target.value })} /></label>
          </div>
        )}
        <div className="total-compra"><span>Total{descuento > 0 && <span className="suave chico"> (sin descuento {gs(subtotal)})</span>}</span><strong>{gs(total)}</strong></div>
        {vuelto !== null && <p className="vuelto">Vuelto: <strong>{gs(vuelto)}</strong></p>}
        <Aviso>{vender.error}</Aviso>
        <div className="fila-acciones">
          <button type="button" className="btn-primario" disabled={vender.enviando || !lineas.length} onClick={() => void cobrar()}>
            {vender.enviando ? 'Cobrando…' : `Cobrar ${gs(total)}`}
          </button>
          {lineas.length > 0 && <button type="button" className="btn-texto" onClick={limpiar}>Vaciar</button>}
        </div>
      </div>
      {factura.vista}
    </>
  )
}

function VentasDeLaCaja({ cajaId }: { cajaId: string }) {
  const ventas = useConsulta<Venta[]>('/ventas', { caja: cajaId })
  const factura = useFactura()
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const anular = useAccion((id: string) => post<Venta>(`/ventas/${id}/anular`, { motivo }))
  return (
    <>
      <Aviso>{factura.error ?? anular.error}</Aviso>
      <ConDatos consulta={ventas}>
        {(lista) => lista.length ? (
          <div className="lista">
            {lista.map((v) => (
              <div key={v.id} className={`item${v.anulada ? ' apagado' : ''}`}>
                <div className="compra-cabeza">
                  <span><strong>N° {v.numero}</strong> · {fechaHoraPY(v.fecha).slice(11)} · {NOMBRE_MEDIO_PAGO[v.medio]}{v.clienteNombre && ` · ${v.clienteNombre}`}</span>
                  <span className="compra-cifras"><strong>{gs(v.total)}</strong>{v.anulada && <span className="etq-compra anulada">Anulada</span>}</span>
                  <span className="suave chico">
                    {v.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ')}
                    {v.descuento > 0 && ` · descuento ${gs(v.descuento)}`}
                    {v.factura && ` · factura ${v.factura.numeroCompleto}${v.factura.anulada ? ' (anulada)' : ''}`}
                  </span>
                </div>
                {!v.anulada && (
                  <div className="fila-acciones">
                    <button type="button" className="btn-texto" disabled={factura.enviando} onClick={() => void factura.imprimir(v.id)}>
                      {v.factura ? 'Reimprimir factura' : 'Imprimir factura'}
                    </button>
                    {anulando !== v.id && <button type="button" className="btn-texto" onClick={() => { setAnulando(v.id); setMotivo('') }}>Anular venta</button>}
                  </div>
                )}
                {anulando === v.id && (
                  <div className="filtros anular">
                    <label className="campo"><span>Motivo</span><input value={motivo} maxLength={300} autoFocus onChange={(e) => setMotivo(e.target.value)} /></label>
                    <button type="button" className="btn-primario" disabled={anular.enviando || !motivo.trim()} onClick={() => void anular.ejecutar(v.id).then((r) => r && setAnulando(null))}>Anular</button>
                    <button type="button" className="btn-texto" onClick={() => setAnulando(null)}>Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className="suave">Todavía no hay ventas en esta caja.</p>}
      </ConDatos>
      {factura.vista}
    </>
  )
}

// ---------- Caja: movimientos, arqueo y cierre (M13) ----------

export function TablaTotales({ caja }: { caja: TipoCaja }) {
  return (
    <table className="tabla tabla-caja">
      <thead><tr><th>Medio</th><th>Ventas</th><th>Ingresos</th><th>Retiros</th><th>Esperado</th></tr></thead>
      <tbody>
        {caja.totales.map((t) => (
          <tr key={t.medio}>
            <td>{NOMBRE_MEDIO_PAGO[t.medio]}{t.medio === 'efectivo' && <span className="suave chico"> (con fondo {miles(caja.fondoInicial)})</span>}</td>
            <td>{miles(t.ventas)}</td><td>{miles(t.ingresos)}</td><td>{miles(t.retiros)}</td><td><strong>{miles(t.esperado)}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const claseDiferencia = (n: number) => (n > 0 ? 'diferencia-positiva' : n < 0 ? 'diferencia-negativa' : '')
export const textoDiferencia = (n: number) => (n === 0 ? 'Sin diferencia' : n > 0 ? `Sobran ${gs(n)}` : `Faltan ${gs(-n)}`)

function EstadoCaja({ caja }: { caja: TipoCaja }) {
  const [mov, setMov] = useState({ tipo: 'retiro' as 'ingreso' | 'retiro', importe: 0, concepto: '', medio: 'efectivo' as MedioPago })
  const [contado, setContado] = useState(0)
  const [nota, setNota] = useState('')
  const [cerrando, setCerrando] = useState(false)
  const movimiento = useAccion(() => post<TipoCaja>('/caja/movimientos', mov))
  const anularMov = useAccion((id: string) => post<TipoCaja>(`/caja/movimientos/${id}/anular`))
  const arqueo = useAccion((cierre: boolean) => post<TipoCaja>(cierre ? '/caja/cerrar' : '/caja/arqueos', { contado, nota }))
  const diferencia = contado - caja.esperadoEfectivo
  return (
    <>
      <p className="suave">
        Abierta por {caja.abiertaPorNombre} el {fechaHoraPY(caja.abiertaEn)} · {caja.cantidadVentas} {caja.cantidadVentas === 1 ? 'venta' : 'ventas'} por {gs(caja.totalVentas)}
      </p>
      <TablaTotales caja={caja} />
      <div className="cifras">
        <div className="cifra"><span className="suave chico">Efectivo que debería haber</span><strong>{gs(caja.esperadoEfectivo)}</strong></div>
      </div>

      <h2>Ingreso o retiro</h2>
      <div className="tarjeta filtros">
        <label className="campo">
          <span>Tipo</span>
          <select value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value as 'ingreso' | 'retiro' })}>
            <option value="retiro">Retiro (sale dinero)</option>
            <option value="ingreso">Ingreso (entra dinero)</option>
          </select>
        </label>
        <CampoImporte etiqueta="Importe (Gs.)" valor={mov.importe} onChange={(n) => setMov({ ...mov, importe: n })} />
        <label className="campo"><span>Concepto</span><input value={mov.concepto} maxLength={200} placeholder="Depósito en el banco" onChange={(e) => setMov({ ...mov, concepto: e.target.value })} /></label>
        <label className="campo">
          <span>Medio</span>
          <select value={mov.medio} onChange={(e) => setMov({ ...mov, medio: e.target.value as MedioPago })}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primario" disabled={movimiento.enviando || !mov.importe || !mov.concepto.trim()}
          onClick={() => void movimiento.ejecutar().then((r) => r && setMov({ ...mov, importe: 0, concepto: '' }))}>Guardar</button>
      </div>
      <p className="suave chico">Un gasto (por ejemplo, la luz) pagado con efectivo de la caja lo carga el administrador en Ingresos y egresos marcando «sale de la caja»: así aparece en los dos lados sin cargarlo dos veces.</p>
      <Aviso>{movimiento.error ?? anularMov.error}</Aviso>

      <h2>Arqueo y cierre</h2>
      <div className="tarjeta">
        <CampoImporte etiqueta="Efectivo contado (Gs.)" valor={contado} onChange={setContado} />
        {contado > 0 && <p className={claseDiferencia(diferencia)}>{textoDiferencia(diferencia)} (esperado {gs(caja.esperadoEfectivo)})</p>}
        <label className="campo"><span>Nota (opcional)</span><input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} /></label>
        <Aviso>{arqueo.error}</Aviso>
        {cerrando ? (
          <>
            <p><strong>¿Cerrar la caja con {gs(contado)} contados?</strong> {textoDiferencia(diferencia)}. Después no se puede vender ni anular ventas de esta caja.</p>
            <div className="fila-acciones">
              <button type="button" className="btn-primario" disabled={arqueo.enviando} onClick={() => void arqueo.ejecutar(true)}>Sí, cerrar la caja</button>
              <button type="button" className="btn-texto" onClick={() => setCerrando(false)}>Volver</button>
            </div>
          </>
        ) : (
          <div className="fila-acciones">
            <button type="button" className="btn-secundario" disabled={arqueo.enviando} onClick={() => void arqueo.ejecutar(false).then((r) => r && setNota(''))}>Guardar arqueo</button>
            <button type="button" className="btn-primario" onClick={() => setCerrando(true)}>Cerrar caja</button>
          </div>
        )}
      </div>

      {(caja.movimientos?.length ?? 0) > 0 && (
        <>
          <h2>Movimientos</h2>
          <ul className="lista-pagos">
            {caja.movimientos!.map((m) => (
              <li key={m.id} className={m.anulado ? 'apagado' : ''}>
                {fechaHoraPY(m.fecha).slice(11)} · {m.tipo === 'ingreso' ? 'Ingreso' : 'Retiro'} {NOMBRE_MEDIO_PAGO[m.medio].toLowerCase()} · <strong>{gs(m.importe)}</strong> · {m.concepto} · {m.usuarioNombre}
                {m.anulado ? ' (anulado)' : m.origen === 'manual' && (
                  <button type="button" className="btn-texto" disabled={anularMov.enviando} onClick={() => void anularMov.ejecutar(m.id)}>Anular</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {(caja.arqueos?.length ?? 0) > 0 && (
        <>
          <h2>Arqueos</h2>
          <ul className="lista-pagos">
            {caja.arqueos!.map((a) => (
              <li key={a.id}>{fechaHoraPY(a.fecha).slice(11)} · contado {gs(a.contado)} · esperado {gs(a.esperado)} · <span className={claseDiferencia(a.diferencia)}>{textoDiferencia(a.diferencia)}</span> · {a.usuarioNombre}{a.nota && ` · ${a.nota}`}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// ---------- Cajas anteriores (administrador) ----------

function Historial() {
  const cajas = useConsulta<TipoCaja[]>('/cajas')
  const [abierta, setAbierta] = useState<string | null>(null)
  return (
    <ConDatos consulta={cajas}>
      {(lista) => lista.length ? (
        <div className="lista">
          {lista.map((c) => (
            <div key={c.id} className="item">
              <button type="button" className="compra-cabeza" onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                <span><strong>{diaLegible(c.dia)}</strong> · {c.abiertaPorNombre}{c.cerradaPorNombre && ` / cerró ${c.cerradaPorNombre}`}</span>
                <span className="compra-cifras">
                  <strong>{gs(c.totalVentas)}</strong>
                  <span className={`etq-compra ${c.abierta ? 'abierta' : 'cerrada'}`}>{c.abierta ? 'Abierta' : 'Cerrada'}</span>
                </span>
                <span className="suave chico">
                  {c.cantidadVentas} ventas · fondo {gs(c.fondoInicial)}
                  {c.diferencia !== null && <> · <span className={claseDiferencia(c.diferencia)}>{textoDiferencia(c.diferencia)}</span></>}
                </span>
              </button>
              {abierta === c.id && <TablaTotales caja={c} />}
            </div>
          ))}
        </div>
      ) : <p className="suave">Todavía no hay cajas.</p>}
    </ConDatos>
  )
}
