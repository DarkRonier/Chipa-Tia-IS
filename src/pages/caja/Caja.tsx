// M11–M13: la caja del local. El cajero abre la caja con el fondo inicial, vende, imprime la factura preimpresa, carga
// ingresos y retiros, arquea y cierra. Solo el cajero vende (Mati, 2026-11-21): el administrador ve las ventas, las
// anula, opera la caja, configura la factura y ve el historial de cajas, pero no tiene la pestaña Vender.
// Hay dos cajas: la del frente (cajero) y la del comedor (Caja Comedor, que vende de Venta comedor). El administrador
// elige cuál mira arriba.
import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { usePuede, useUsuario } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { Icono } from '../../components/Iconos'
import Avisos from '../../components/Avisos'
import { gs, leerImporte, miles } from '../../shared/dinero'
import { diaLegible, fechaHoraPY } from '../../shared/hora'
import {
  MEDIOS_PAGO, NOMBRE_MEDIO_PAGO, NOMBRE_PUNTO_CAJA, PUNTOS_CAJA, describirParte, type PuntoCaja,
  type Caja as TipoCaja, type MedioPago, type PedidoVenta, type ProductoVenta, type Venta,
} from '../../shared/tipos'
import { ConfigurarFactura, useFactura } from './Factura'
import '../../styles/compras.css'
import BotonIcono, { Acciones } from '../../components/BotonIcono'
import PartesPago, { faltaEnPartes, importesFinales, parteNueva, type ParteForm } from '../../components/PartesPago'

type Pestana = 'vender' | 'ventas' | 'caja' | 'factura' | 'historial'

