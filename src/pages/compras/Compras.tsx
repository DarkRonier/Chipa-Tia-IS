// M10: compras a proveedores. Una sola pantalla con pestañas según el rol:
// - Sectores: «Nueva compra» (solo productos de su sector en categorías habilitadas) y «Compras» (las que cargó).
// - Supervisor y administrador: además «Por pagar» (pagos parciales y totales), «Proveedores» (alta, edición y cuenta
//   con el historial de saldos) y «Resumen» (reporte simple de compras y pagos, con Excel).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { get, patch, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { celdaDia, descargarExcel, negrita } from '../../cliente/excel'
import { usePuede, useUsuario } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { Icono } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { gs, leerImporte, miles } from '../../shared/dinero'
import { sectorDeRol } from '../../shared/permisos'
import { diaLegible, diaPY, fechaHoraPY, inicioDeMes } from '../../shared/hora'
import {
  MEDIOS_PAGO, NOMBRE_ESTADO_COMPRA, NOMBRE_MEDIO_PAGO,
  type Compra, type CuentaProveedor, type EstadoCompra, type MedioPago, type PedidoCompra, type ProductoCompra, type Proveedor,
  type ReporteCompras,
} from '../../shared/tipos'
import '../../styles/compras.css'

type Pestana = 'nueva' | 'lista' | 'pendientes' | 'proveedores' | 'resumen'

export default function Compras() {
  const puede = usePuede()
  const [params, setParams] = useSearchParams()
  const pestanas: [Pestana, string][] = [
    ['nueva', 'Nueva compra'],
    ['lista', 'Compras'],
    ...(puede('compras.pagar') ? [['pendientes', 'Por pagar'] as [Pestana, string]] : []),
    ...(puede('proveedores.gestionar') ? [['proveedores', 'Proveedores'] as [Pestana, string]] : []),
    ...(puede('reportes.compras') ? [['resumen', 'Resumen'] as [Pestana, string]] : []),
  ]
  const pedida = params.get('ver')
  const pestana: Pestana = pestanas.some(([p]) => p === pedida) ? (pedida as Pestana) : 'nueva'
  return (
    <>
      <Volver titulo="Compras" icono={<Icono nombre="compras" />} />
      <div className="segmentado" role="tablist">
        {pestanas.map(([p, t]) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''}
            onClick={() => setParams({ ver: p }, { replace: true })}>
            {t}
          </button>
        ))}
      </div>
      {pestana === 'nueva' && <NuevaCompra alGuardar={() => setParams({ ver: 'lista' }, { replace: true })} />}
      {pestana === 'lista' && <ListaCompras />}
      {pestana === 'pendientes' && <ListaCompras soloPendientes />}
      {pestana === 'proveedores' && <Proveedores />}
      {pestana === 'resumen' && <Resumen />}
    </>
  )
}

// ---------- Piezas ----------

/** Campo de importe en guaraníes: muestra los puntos de miles mientras se escribe. */
function CampoImporte({ etiqueta, valor, onChange, autoFocus }: { etiqueta: string; valor: number; onChange: (n: number) => void; autoFocus?: boolean }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      <input inputMode="numeric" value={valor ? miles(valor) : ''} placeholder="0" autoFocus={autoFocus}
        onChange={(e) => onChange(leerImporte(e.target.value))} />
    </label>
  )
}

