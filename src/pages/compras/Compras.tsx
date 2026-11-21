// M10: compras a proveedores. La compra se carga en su propia página (/compras/nueva) y queda pendiente de pago.
// Pestañas: «Pendientes de pago» (el supervisor y el administrador marcan pagos parciales o totales; los sectores solo
// miran), «Todas las compras» y, para supervisor y administrador, «Resumen» (reporte simple con Excel).
// Los proveedores tienen su propio menú (/proveedores).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { get, patch, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { celdaDia, descargarExcel, negrita } from '../../cliente/excel'
import { usePuede, useUsuario } from '../../cliente/sesion'
import Buscador, { normalizar } from '../../components/Buscador'
import BotonIcono, { Acciones, LinkIcono } from '../../components/BotonIcono'
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

type Pestana = 'pendientes' | 'lista' | 'resumen'

export default function Compras() {
  const puede = usePuede()
  const [params, setParams] = useSearchParams()
  const pestanas: [Pestana, string][] = [
    ['pendientes', 'Pendientes de pago'],
    ['lista', 'Todas las compras'],
    ...(puede('reportes.compras') ? [['resumen', 'Resumen'] as [Pestana, string]] : []),
  ]
  const pedida = params.get('ver')
  const pestana: Pestana = pestanas.some(([p]) => p === pedida) ? (pedida as Pestana) : 'pendientes'
  const nueva = params.get('nueva')
  return (
    <>
      <Volver titulo="Compras" icono={<Icono nombre="compras" />}
        accion={<Link to="/compras/nueva" className="btn-primario btn-accion">+ Nueva compra</Link>} />
      {nueva && pestana === 'pendientes' && (
        <Aviso tipo="ok">
          Compra guardada: lo comprado ya suma al stock y quedó pendiente de pago
          {puede('compras.pagar') ? '. Tocala para marcar el pago.' : '. El pago lo marcan el supervisor o el administrador.'}
        </Aviso>
      )}
      <div className="segmentado" role="tablist">
        {pestanas.map(([p, t]) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''}
            onClick={() => setParams({ ver: p }, { replace: true })}>
            {t}
          </button>
        ))}
      </div>
      {pestana === 'pendientes' && <ListaCompras soloPendientes abrir={nueva} />}
      {pestana === 'lista' && <ListaCompras />}
      {pestana === 'resumen' && <Resumen />}
    </>
  )
}