export default function Caja() {
  const puede = usePuede()
  const { rol } = useUsuario()
  const [params, setParams] = useSearchParams()
  // El cajero maneja la caja del frente y Caja Comedor la del comedor; el administrador elige.
  const eligePunto = rol !== 'cajero' && rol !== 'caja_comedor'
  const punto: PuntoCaja = rol === 'caja_comedor' || (eligePunto && params.get('punto') === 'comedor') ? 'comedor' : 'frente'
  const caja = useConsulta<TipoCaja | null>('/caja', { punto })
  const pestanas: [Pestana, string][] = [
    ...(puede('ventas.registrar') ? [['vender', 'Vender'] as [Pestana, string]] : []),
    ['ventas', 'Ventas'],
    ['caja', 'Caja y cierre'],
    ...(puede('facturas.configurar') ? [['factura', 'Factura'] as [Pestana, string]] : []),
    ...(puede('reportes.detallados') ? [['historial', 'Cajas anteriores'] as [Pestana, string]] : []),
  ]
  const pedida = params.get('ver')
  const pestana: Pestana = pestanas.some(([p]) => p === pedida) ? (pedida as Pestana) : pestanas[0][0]
  const ir = (p: Pestana, pu: PuntoCaja = punto) => setParams(pu === 'comedor' ? { ver: p, punto: pu } : { ver: p }, { replace: true })
  const necesitaCaja = pestana === 'vender' || pestana === 'ventas' || pestana === 'caja'
  return (
    <>
      <div className="titulo"><span className="icono-titulo"><Icono nombre="caja" /></span><h1>{eligePunto || punto === 'frente' ? 'Caja' : NOMBRE_PUNTO_CAJA[punto]}</h1></div>
      <Avisos tipos={['caja_sin_cerrar']} />
      {eligePunto && pestana !== 'factura' && pestana !== 'historial' && (
        <div className="segmentado" role="tablist" aria-label="Qué caja">
          {PUNTOS_CAJA.map((pu) => (
            <button key={pu} type="button" role="tab" aria-selected={punto === pu} className={punto === pu ? 'activo' : ''} onClick={() => ir(pestana, pu)}>
              {NOMBRE_PUNTO_CAJA[pu]}
            </button>
          ))}
        </div>
      )}
      <div className="segmentado" role="tablist">
        {pestanas.map(([p, t]) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''} onClick={() => ir(p)}>{t}</button>
        ))}
      </div>
      {necesitaCaja && (
        <ConDatos consulta={caja}>
          {(c) => !c ? <AbrirCaja punto={punto} /> : (
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

/** Cómo se cobró: «Efectivo» o, si fue en partes, «Efectivo 40.000 + Tarjeta 20.000». */
function detalleCobro(v: Pick<Venta, 'medio' | 'pagos'>): string {
  if (v.pagos.length <= 1) return v.pagos[0] ? describirParte(v.pagos[0]) : NOMBRE_MEDIO_PAGO[v.medio]
  return v.pagos.map((x) => `${describirParte(x)} ${miles(x.importe)}`).join(' + ')
}

function CampoImporte({ etiqueta, valor, onChange, autoFocus }: { etiqueta: string; valor: number; onChange: (n: number) => void; autoFocus?: boolean }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      <input inputMode="numeric" value={valor ? miles(valor) : ''} placeholder="0" autoFocus={autoFocus} onChange={(e) => onChange(leerImporte(e.target.value))} />
    </label>
  )
}

/** Las rutas de la caja llevan cuál es (la API la ignora para el cajero y Caja Comedor, que tienen la suya). */
const deCaja = (ruta: string, punto: PuntoCaja) => `${ruta}?punto=${punto}`

function AbrirCaja({ punto }: { punto: PuntoCaja }) {
  const [fondo, setFondo] = useState(0)
  const abrir = useAccion(() => post<TipoCaja>(deCaja('/caja/abrir', punto), { fondoInicial: fondo }))
  return (
    <div className="tarjeta abrir-caja">
      <p>
        {punto === 'comedor' ? 'La caja del comedor' : 'La caja'} está cerrada. Para empezar a vender, abrila con el efectivo que hay para dar cambio.
        {punto === 'comedor' && ' Lo que se vende acá sale del depósito Venta comedor.'}
      </p>
      <CampoImporte etiqueta="Fondo inicial en efectivo (Gs.)" valor={fondo} onChange={setFondo} autoFocus />
      <Aviso>{abrir.error}</Aviso>
      <button type="button" className="btn-primario" disabled={abrir.enviando} onClick={() => void abrir.ejecutar()}>Abrir caja</button>
    </div>
  )
}

// ---------- Vender (M11) ----------

function Vender() {
  const productos = useConsulta<ProductoVenta[]>('/ventas/productos')
  const [buscar, setBuscar] = useState('')
  const [carrito, setCarrito] = useState<Map<string, number>>(new Map())
  const [descuento, setDescuento] = useState(0)
  const [partes, setPartes] = useState<ParteForm[]>(() => [parteNueva()])
  const [recibido, setRecibido] = useState(0)
  const [cliente, setCliente] = useState({ nombre: '', ruc: '', direccion: '' })
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
  // Pago híbrido: varias partes de distintos medios; la primera cobra lo que falta. El vuelto es sobre el efectivo.
  const finales = importesFinales(partes, total, 'venta')
  const efectivo = finales.filter((x) => x.medio === 'efectivo').reduce((s, x) => s + x.importe, 0)
  const problema = total > 0 ? faltaEnPartes(partes, total, 'venta') : null
  const vuelto = efectivo > 0 && recibido >= efectivo && recibido > 0 ? recibido - efectivo : null

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
    setCliente({ nombre: '', ruc: '', direccion: '' })
    setConCliente(false)
    setPartes([parteNueva()])
  }
  const cobrar = async () => {
    const v = await vender.ejecutar({
      items: lineas.map((l) => ({ productoId: l.p.id, cantidad: l.n })),
      descuento,
      ...(partes.length > 1 ? { pagos: finales } : { medio: finales[0].medio, pagos: total > 0 ? finales : undefined }),
      recibido: efectivo > 0 && recibido ? recibido : null,
      clienteNombre: cliente.nombre,
      clienteRuc: cliente.ruc,
      clienteDireccion: cliente.direccion,
    })
    if (v) {
      setHecha(v)
      // Si cargó los datos del cliente es porque quiere la factura: va directo a imprimirla, sin otro clic.
      const conFactura = conCliente
      limpiar()
      if (conFactura) void factura.imprimir(`/ventas/${v.id}/factura`)
    }
  }

  if (productos.datos && !lista.length) {
    return <Aviso>Todavía no hay productos con precio de venta. El administrador los carga en Productos.</Aviso>
  }

  return (
    <>
      {hecha && (
        <div className="tarjeta">
          <Aviso tipo="ok">
            Venta N° {hecha.numero} por {gs(hecha.total)} ({detalleCobro(hecha).toLowerCase()}).
            {hecha.vuelto !== null && hecha.vuelto > 0 && <> Vuelto: <strong>{gs(hecha.vuelto)}</strong>.</>}
          </Aviso>
          <div className="fila-acciones">
            <button type="button" className="btn-primario" disabled={factura.enviando} onClick={() => void factura.imprimir(`/ventas/${hecha.id}/factura`)}>
              {factura.ultima?.id === hecha.id ? 'Imprimir de nuevo' : 'Imprimir factura'}
            </button>
            <BotonIcono icono="cancelar" texto="Seguir sin factura" onClick={() => setHecha(null)} />
          </div>
          <Aviso>{factura.error}</Aviso>
          {factura.ultima?.id === hecha.id && factura.ultima.factura && <p className="chico">Factura {factura.ultima.factura.numeroCompleto}</p>}
        </div>
      )}
      <div className="pos">
      <div className="pos-productos">
      <input className="buscar" type="search" placeholder="Buscar producto por nombre…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      <ConDatos consulta={productos}>
        {() => (
          <div className="grilla-venta">
            {filtrados.map((p) => {
              // Lo que queda en el depósito de esta caja (Venta frente o Venta comedor) con lo que ya está en el carrito. Sin stock igual se vende (el cliente ya lo
              // tiene en la mano): solo se avisa, para que alguien lo cargue.
              const quedan = p.stock - (carrito.get(p.id) ?? 0)
              return (
                <button key={p.id} type="button" className={`producto-venta${quedan <= 0 && !p.sinStock ? ' sin-stock' : ''}`} onClick={() => sumar(p.id, 1)}>
                  <strong>{p.nombre}</strong>
                  <span>{gs(p.precio)}</span>
                  {/* Los «sin stock» (buffet por kilo) solo registran lo vendido: no hay cantidad que mostrar. */}
                  {!p.sinStock && <span className={quedan <= 0 ? 'chico stk-negativo' : 'suave chico'}>{quedan <= 0 ? 'Sin stock cargado' : `Quedan ${quedan}`}</span>}
                  {carrito.get(p.id) ? <span className="etq-compra pagada">× {carrito.get(p.id)}</span> : null}
                </button>
              )
            })}
          </div>
        )}
      </ConDatos>
      </div>

      <div className="tarjeta pos-carrito">
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
        </div>
        <PartesPago partes={partes} onChange={setPartes} objetivo={total} modo="venta" />
        {efectivo > 0 && (
          <div className="filtros pago-datos">
            <CampoImporte etiqueta={efectivo === total ? 'Entregó (para el vuelto)' : `Entregó en efectivo (de ${gs(efectivo)})`} valor={recibido} onChange={setRecibido} />
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={conCliente} onChange={(e) => setConCliente(e.target.checked)} />
          <span>Datos del cliente para la factura</span>
        </label>
        {conCliente && (
          <div className="filtros">
            <label className="campo"><span>Nombre o razón social</span><input value={cliente.nombre} maxLength={120} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /></label>
            <label className="campo"><span>RUC o CI</span><input value={cliente.ruc} maxLength={30} onChange={(e) => setCliente({ ...cliente, ruc: e.target.value })} /></label>
            <label className="campo"><span>Dirección <span className="opcional">(opcional)</span></span><input value={cliente.direccion} maxLength={120} onChange={(e) => setCliente({ ...cliente, direccion: e.target.value })} /></label>
          </div>
        )}
        <div className="total-compra"><span>Total{descuento > 0 && <span className="suave chico"> (sin descuento {gs(subtotal)})</span>}</span><strong>{gs(total)}</strong></div>
        {vuelto !== null && <p className="vuelto">Vuelto: <strong>{gs(vuelto)}</strong></p>}
        {lineas.length > 0 && problema && <p className="chico diferencia-negativa">{problema}</p>}
        <Aviso>{vender.error}</Aviso>
        <div className="fila-acciones">
          <button type="button" className="btn-primario" disabled={vender.enviando || !lineas.length || problema !== null} onClick={() => void cobrar()}>
            {vender.enviando ? 'Cobrando…' : `Cobrar ${gs(total)}${conCliente ? ' e imprimir factura' : ''}`}
          </button>
          {lineas.length > 0 && <BotonIcono icono="basurero" texto="Vaciar la venta" tono="peligro" onClick={limpiar} />}
        </div>
      </div>
      </div>
      {factura.vista}
    </>
  )
}

function VentasDeLaCaja({ cajaId }: { cajaId: string }) {
  const puede = usePuede()
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
          <table className="tabla tabla-tarjetas">
            <thead>
              <tr>
                <th>Venta</th><th>Hora</th><th>Detalle</th><th>Medio</th><th className="num">Total</th>
                <th className="acciones"><span className="solo-lector">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <Fragment key={v.id}>
                  <tr className={`${v.anulada ? 'apagado' : ''}${anulando === v.id ? ' con-detalle' : ''}`}>
                    <td data-etiqueta="Venta">
                      <strong>N° {v.numero}</strong>{v.anulada && <span className="etq-compra anulada">Anulada</span>}
                      {v.clienteNombre && <div className="suave chico">{v.clienteNombre}</div>}
                    </td>
                    <td data-etiqueta="Hora">{fechaHoraPY(v.fecha).slice(11)}</td>
                    <td data-etiqueta="Detalle" className="texto-largo">
                      {v.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ')}
                      {(v.descuento > 0 || v.factura) && (
                        <div className="suave chico">
                          {[v.descuento > 0 && `descuento ${gs(v.descuento)}`, v.factura && `factura ${v.factura.numeroCompleto}${v.factura.anulada ? ' (anulada)' : ''}`].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td data-etiqueta="Medio">{detalleCobro(v)}</td>
                    <td data-etiqueta="Total" className="num"><strong>{gs(v.total)}</strong></td>
                    <td className="acciones">
                      {!v.anulada && (
                        <Acciones>
                          <BotonIcono icono="imprimir" texto={v.factura ? 'Reimprimir factura' : 'Imprimir factura'} disabled={factura.enviando} onClick={() => void factura.imprimir(`/ventas/${v.id}/factura`)} />
                          {puede('ventas.anular') && (
                            <BotonIcono icono="anular" texto={`Anular la venta N° ${v.numero}`} tono="peligro" presionado={anulando === v.id}
                              onClick={() => { setAnulando(anulando === v.id ? null : v.id); setMotivo('') }} />
                          )}
                        </Acciones>
                      )}
                    </td>
                  </tr>
                  {anulando === v.id && (
                    <tr className="fila-detalle">
                      <td colSpan={6}>
                        <div className="filtros anular">
                          <label className="campo"><span>Motivo</span><input value={motivo} maxLength={300} autoFocus onChange={(e) => setMotivo(e.target.value)} /></label>
                          <button type="button" className="btn-primario" disabled={anular.enviando || !motivo.trim()} onClick={() => void anular.ejecutar(v.id).then((r) => r && setAnulando(null))}>Anular</button>
                          <BotonIcono icono="cancelar" texto="Cancelar" onClick={() => setAnulando(null)} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
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
  const movimiento = useAccion(() => post<TipoCaja>(deCaja('/caja/movimientos', caja.punto), mov))
  const anularMov = useAccion((id: string) => post<TipoCaja>(`/caja/movimientos/${id}/anular`))
  const arqueo = useAccion((cierre: boolean) => post<TipoCaja>(deCaja(cierre ? '/caja/cerrar' : '/caja/arqueos', caja.punto), { contado, nota }))
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
              <BotonIcono icono="volver" texto="Volver sin cerrar" onClick={() => setCerrando(false)} />
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
          <table className="tabla tabla-tarjetas">
            <thead>
              <tr>
                <th>Concepto</th><th>Hora</th><th>Tipo</th><th>Quién</th><th className="num">Importe</th>
                <th className="acciones"><span className="solo-lector">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {caja.movimientos!.map((m) => (
                <tr key={m.id} className={m.anulado ? 'apagado' : ''}>
                  <td data-etiqueta="Concepto">{m.concepto}{m.anulado && <span className="suave chico"> · anulado</span>}</td>
                  <td data-etiqueta="Hora">{fechaHoraPY(m.fecha).slice(11)}</td>
                  <td data-etiqueta="Tipo">{m.tipo === 'ingreso' ? 'Ingreso' : 'Retiro'} {NOMBRE_MEDIO_PAGO[m.medio].toLowerCase()}</td>
                  <td data-etiqueta="Quién">{m.usuarioNombre}</td>
                  <td data-etiqueta="Importe" className={`num ${m.tipo === 'ingreso' ? 'positivo' : 'negativo'}`}><strong>{m.tipo === 'ingreso' ? '+' : '−'}{miles(m.importe)}</strong></td>
                  <td className="acciones">
                    {!m.anulado && m.origen === 'manual' && (
                      <BotonIcono icono="anular" texto="Anular este movimiento" tono="peligro" disabled={anularMov.enviando} onClick={() => void anularMov.ejecutar(m.id)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <span><strong>{diaLegible(c.dia)}</strong> · {c.punto === 'comedor' ? 'Comedor' : 'Frente'} · {c.abiertaPorNombre}{c.cerradaPorNombre && ` / cerró ${c.cerradaPorNombre}`}</span>
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