function ElegirMedio({ valor, onChange }: { valor: MedioPago; onChange: (m: MedioPago) => void }) {
  return (
    <label className="campo">
      <span>Medio de pago</span>
      <select value={valor} onChange={(e) => onChange(e.target.value as MedioPago)}>
        {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
      </select>
    </label>
  )
}

export function EtiquetaEstado({ c }: { c: Pick<Compra, 'estado' | 'vencida'> }) {
  return (
    <span className={`etq-compra ${c.vencida ? 'vencida' : c.estado}`}>
      {c.vencida ? 'Vencida' : NOMBRE_ESTADO_COMPRA[c.estado]}
    </span>
  )
}

// ---------- Nueva compra ----------

interface RenglonForm {
  clave: number
  productoId: string
  /** Renglón de texto libre (flete, servicio…), sin stock. */
  libre: boolean
  detalle: string
  cantidad: string
  precio: number
  lote: string
}

let siguienteClave = 1
const renglonVacio = (): RenglonForm => ({ clave: siguienteClave++, productoId: '', libre: false, detalle: '', cantidad: '', precio: 0, lote: '' })

const aCantidad = (s: string) => Number(s.replace(',', '.')) || 0

function NuevaCompra({ alGuardar }: { alGuardar: () => void }) {
  const u = useUsuario()
  const puede = usePuede()
  const libre = sectorDeRol(u.rol) === null
  const hoy = diaPY()
  const proveedores = useConsulta<Proveedor[]>('/proveedores')
  const productos = useConsulta<ProductoCompra[]>('/compras/productos')
  const [proveedorId, setProveedorId] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [diaCompra, setDiaCompra] = useState(hoy)
  const [vencimiento, setVencimiento] = useState('')
  const [nota, setNota] = useState('')
  const [renglones, setRenglones] = useState<RenglonForm[]>([renglonVacio()])
  const [pago, setPago] = useState<'no' | 'total' | 'parte'>('no')
  const [pagoImporte, setPagoImporte] = useState(0)
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const guardar = useAccion((p: PedidoCompra) => post<Compra>('/compras', p))

  const lista = productos.datos ?? []
  const porId = useMemo(() => new Map(lista.map((p) => [p.id, p])), [lista])
  const grupos = useMemo(() => {
    const m = new Map<string, ProductoCompra[]>()
    for (const p of lista) {
      const g = libre ? p.sectorNombre : p.categoriaNombre ?? 'Sin categoría'
      m.set(g, [...(m.get(g) ?? []), p])
    }
    return [...m.entries()]
  }, [lista, libre])

  const cantidadDe = (r: RenglonForm) => (r.productoId ? aCantidad(r.cantidad) : r.libre ? aCantidad(r.cantidad) || 1 : 0)
  const subtotal = (r: RenglonForm) => Math.round(cantidadDe(r) * r.precio)
  const total = renglones.reduce((s, r) => s + subtotal(r), 0)
  const cambiar = (clave: number, cambios: Partial<RenglonForm>) => setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)))

  const enviar = async () => {
    setAviso(null)
    setListo(null)
    guardar.limpiarError()
    if (!proveedorId) return setAviso('Elegí el proveedor.')
    const usados = renglones.filter((r) => r.productoId || (r.libre && r.detalle.trim()))
    if (!usados.length) return setAviso('Cargá al menos un producto.')
    for (const r of usados) {
      const nombre = r.productoId ? porId.get(r.productoId)?.nombre ?? 'el producto' : r.detalle
      if (r.productoId && aCantidad(r.cantidad) <= 0) return setAviso(`Cargá la cantidad de ${nombre}.`)
      if (r.precio <= 0) return setAviso(`Cargá el precio de ${nombre}.`)
    }
    if (pago === 'parte' && (pagoImporte <= 0 || pagoImporte > total)) return setAviso('La entrega tiene que ser mayor que cero y no más que el total.')
    const r = await guardar.ejecutar({
      proveedorId,
      comprobante,
      diaCompra,
      vencimiento: vencimiento || null,
      nota,
      items: usados.map((x) => ({
        productoId: x.productoId || null,
        detalle: x.productoId ? null : x.detalle.trim(),
        cantidad: cantidadDe(x),
        precioUnitario: x.precio,
        lote: x.lote || null,
      })),
      pago: pago === 'no' ? null : { importe: pago === 'total' ? total : pagoImporte, medio },
    })
    if (r) {
      setListo(`Compra a ${r.proveedorNombre} guardada por ${gs(r.total)} (${NOMBRE_ESTADO_COMPRA[r.estado].toLowerCase()}). Lo comprado ya suma al stock.`)
      setComprobante('')
      setVencimiento('')
      setNota('')
      setRenglones([renglonVacio()])
      setPago('no')
      setPagoImporte(0)
    }
  }

  const sinProveedores = proveedores.datos && proveedores.datos.length === 0
  const sinProductos = productos.datos && productos.datos.length === 0

  return (
    <>
      {listo && (
        <>
          <Aviso tipo="ok">{listo}</Aviso>
          <button type="button" className="btn-texto" onClick={alGuardar}>Ver las compras</button>
        </>
      )}
      {sinProveedores && (
        <Aviso>
          {puede('proveedores.gestionar')
            ? 'Todavía no hay proveedores: cargalos en la pestaña Proveedores.'
            : 'Todavía no hay proveedores cargados. Pedile al supervisor o al administrador que los cargue.'}
        </Aviso>
      )}
      {sinProductos && (
        <Aviso>
          {libre
            ? 'No hay productos activos. Cargalos en Catálogos.'
            : 'Tu sector todavía no tiene categorías habilitadas para comprar. Pedíselo al administrador.'}
        </Aviso>
      )}
      <div className="tarjeta filtros">
        <label className="campo">
          <span>Proveedor</span>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegí…</option>
            {(proveedores.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Comprobante (N° de factura o recibo)</span>
          <input value={comprobante} maxLength={60} onChange={(e) => setComprobante(e.target.value)} placeholder="001-001-0001234" />
        </label>
        <label className="campo">
          <span>Fecha de la compra</span>
          <input type="date" value={diaCompra} max={hoy} onChange={(e) => setDiaCompra(e.target.value)} />
        </label>
        <label className="campo">
          <span>Vence (fecha para pagar; vacío = sin vencimiento)</span>
          <input type="date" value={vencimiento} min={diaCompra} onChange={(e) => setVencimiento(e.target.value)} />
        </label>
      </div>

      <h2>Detalle</h2>
      <div className="lista-renglones">
        {renglones.map((r, i) => {
          const p = porId.get(r.productoId)
          const esLibre = r.libre
          return (
            <div key={r.clave} className="tarjeta renglon-compra">
              <label className="campo ancho">
                <span>Producto {i + 1}</span>
                <select value={r.productoId || (esLibre ? '__libre' : '')} onChange={(e) => {
                  const v = e.target.value
                  if (v === '__libre') cambiar(r.clave, { productoId: '', libre: true })
                  else cambiar(r.clave, { productoId: v, libre: false, detalle: '' })
                }}>
                  <option value="">Elegí…</option>
                  {grupos.map(([g, ps]) => (
                    <optgroup key={g} label={g}>
                      {ps.map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.unidad !== 'unidades' ? ` (${x.unidad})` : ''}</option>)}
                    </optgroup>
                  ))}
                  {libre && <option value="__libre">Otro gasto (flete, servicio…), sin stock</option>}
                </select>
              </label>
              {esLibre && (
                <label className="campo ancho">
                  <span>Detalle</span>
                  <input value={r.detalle} maxLength={200} placeholder="Flete" onChange={(e) => cambiar(r.clave, { detalle: e.target.value })} />
                </label>
              )}
              <label className="campo">
                <span>Cantidad{p && p.unidad !== 'unidades' ? ` (${p.unidad})` : ''}</span>
                <input inputMode={p ? 'numeric' : 'decimal'} value={r.cantidad} placeholder={p ? '0' : '1'} onChange={(e) => cambiar(r.clave, { cantidad: e.target.value })} />
              </label>
              <CampoImporte etiqueta="Precio por unidad (Gs.)" valor={r.precio} onChange={(n) => cambiar(r.clave, { precio: n })} />
              {p?.conLotes && (
                <label className="campo">
                  <span>Lote (opcional)</span>
                  <input value={r.lote} maxLength={40} onChange={(e) => cambiar(r.clave, { lote: e.target.value })} />
                </label>
              )}
              <div className="subtotal-renglon">
                <span className="suave">Subtotal</span> <strong>{gs(subtotal(r))}</strong>
                {renglones.length > 1 && (
                  <button type="button" className="btn-texto" onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}>Quitar</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className="btn-secundario" onClick={() => setRenglones((rs) => [...rs, renglonVacio()])}>+ Agregar otro producto</button>

      <div className="tarjeta">
        <div className="total-compra"><span>Total</span><strong>{gs(total)}</strong></div>
        <label className="campo">
          <span>Nota (opcional)</span>
          <input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />
        </label>
        {puede('compras.pagar') ? (
          <>
            <div className="segmentado" role="group" aria-label="Pago">
              {([['no', 'Queda a pagar'], ['total', 'Ya está pagada'], ['parte', 'Se pagó una parte']] as const).map(([v, t]) => (
                <button key={v} type="button" className={pago === v ? 'activo' : ''} aria-pressed={pago === v} onClick={() => setPago(v)}>{t}</button>
              ))}
            </div>
            {pago !== 'no' && (
              <div className="filtros">
                {pago === 'parte' && <CampoImporte etiqueta="Entregado (Gs.)" valor={pagoImporte} onChange={setPagoImporte} />}
                <ElegirMedio valor={medio} onChange={setMedio} />
              </div>
            )}
          </>
        ) : (
          <p className="suave chico">La compra queda «a pagar». El pago lo marcan el supervisor o el administrador.</p>
        )}
      </div>
      <Aviso>{aviso ?? guardar.error}</Aviso>
      <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void enviar()}>
        {guardar.enviando ? 'Guardando…' : 'Guardar compra'}
      </button>
    </>
  )
}

// ---------- Lista de compras ----------

function ListaCompras({ soloPendientes = false }: { soloPendientes?: boolean }) {
  const u = useUsuario()
  const hoy = diaPY()
  const sectores = useSectores()
  const [desde, setDesde] = useState(soloPendientes ? '' : inicioDeMes(hoy))
  const [hasta, setHasta] = useState(soloPendientes ? '' : hoy)
  const [proveedor, setProveedor] = useState('')
  const [estado, setEstado] = useState<'' | EstadoCompra>('')
  const proveedores = useConsulta<Proveedor[]>('/proveedores')
  const compras = useConsulta<Compra[]>('/compras', {
    desde, hasta, proveedor, estado: soloPendientes ? 'pendiente,parcial' : estado,
  })
  const [abierta, setAbierta] = useState<string | null>(null)

  return (
    <>
      <div className="tarjeta filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo">
          <span>Proveedor</span>
          <select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
            <option value="">Todos</option>
            {(proveedores.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        {!soloPendientes && (
          <label className="campo">
            <span>Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoCompra | '')}>
              <option value="">Todos</option>
              {(Object.keys(NOMBRE_ESTADO_COMPRA) as EstadoCompra[]).map((e) => <option key={e} value={e}>{NOMBRE_ESTADO_COMPRA[e]}</option>)}
            </select>
          </label>
        )}
      </div>
      <ConDatos consulta={compras}>
        {(lista) => {
          if (!lista.length) return <p className="suave">{soloPendientes ? 'No hay compras por pagar.' : 'No hay compras en ese período.'}</p>
          const deuda = lista.reduce((s, c) => s + c.saldo, 0)
          return (
            <>
              <p className="suave">
                {lista.length} {lista.length === 1 ? 'compra' : 'compras'} · Total {gs(lista.filter((c) => c.estado !== 'anulada').reduce((s, c) => s + c.total, 0))}
                {deuda > 0 && ` · Falta pagar ${gs(deuda)}`}
              </p>
              <div className="lista">
                {lista.map((c) => (
                  <div key={c.id} className={`item compra-item${c.estado === 'anulada' ? ' apagado' : ''}`}>
                    <button type="button" className="compra-cabeza" aria-expanded={abierta === c.id} onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                      <span><strong>{c.proveedorNombre}</strong>{c.comprobante && <span className="suave"> · {c.comprobante}</span>}</span>
                      <span className="compra-cifras">
                        <strong>{gs(c.total)}</strong>
                        <EtiquetaEstado c={c} />
                      </span>
                      <span className="suave chico">
                        {diaLegible(c.diaCompra)}
                        {c.vencimiento && ` · vence ${diaLegible(c.vencimiento)}`}
                        {c.saldo > 0 && c.estado !== 'pendiente' && ` · falta ${gs(c.saldo)}`}
                        {!sectorDeRol(u.rol) && ` · ${c.sector ? sectores.nombre(c.sector) : c.usuarioNombre}`}
                      </span>
                    </button>
                    {abierta === c.id && <DetalleCompra id={c.id} />}
                  </div>
                ))}
              </div>
            </>
          )
        }}
      </ConDatos>
    </>
  )
}

function DetalleCompra({ id }: { id: string }) {
  const puede = usePuede()
  const c = useConsulta<Compra>(`/compras/${id}`)
  return (
    <ConDatos consulta={c}>
      {(compra) => (
        <div className="detalle-compra">
          <table className="tabla">
            <thead><tr><th>Detalle</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
            <tbody>
              {compra.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productoNombre ?? i.detalle}{i.lote && <span className="suave"> · lote {i.lote}</span>}{!i.productoId && <span className="suave chico"> (sin stock)</span>}</td>
                  <td>{String(i.cantidad).replace('.', ',')}</td>
                  <td>{miles(i.precioUnitario)}</td>
                  <td>{miles(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="chico suave">
            Cargada por {compra.usuarioNombre} el {fechaHoraPY(compra.fecha)}
            {compra.nota && <> · {compra.nota}</>}
          </p>
          {compra.estado === 'anulada' && (
            <Aviso>Anulada por {compra.anuladaPorNombre} el {fechaHoraPY(compra.anuladaEn!)}: {compra.motivoAnulacion}</Aviso>
          )}
          {compra.pagos && <Pagos compra={compra} />}
          {!puede('compras.pagar') && compra.estado !== 'anulada' && (
            <p className="chico">Pagado: {gs(compra.pagado)} · Falta: {gs(compra.saldo)}</p>
          )}
        </div>
      )}
    </ConDatos>
  )
}

function Pagos({ compra }: { compra: Compra }) {
  const hoy = diaPY()
  const [importe, setImporte] = useState(0)
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [diaPago, setDiaPago] = useState(hoy)
  const [nota, setNota] = useState('')
  const [desdeCaja, setDesdeCaja] = useState(false)
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const pagar = useAccion((todo: boolean) =>
    post<Compra>(`/compras/${compra.id}/pagos`, { ...(todo ? { total: true } : { importe }), medio, diaPago, nota, desdeCaja: desdeCaja && medio === 'efectivo' }))
  const anular = useAccion((ruta: string) => post<Compra>(ruta, { motivo }))
  const pagos = compra.pagos ?? []

  const confirmarAnulacion = async (ruta: string) => {
    if (await anular.ejecutar(ruta)) {
      setAnulando(null)
      setMotivo('')
    }
  }
  const pedirMotivo = (clave: string, ruta: string, texto: string) =>
    anulando === clave && (
      <div className="filtros anular">
        <label className="campo"><span>Motivo</span><input value={motivo} maxLength={300} autoFocus onChange={(e) => setMotivo(e.target.value)} /></label>
        <button type="button" className="btn-primario" disabled={anular.enviando || !motivo.trim()} onClick={() => void confirmarAnulacion(ruta)}>{texto}</button>
        <button type="button" className="btn-texto" onClick={() => setAnulando(null)}>Cancelar</button>
      </div>
    )

  return (
    <>
      <h3>Pagos</h3>
      {pagos.length ? (
        <ul className="lista-pagos">
          {pagos.map((g) => (
            <li key={g.id} className={g.anulado ? 'apagado' : ''}>
              <span>{diaLegible(g.diaPago)} · {NOMBRE_MEDIO_PAGO[g.medio]} · <strong>{gs(g.importe)}</strong> · {g.usuarioNombre}{g.nota && ` · ${g.nota}`}</span>
              {g.anulado
                ? <span className="chico"> (anulado: {g.motivoAnulacion})</span>
                : anulando !== g.id && <button type="button" className="btn-texto" onClick={() => { setAnulando(g.id); setMotivo('') }}>Anular pago</button>}
              {pedirMotivo(g.id, `/pagos-proveedor/${g.id}/anular`, 'Anular este pago')}
            </li>
          ))}
        </ul>
      ) : <p className="suave chico">Todavía no tiene pagos.</p>}
      <p><strong>Pagado {gs(compra.pagado)}</strong> · Falta <strong>{gs(compra.saldo)}</strong></p>
      {compra.estado !== 'anulada' && compra.saldo > 0 && (
        <div className="tarjeta filtros">
          <CampoImporte etiqueta="Importe a pagar (Gs.)" valor={importe} onChange={setImporte} />
          <ElegirMedio valor={medio} onChange={setMedio} />
          <label className="campo"><span>Fecha del pago</span><input type="date" value={diaPago} max={hoy} onChange={(e) => setDiaPago(e.target.value)} /></label>
          <label className="campo"><span>Nota (opcional)</span><input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} /></label>
          {medio === 'efectivo' && (
            <label className="check"><input type="checkbox" checked={desdeCaja} onChange={(e) => setDesdeCaja(e.target.checked)} /><span>Sale de la caja abierta</span></label>
          )}
          <button type="button" className="btn-primario" disabled={pagar.enviando || importe <= 0} onClick={() => void pagar.ejecutar(false).then((r) => r && setImporte(0))}>
            Registrar pago
          </button>
          <button type="button" className="btn-secundario" disabled={pagar.enviando} onClick={() => void pagar.ejecutar(true)}>
            Pagar todo ({gs(compra.saldo)})
          </button>
        </div>
      )}
      <Aviso>{pagar.error ?? anular.error}</Aviso>
      {compra.estado !== 'anulada' && compra.pagado === 0 && (
        <>
          {anulando !== 'compra' && <button type="button" className="btn-texto" onClick={() => { setAnulando('compra'); setMotivo('') }}>Anular la compra</button>}
          {pedirMotivo('compra', `/compras/${compra.id}/anular`, 'Anular la compra y descontar el stock')}
        </>
      )}
    </>
  )
}

// ---------- Proveedores ----------

interface DatosProveedor { nombre: string; ruc: string; telefono: string; notas: string }
const VACIO: DatosProveedor = { nombre: '', ruc: '', telefono: '', notas: '' }

function CamposProveedor({ d, set }: { d: DatosProveedor; set: (d: DatosProveedor) => void }) {
  return (
    <>
      <label className="campo"><span>Nombre</span><input value={d.nombre} maxLength={100} onChange={(e) => set({ ...d, nombre: e.target.value })} /></label>
      <label className="campo"><span>RUC (opcional)</span><input value={d.ruc} maxLength={30} onChange={(e) => set({ ...d, ruc: e.target.value })} /></label>
      <label className="campo"><span>Teléfono (opcional)</span><input value={d.telefono} maxLength={40} onChange={(e) => set({ ...d, telefono: e.target.value })} /></label>
      <label className="campo"><span>Notas (opcional)</span><input value={d.notas} maxLength={300} onChange={(e) => set({ ...d, notas: e.target.value })} /></label>
    </>
  )
}

function Proveedores() {
  const puede = usePuede()
  const c = useConsulta<Proveedor[]>('/proveedores', { todos: true })
  const [nuevo, setNuevo] = useState<DatosProveedor>(VACIO)
  const [ok, setOk] = useState<string | null>(null)
  const [cuenta, setCuenta] = useState<string | null>(null)
  const crear = useAccion(() => post<Proveedor>('/proveedores', nuevo))
  const agregar = async () => {
    setOk(null)
    const p = await crear.ejecutar()
    if (p) {
      setOk(`«${p.nombre}» agregado.`)
      setNuevo(VACIO)
    }
  }
  return (
    <>
      <ConDatos consulta={c}>
        {(lista) => lista.length ? (
          <div className="lista">
            {lista.map((p) => (
              <FilaProveedor key={p.id} p={p} abierta={cuenta === p.id} alAbrir={() => setCuenta(cuenta === p.id ? null : p.id)} conCuenta={puede('compras.pagar')} />
            ))}
          </div>
        ) : <p className="suave">Todavía no hay proveedores.</p>}
      </ConDatos>
      <h2>Nuevo proveedor</h2>
      <form className="tarjeta filtros" onSubmit={(e) => { e.preventDefault(); void agregar() }}>
        <CamposProveedor d={nuevo} set={setNuevo} />
        <button className="btn-primario" disabled={crear.enviando}>{crear.enviando ? 'Guardando…' : 'Agregar'}</button>
      </form>
      <Aviso>{crear.error}</Aviso>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
    </>
  )
}

function FilaProveedor({ p, abierta, alAbrir, conCuenta }: { p: Proveedor; abierta: boolean; alAbrir: () => void; conCuenta: boolean }) {
  const [editando, setEditando] = useState(false)
  const [d, setD] = useState<DatosProveedor>(p)
  useEffect(() => setD(p), [p])
  const guardar = useAccion((cambios: Partial<Proveedor>) => patch<Proveedor>(`/proveedores/${p.id}`, cambios))
  const datos = [p.ruc && `RUC ${p.ruc}`, p.telefono, p.notas].filter(Boolean).join(' · ')
  return (
    <div className={`item${p.activo ? '' : ' apagado'}`}>
      <div className="compra-cabeza">
        <span><strong>{p.nombre}</strong>{!p.activo && <span className="suave"> (desactivado)</span>}</span>
        {p.saldo !== null && <span className="compra-cifras">{p.saldo > 0 ? <>Se le debe <strong>{gs(p.saldo)}</strong></> : <span className="suave">Sin deuda</span>}</span>}
        {datos && <span className="suave chico">{datos}</span>}
      </div>
      {editando ? (
        <form className="filtros" onSubmit={(e) => { e.preventDefault(); void guardar.ejecutar(d).then((r) => r && setEditando(false)) }}>
          <CamposProveedor d={d} set={setD} />
          <button className="btn-primario" disabled={guardar.enviando}>Guardar</button>
          <button type="button" className="btn-texto" onClick={() => setEditando(false)}>Cancelar</button>
        </form>
      ) : (
        <div className="fila-acciones">
          <button type="button" className="btn-texto" onClick={() => setEditando(true)}>Editar</button>
          <button type="button" className="btn-texto" disabled={guardar.enviando} onClick={() => void guardar.ejecutar({ activo: !p.activo })}>
            {p.activo ? 'Desactivar' : 'Activar'}
          </button>
          {conCuenta && <button type="button" className="btn-texto" onClick={alAbrir}>{abierta ? 'Ocultar cuenta' : 'Ver cuenta y saldos'}</button>}
        </div>
      )}
      <Aviso>{guardar.error}</Aviso>
      {abierta && <Cuenta id={p.id} />}
    </div>
  )
}

function Cuenta({ id }: { id: string }) {
  const c = useConsulta<CuentaProveedor>(`/proveedores/${id}/cuenta`)
  return (
    <ConDatos consulta={c}>
      {(k) => k.movimientos.length ? (
        <>
          <p className="chico">Comprado {gs(k.totalComprado)} · Pagado {gs(k.totalPagado)} · <strong>Saldo {gs(k.saldo)}</strong></p>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Detalle</th><th>Debe</th><th>Pagó</th><th>Saldo</th></tr></thead>
            <tbody>
              {k.movimientos.map((m) => (
                <tr key={`${m.tipo}-${m.id}`}>
                  <td>{diaLegible(m.dia)}</td>
                  <td>{m.detalle}</td>
                  <td>{m.tipo === 'compra' ? miles(m.importe) : ''}</td>
                  <td>{m.tipo === 'pago' ? miles(m.importe) : ''}</td>
                  <td><strong>{miles(m.saldo)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : <p className="suave chico">Todavía no hay compras a este proveedor.</p>}
    </ConDatos>
  )
}

// ---------- Resumen (reporte simple) ----------

function Resumen() {
  const hoy = diaPY()
  const [desde, setDesde] = useState(inicioDeMes(hoy))
  const [hasta, setHasta] = useState(hoy)
  const r = useConsulta<ReporteCompras>('/reportes/compras', { desde, hasta })
  const exportar = useAccion(async () => {
    const d = await get<ReporteCompras>('/reportes/compras', { desde, hasta })
    const arriba = [[negrita(`Compras y pagos a proveedores · ${diaLegible(d.desde)} al ${diaLegible(d.hasta)}`)]]
    await descargarExcel(`compras-${d.desde}-a-${d.hasta}.xlsx`, [
      {
        nombre: 'Resumen', arriba, encabezados: ['Concepto', 'Importe (Gs.)'],
        filas: [
          ['Compras del período', d.cantidadCompras], ['Total comprado', d.totalComprado], ['Total pagado en el período', d.totalPagado],
          ['Falta pagar de las compras del período', d.pendientePeriodo], ['Deuda total hoy', d.deudaTotal], ['Deuda vencida hoy', d.deudaVencida],
        ],
      },
      { nombre: 'Por proveedor', arriba, encabezados: ['Proveedor', 'Comprado', 'Pagado', 'Saldo'], filas: d.porProveedor.map((p) => [p.proveedorNombre, p.comprado, p.pagado, p.saldo]) },
      { nombre: 'Por categoría', arriba, encabezados: ['Categoría', 'Importe'], filas: d.porCategoria.map((k) => [k.categoriaNombre, k.importe]) },
      {
        nombre: 'Pagos', arriba, encabezados: ['Fecha', 'Proveedor', 'Comprobante', 'Medio', 'Importe', 'Cargado por'],
        filas: d.pagos.map((g) => [celdaDia(g.diaPago), g.proveedorNombre, g.comprobante, NOMBRE_MEDIO_PAGO[g.medio], g.importe, g.usuarioNombre]),
      },
    ])
  })
  return (
    <>
      <div className="tarjeta filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button type="button" className="btn-secundario" disabled={exportar.enviando} onClick={() => void exportar.ejecutar()}>Descargar Excel</button>
      </div>
      <Aviso>{exportar.error}</Aviso>
      <ConDatos consulta={r}>
        {(d) => (
          <>
            <div className="cifras">
              <div className="cifra"><span className="suave chico">Comprado ({d.cantidadCompras})</span><strong>{gs(d.totalComprado)}</strong></div>
              <div className="cifra"><span className="suave chico">Pagado en el período</span><strong>{gs(d.totalPagado)}</strong></div>
              <div className="cifra"><span className="suave chico">Deuda total hoy</span><strong>{gs(d.deudaTotal)}</strong></div>
              <div className="cifra"><span className="suave chico">Deuda vencida</span><strong>{gs(d.deudaVencida)}</strong></div>
            </div>
            {d.porVencer.length > 0 && (
              <>
                <h2>Por vencer o vencidas</h2>
                <ul className="lista-pagos">
                  {d.porVencer.map((c) => (
                    <li key={c.id}>{diaLegible(c.vencimiento!)} · {c.proveedorNombre}{c.comprobante && ` (${c.comprobante})`} · falta <strong>{gs(c.saldo)}</strong> <EtiquetaEstado c={c} /></li>
                  ))}
                </ul>
              </>
            )}
            <h2>Por proveedor</h2>
            {d.porProveedor.length ? (
              <table className="tabla">
                <thead><tr><th>Proveedor</th><th>Comprado</th><th>Pagado</th><th>Saldo</th></tr></thead>
                <tbody>{d.porProveedor.map((p) => <tr key={p.proveedorId}><td>{p.proveedorNombre}</td><td>{miles(p.comprado)}</td><td>{miles(p.pagado)}</td><td>{miles(p.saldo)}</td></tr>)}</tbody>
              </table>
            ) : <p className="suave">Sin compras ni pagos en el período.</p>}
            {d.porCategoria.length > 0 && (
              <>
                <h2>Por categoría</h2>
                <table className="tabla">
                  <tbody>{d.porCategoria.map((k) => <tr key={k.categoriaId ?? 'sin'}><td>{k.categoriaNombre}</td><td>{gs(k.importe)}</td></tr>)}</tbody>
                </table>
              </>
            )}
            {d.porMedio.length > 0 && (
              <p className="suave">Pagos por medio: {d.porMedio.map((m) => `${NOMBRE_MEDIO_PAGO[m.medio]} ${gs(m.importe)}`).join(' · ')}</p>
            )}
          </>
        )}
      </ConDatos>
    </>
  )
}