/** Menú propio de proveedores (supervisor y administrador). */
export function PaginaProveedores() {
  return (
    <>
      <Volver titulo="Proveedores" icono={<Icono nombre="compras" />} />
      <Proveedores />
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

// ---------- Nueva compra (página propia: /compras/nueva) ----------

interface RenglonForm {
  clave: number
  productoId: string
  /** Renglón de texto libre (flete, servicio…), sin stock. */
  libre: boolean
  detalle: string
  cantidad: string
  precio: number
  lote: string
  /** Vencimiento del lote (materia prima de Chipería). */
  vence: string
}

let siguienteClave = 1
const renglonVacio = (): RenglonForm => ({ clave: siguienteClave++, productoId: '', libre: false, detalle: '', cantidad: '', precio: 0, lote: '', vence: '' })

const aCantidad = (s: string) => Number(s.replace(',', '.')) || 0

/**
 * Carga de una compra. Proveedor y comprobante son opcionales (hay proveedores locales sin nombre ni factura, como el
 * del huevo o el queso). La compra se guarda siempre pendiente de pago y se pasa a «Pendientes de pago», donde el
 * supervisor o el administrador marcan el pago.
 */
export function NuevaCompra() {
  const u = useUsuario()
  const puede = usePuede()
  const navegar = useNavigate()
  const libre = sectorDeRol(u.rol) === null
  const hoy = diaPY()
  const proveedores = useConsulta<Proveedor[]>('/proveedores')
  const productos = useConsulta<ProductoCompra[]>('/compras/productos')
  const [proveedor, setProveedor] = useState<Proveedor | null>(null)
  const [comprobante, setComprobante] = useState('')
  const [diaCompra, setDiaCompra] = useState(hoy)
  const [vencimiento, setVencimiento] = useState('')
  const [nota, setNota] = useState('')
  const [renglones, setRenglones] = useState<RenglonForm[]>([renglonVacio()])
  /** Renglón con el basurero a la vista (después de un clic derecho o de mantenerlo apretado). */
  const [menu, setMenu] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const guardar = useAccion((p: PedidoCompra) => post<Compra>('/compras', p))

  // El basurero se esconde al tocar en otro lado o con Escape.
  useEffect(() => {
    if (menu === null) return
    const cerrar = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest('.btn-basurero')) return
      setMenu(null)
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', cerrar)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('keydown', cerrar)
    }
  }, [menu])

  const lista = productos.datos ?? []
  const porId = useMemo(() => new Map(lista.map((p) => [p.id, p])), [lista])
  const opciones = useMemo(() => lista.map((p) => ({
    ...p,
    detalle: [libre ? p.sectorNombre : null, p.categoriaNombre, p.unidad !== 'unidades' ? p.unidad : null].filter(Boolean).join(' · '),
  })), [lista, libre])
  const opcionesProveedor = useMemo(() => (proveedores.datos ?? []).map((p) => ({ ...p, codigo: p.ruc, detalle: p.telefono })), [proveedores.datos])

  const cantidadDe = (r: RenglonForm) => (r.productoId ? aCantidad(r.cantidad) : r.libre ? aCantidad(r.cantidad) || 1 : 0)
  const subtotal = (r: RenglonForm) => Math.round(cantidadDe(r) * r.precio)
  const total = renglones.reduce((s, r) => s + subtotal(r), 0)
  const usado = (r: RenglonForm) => !!r.productoId || r.libre
  const cambiar = (clave: number, cambios: Partial<RenglonForm>) => setRenglones((rs) => {
    const nuevos = rs.map((r) => (r.clave === clave ? { ...r, ...cambios } : r))
    // Siempre queda una línea vacía al final para seguir cargando.
    return usado(nuevos[nuevos.length - 1]) ? [...nuevos, renglonVacio()] : nuevos
  })
  const quitar = (clave: number) => {
    setMenu(null)
    setRenglones((rs) => {
      const quedan = rs.filter((x) => x.clave !== clave)
      return quedan.length && !usado(quedan[quedan.length - 1]) ? quedan : [...quedan, renglonVacio()]
    })
  }
  const enfocar = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    // Si el campo todavía está deshabilitado (la línea recién se completa), se enfoca después de dibujarla.
    if (el && !el.disabled) el.focus()
    else requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  const enviar = async () => {
    setAviso(null)
    guardar.limpiarError()
    const usados = renglones.filter((r) => r.productoId || (r.libre && r.detalle.trim()))
    if (!usados.length) return setAviso('Cargá al menos un producto.')
    for (const r of usados) {
      const nombre = r.productoId ? porId.get(r.productoId)?.nombre ?? 'el producto' : r.detalle
      if (r.productoId && aCantidad(r.cantidad) <= 0) { enfocar(`cant-${r.clave}`); return setAviso(`Cargá la cantidad de ${nombre}.`) }
      if (r.precio <= 0) { enfocar(`precio-${r.clave}`); return setAviso(`Cargá el precio de ${nombre}.`) }
      if (r.productoId && porId.get(r.productoId)?.loteMP && !r.vence) {
        enfocar(`vence-${r.clave}`)
        return setAviso(`Cargá cuándo vence ${nombre}: con eso queda su lote en «Materia prima y lotes».`)
      }
    }
    const r = await guardar.ejecutar({
      proveedorId: proveedor?.id ?? null,
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
        vencimiento: porId.get(x.productoId)?.loteMP ? x.vence || null : null,
      })),
    })
    if (r) navegar(`/compras?ver=pendientes&nueva=${r.id}`)
  }

  const sinProductos = productos.datos && productos.datos.length === 0
  const cargados = renglones.filter(usado).length

  return (
    <>
      <Volver titulo="Nueva compra" icono={<Icono nombre="compras" />} a="/compras" />
      {sinProductos && (
        <Aviso>
          {libre
            ? 'No hay productos activos. Cargalos en Productos.'
            : 'Tu sector todavía no tiene categorías habilitadas para comprar. Pedíselo al administrador.'}
        </Aviso>
      )}
      <section className="tarjeta datos-compra" aria-label="Datos de la compra">
        <Buscador
          etiqueta="Proveedor" opciones={opcionesProveedor} elegido={proveedor ? opcionesProveedor.find((p) => p.id === proveedor.id) ?? null : null}
          onElegir={(p) => setProveedor(p)} vaciable placeholder="Sin nombre (opcional): buscá por nombre o RUC"
        />
        <label className="campo">
          <span>N° de factura o recibo <span className="opcional">opcional</span></span>
          <input value={comprobante} maxLength={60} onChange={(e) => setComprobante(e.target.value)} placeholder="001-001-0001234" />
        </label>
        <label className="campo">
          <span>Fecha de la compra</span>
          <input type="date" value={diaCompra} max={hoy} onChange={(e) => setDiaCompra(e.target.value)} />
        </label>
        <label className="campo">
          <span>Vence el pago <span className="opcional">opcional</span></span>
          <input type="date" value={vencimiento} min={diaCompra} onChange={(e) => setVencimiento(e.target.value)} />
        </label>
      </section>
      {puede('proveedores.gestionar') && !proveedores.cargando && !opcionesProveedor.length && (
        <p className="suave chico">Todavía no hay proveedores: la compra queda «Sin nombre», o crealos en <Link className="btn-discreto chico" to="/proveedores">Proveedores</Link>.</p>
      )}

      <section className="tarjeta renglones" aria-label="Productos comprados">
        <div className="renglon renglon-cabeza" aria-hidden="true">
          <span>Producto</span><span>Cantidad</span><span>Precio unitario</span><span className="a-la-derecha">Subtotal</span><span />
        </div>
        {renglones.map((r, i) => {
          const p = porId.get(r.productoId)
          const ultimo = i === renglones.length - 1
          return (
            <div key={r.clave} className={`renglon${menu === r.clave ? ' con-menu' : ''}${!usado(r) ? ' vacio' : ''}`}
              onContextMenu={(e) => {
                if (!usado(r) && renglones.length === 1) return
                e.preventDefault()
                setMenu(r.clave)
              }}>
              {r.libre ? (
                <label className="campo renglon-producto">
                  <span className="solo-lector">Detalle del gasto</span>
                  <input id={`prod-${r.clave}`} value={r.detalle} maxLength={200} placeholder="Otro gasto sin stock: flete, servicio…" autoFocus
                    onChange={(e) => cambiar(r.clave, { detalle: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enfocar(`cant-${r.clave}`) } }} />
                </label>
              ) : (
                <Buscador
                  className="renglon-producto" inputId={`prod-${r.clave}`} sinEtiqueta etiqueta={`Producto ${i + 1}`} opciones={opciones}
                  elegido={opciones.find((x) => x.id === r.productoId) ?? null}
                  placeholder={ultimo && i > 0 ? 'Agregar otro producto…' : 'Buscá el producto por nombre o código…'}
                  onElegir={(x) => {
                    if (!x) return
                    cambiar(r.clave, { productoId: x.id, libre: false, detalle: '' })
                    enfocar(`cant-${r.clave}`)
                  }}
                  extra={libre ? { texto: '+ Otro gasto sin stock (flete, servicio…)', alElegir: () => cambiar(r.clave, { productoId: '', libre: true }) } : undefined}
                />
              )}
              <label className="campo renglon-cantidad">
                <span className="etq-movil">Cantidad</span>
                <span className="con-sufijo">
                  <input id={`cant-${r.clave}`} inputMode="decimal" value={r.cantidad} placeholder={r.libre ? '1' : '0'} disabled={!usado(r)}
                    onChange={(e) => cambiar(r.clave, { cantidad: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enfocar(`precio-${r.clave}`) } }} />
                  {p && p.unidad !== 'unidades' && <span className="sufijo">{p.unidad}</span>}
                </span>
              </label>
              <label className="campo renglon-precio">
                <span className="etq-movil">Precio unitario</span>
                <span className="con-sufijo">
                  <span className="prefijo">Gs.</span>
                  <input id={`precio-${r.clave}`} inputMode="numeric" value={r.precio ? miles(r.precio) : ''} placeholder="0" disabled={!usado(r)}
                    onChange={(e) => cambiar(r.clave, { precio: leerImporte(e.target.value) })}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const siguiente = renglones[i + 1]
                      if (siguiente) enfocar(`prod-${siguiente.clave}`)
                    }} />
                </span>
              </label>
              <output className="renglon-subtotal" aria-label="Subtotal">{usado(r) ? gs(subtotal(r)) : ''}</output>
              <div className="renglon-acciones">
                {menu === r.clave && (
                  <button type="button" className="btn-basurero" aria-label="Borrar esta línea" title="Borrar esta línea" autoFocus onClick={() => quitar(r.clave)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                  </button>
                )}
              </div>
              {p?.conLotes && (
                <div className="renglon-lote">
                  <label className="campo">
                    <span>{p.loteMP ? 'N° de lote' : 'Lote'} <span className="opcional">{p.loteMP ? 'si el envase lo trae' : 'opcional'}</span></span>
                    <input value={r.lote} maxLength={40} onChange={(e) => cambiar(r.clave, { lote: e.target.value })} />
                  </label>
                  {p.loteMP && (
                    <label className="campo">
                      <span>Vence</span>
                      <input id={`vence-${r.clave}`} type="date" value={r.vence} min={hoy} required onChange={(e) => cambiar(r.clave, { vence: e.target.value })} />
                    </label>
                  )}
                  {p.loteMP && <span className="suave chico">Queda como lote de materia prima, para elegirlo en la amasada.</span>}
                </div>
              )}
            </div>
          )
        })}
        <div className="renglones-pie">
          <span className="suave chico">
            {cargados > 0 ? `${cargados} ${cargados === 1 ? 'producto' : 'productos'} · ` : ''}Para borrar una línea: clic derecho sobre ella (en el celular, mantenela apretada).
          </span>
          <div className="total-compra"><span>Total</span><strong>{gs(total)}</strong></div>
        </div>
      </section>

      <label className="campo">
        <span>Nota <span className="opcional">opcional</span></span>
        <input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />
      </label>
      <p className="suave chico">
        La compra queda pendiente de pago y lo comprado suma al stock. El pago lo marcan el supervisor o el administrador en Pendientes de pago.
      </p>
      <Aviso>{aviso ?? guardar.error}</Aviso>
      <div className="fila-acciones acciones-form">
        <button type="button" className="btn-primario" disabled={guardar.enviando || !cargados} onClick={() => void enviar()}>
          {guardar.enviando ? 'Guardando…' : `Guardar compra${total ? ` · ${gs(total)}` : ''}`}
        </button>
        <LinkIcono to="/compras" icono="cancelar" texto="Cancelar la compra" />
      </div>
    </>
  )
}

// ---------- Lista de compras ----------

function ListaCompras({ soloPendientes = false, abrir = null }: { soloPendientes?: boolean; abrir?: string | null }) {
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
  const [abierta, setAbierta] = useState<string | null>(abrir)
  const conQuien = !sectorDeRol(u.rol)

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
              <table className="tabla tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Proveedor</th><th>Fecha</th><th>Comprobante</th>
                    {conQuien && <th>Cargó</th>}
                    <th className="num">Total</th><th>Estado</th><th className="num">Falta pagar</th>
                    <th className="acciones"><span className="solo-lector">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const abre = () => setAbierta(abierta === c.id ? null : c.id)
                    return (
                      <Fragment key={c.id}>
                        <tr className={`se-abre${c.estado === 'anulada' ? ' apagado' : ''}${abierta === c.id ? ' con-detalle' : ''}`} onClick={abre}>
                          <td data-etiqueta="Proveedor"><strong>{c.proveedorNombre}</strong></td>
                          <td data-etiqueta="Fecha">
                            {diaLegible(c.diaCompra)}
                            {c.vencimiento && <span className="suave chico"> · vence {diaLegible(c.vencimiento)}</span>}
                          </td>
                          <td data-etiqueta="Comprobante" className={c.comprobante ? undefined : 'vacia'}>{c.comprobante || <span className="suave">—</span>}</td>
                          {conQuien && <td data-etiqueta="Cargó">{c.sector ? sectores.nombre(c.sector) : c.usuarioNombre}</td>}
                          <td data-etiqueta="Total" className="num"><strong>{gs(c.total)}</strong></td>
                          <td data-etiqueta="Estado"><EtiquetaEstado c={c} /></td>
                          <td data-etiqueta="Falta pagar" className={`num${c.saldo > 0 && c.estado !== 'anulada' ? '' : ' vacia'}`}>
                            {c.saldo > 0 && c.estado !== 'anulada' ? gs(c.saldo) : <span className="suave">—</span>}
                          </td>
                          <td className="acciones">
                            <BotonIcono
                              icono="ver" texto={abierta === c.id ? 'Ocultar el detalle' : 'Ver detalle y pagos'} presionado={abierta === c.id}
                              onClick={(e) => { e.stopPropagation(); abre() }}
                            />
                          </td>
                        </tr>
                        {abierta === c.id && (
                          <tr className="fila-detalle"><td colSpan={conQuien ? 8 : 7}><DetalleCompra id={c.id} /></td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
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
                  <td>{i.productoNombre ?? i.detalle}{i.lote && <span className="suave"> · lote {i.lote}</span>}{i.vencimiento && <span className="suave"> · vence {diaLegible(i.vencimiento)}</span>}{!i.productoId && <span className="suave chico"> (sin stock)</span>}</td>
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
        <BotonIcono icono="cancelar" texto="Cancelar" onClick={() => setAnulando(null)} />
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
                : anulando !== g.id && <BotonIcono icono="anular" texto="Anular este pago" tono="peligro" onClick={() => { setAnulando(g.id); setMotivo('') }} />}
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
          {anulando !== 'compra' && <div className="fila-acciones"><BotonIcono icono="anular" texto="Anular la compra" tono="peligro" onClick={() => { setAnulando('compra'); setMotivo('') }} /></div>}
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
  const [busca, setBusca] = useState('')
  const crear = useAccion(() => post<Proveedor>('/proveedores', nuevo))
  const conCuenta = puede('compras.pagar')
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
        {(lista) => {
          if (!lista.length) return <p className="suave">Todavía no hay proveedores.</p>
          const q = normalizar(busca)
          const vistos = q ? lista.filter((p) => normalizar([p.nombre, p.ruc, p.telefono, p.notas].join(' ')).includes(q)) : lista
          const conSaldo = lista.some((p) => p.saldo !== null)
          return (
            <>
              {lista.length > 5 && (
                <label className="campo prov-buscar">
                  <span className="solo-lector">Buscar proveedor</span>
                  <input type="search" value={busca} placeholder="Buscar por nombre, RUC o teléfono…" onChange={(e) => setBusca(e.target.value)} />
                </label>
              )}
              {vistos.length ? (
                <table className="tabla tabla-tarjetas">
                  <thead>
                    <tr>
                      <th>Proveedor</th><th>RUC</th><th>Teléfono</th><th>Notas</th>
                      {conSaldo && <th className="num">Se le debe</th>}
                      <th className="acciones"><span className="solo-lector">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vistos.map((p) => (
                      <FilaProveedor
                        key={p.id} p={p} columnas={conSaldo ? 6 : 5} conSaldo={conSaldo}
                        abierta={cuenta === p.id} alAbrir={() => setCuenta(cuenta === p.id ? null : p.id)} conCuenta={conCuenta}
                      />
                    ))}
                  </tbody>
                </table>
              ) : <p className="suave">No hay proveedores con «{busca}».</p>}
            </>
          )
        }}
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

interface PropsFilaProveedor { p: Proveedor; abierta: boolean; alAbrir: () => void; conCuenta: boolean; conSaldo: boolean; columnas: number }

function FilaProveedor({ p, abierta, alAbrir, conCuenta, conSaldo, columnas }: PropsFilaProveedor) {
  const [editando, setEditando] = useState(false)
  const [d, setD] = useState<DatosProveedor>(p)
  useEffect(() => setD(p), [p])
  const guardar = useAccion((cambios: Partial<Proveedor>) => patch<Proveedor>(`/proveedores/${p.id}`, cambios))
  const nada = <span className="suave">—</span>
  return (
    <>
      <tr className={`${p.activo ? '' : 'apagado'}${abierta || editando ? ' con-detalle' : ''}`}>
        <td data-etiqueta="Proveedor"><strong>{p.nombre}</strong>{!p.activo && <span className="etiqueta apagada">Desactivado</span>}</td>
        <td data-etiqueta="RUC" className={p.ruc ? 'sin-cortar' : 'vacia'}>{p.ruc || nada}</td>
        <td data-etiqueta="Teléfono" className={p.telefono ? 'sin-cortar' : 'vacia'}>{p.telefono || nada}</td>
        <td data-etiqueta="Notas" className={`texto-largo${p.notas ? '' : ' vacia'}`}>{p.notas || nada}</td>
        {conSaldo && (
          <td data-etiqueta="Se le debe" className="num">
            {p.saldo === null ? nada : p.saldo > 0 ? <strong>{gs(p.saldo)}</strong> : <span className="suave">Sin deuda</span>}
          </td>
        )}
        <td className="acciones">
          <Acciones>
            <BotonIcono icono="editar" texto={`Editar ${p.nombre}`} presionado={editando} onClick={() => setEditando(!editando)} />
            {p.activo
              ? <BotonIcono icono="desactivar" texto={`Desactivar ${p.nombre}`} tono="peligro" disabled={guardar.enviando} onClick={() => void guardar.ejecutar({ activo: false })} />
              : <BotonIcono icono="activar" texto={`Activar ${p.nombre}`} tono="positivo" disabled={guardar.enviando} onClick={() => void guardar.ejecutar({ activo: true })} />}
            {conCuenta && <BotonIcono icono="cuenta" texto={abierta ? 'Ocultar la cuenta' : 'Ver cuenta y saldos'} presionado={abierta} onClick={alAbrir} />}
          </Acciones>
        </td>
      </tr>
      {(editando || abierta || guardar.error) && (
        <tr className="fila-detalle">
          <td colSpan={columnas}>
            {editando && (
              <form className="filtros" onSubmit={(e) => { e.preventDefault(); void guardar.ejecutar(d).then((r) => r && setEditando(false)) }}>
                <CamposProveedor d={d} set={setD} />
                <button className="btn-primario" disabled={guardar.enviando}>Guardar</button>
                <BotonIcono icono="cancelar" texto="Cancelar" onClick={() => { setD(p); setEditando(false) }} />
              </form>
            )}
            <Aviso>{guardar.error}</Aviso>
            {abierta && <Cuenta id={p.id} />}
          </td>
        </tr>
      )}
    </>
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
