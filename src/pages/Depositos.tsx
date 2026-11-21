// Depósitos (Mati, 2026-11-21): lo que hay de cada producto en cada depósito.
//   - Venta frente y Venta comedor: cuánto hay y cuánto se vendió hoy. Los productos «sin stock» (el buffet por kilo)
//     solo muestran lo vendido.
//   - Almacenes en frío (varios) y Materia prima: cuánto hay, por lote en los sectores con lotes.
//   - Sucursales: no tienen stock en el sistema; se muestra solo lo que se les envió.
// Los productos se agrupan por categoría (Chipas y bocaditos, Chipa Sticks, Buffet, Panificados, Materia prima, Bebidas, Amandau, Otros), no por sector.
// Abajo: «Transferir» (pasar de un depósito a otro) y, para el administrador, mermas, vencimientos y ajustes.
// El super-administrador crea y borra almacenes.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, patch, post } from '../cliente/api'
import { useCategorias, useDepositos, useSectores } from '../cliente/catalogo'
import { useAccion, useConsulta } from '../cliente/consultas'
import { useEsSuper, usePuede, useUsuario } from '../cliente/sesion'
import { normalizar } from '../components/Buscador'
import { Aviso, ConDatos } from '../components/Estado'
import Modal from '../components/Modal'
import Numero from '../components/Numero'
import { diaLegible, diaPY, sumarDias } from '../shared/hora'
import { sectorDeRol } from '../shared/permisos'
import {
  NOMBRE_TIPO_MOVIMIENTO, type Deposito, type EnvioResumen, type Movimiento, type PedidoAjuste, type PedidoTransferencia,
  type StockFila, type TipoAjuste, type VendidoFila,
} from '../shared/tipos'
import { conSigno, TablaMovimientos } from './sector/Historial'
import '../styles/catalogos.css'
import '../styles/stock.css'

/** Pestaña de las sucursales (no es un depósito). */
const SUCURSALES = '__sucursales'

/** «12 kg», «3 unidades», «1 docena». */
export function conUnidad(n: number, unidad: string) {
  const u = (unidad || 'unidades').trim()
  if (Math.abs(n) !== 1) return `${n} ${u}`
  const singular: Record<string, string> = { unidades: 'unidad', docenas: 'docena', litros: 'litro', paquetes: 'paquete', porciones: 'porción' }
  return `${n} ${singular[u] ?? u}`
}

export default function Depositos() {
  const depositos = useDepositos()
  const [elegido, setElegido] = useState('')
  const [creando, setCreando] = useState(false)
  const esSuper = useEsSuper()
  const actual = depositos.lista.find((d) => d.id === elegido) ?? (elegido === SUCURSALES ? null : depositos.lista[0])
  const pestana = elegido === SUCURSALES ? SUCURSALES : (actual?.id ?? '')

  return (
    <>
      <h1>Depósitos</h1>
      <ConDatos consulta={depositos}>
        {(lista) => (
          <>
            <div className="segmentado stk-depositos" role="tablist" aria-label="Depósito">
              {lista.map((d) => (
                <button key={d.id} type="button" role="tab" className={pestana === d.id ? 'activo' : ''} aria-selected={pestana === d.id} onClick={() => setElegido(d.id)}>
                  {d.nombre}
                </button>
              ))}
              <button type="button" role="tab" className={pestana === SUCURSALES ? 'activo' : ''} aria-selected={pestana === SUCURSALES} onClick={() => setElegido(SUCURSALES)}>
                Sucursales
              </button>
              {esSuper && (
                <button type="button" className="stk-nuevo" onClick={() => setCreando(true)}>+ Nuevo almacén</button>
              )}
            </div>
            {pestana === SUCURSALES ? <Sucursales /> : actual && <DepositoElegido key={actual.id} deposito={actual} />}
            {creando && <NuevoAlmacen alCerrar={() => setCreando(false)} alCrear={(d) => { setElegido(d.id); setCreando(false) }} />}
          </>
        )}
      </ConDatos>
    </>
  )
}

function DepositoElegido({ deposito }: { deposito: Deposito }) {
  const u = useUsuario()
  const puede = usePuede()
  const esSuper = useEsSuper()
  const stock = useConsulta<StockFila[]>('/stock', { todos: 1 })
  const esVenta = deposito.tipo === 'venta'
  const vendido = useConsulta<VendidoFila[]>(esVenta ? '/stock/vendido' : null)
  const [editando, setEditando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const miSector = sectorDeRol(u.rol)

  return (
    <>
      <div className="stk-cabeza">
        <div>
          <h2>{deposito.nombre}</h2>
          <p className="suave chico">
            {deposito.descripcion || (esVenta ? 'Depósito de venta directa.' : 'Almacén.')}
            {esVenta && ' Se registra cuánto hay y cuánto se vende.'}
          </p>
        </div>
        <div className="stk-cabeza-acciones">
          {puede('catalogos.editar') && <button type="button" className="btn-discreto" onClick={() => setEditando(true)}>Cambiar nombre</button>}
          {esSuper && deposito.tipo === 'almacen' && !deposito.sistema && (
            <button type="button" className="btn-discreto rojo" onClick={() => setBorrando(true)}>Borrar almacén</button>
          )}
        </div>
      </div>
      <ConDatos consulta={stock}>
        {(filas) => (
          <>
            <TablaDeposito deposito={deposito} filas={filas} vendido={vendido.datos ?? []} />
            {puede('stock.mover') && (
              <Transferir
                key={deposito.id}
                desde={deposito}
                filas={filas.filter((f) => !miSector || f.sector === miSector)}
              />
            )}
            {puede('stock.ajustar') && <AjusteStock key={`a-${deposito.id}`} deposito={deposito} filas={filas} />}
          </>
        )}
      </ConDatos>
      {editando && <EditarDeposito deposito={deposito} alCerrar={() => setEditando(false)} />}
      {borrando && <BorrarAlmacen deposito={deposito} alCerrar={() => setBorrando(false)} />}
    </>
  )
}

/** Lo que hay en el depósito, agrupado por categoría, con filtros de categoría y búsqueda. */
function TablaDeposito({ deposito, filas, vendido }: { deposito: Deposito; filas: StockFila[]; vendido: VendidoFila[] }) {
  const categorias = useCategorias()
  const sectores = useSectores()
  const [categoria, setCategoria] = useState('')
  const [buscar, setBuscar] = useState('')
  const [ocultarCeros, setOcultarCeros] = useState(true)
  const esVenta = deposito.tipo === 'venta'
  const conLotes = (f: StockFila) => sectores.lista.find((s) => s.id === f.sector)?.conLotes ?? false
  const hay = (f: { porDeposito: Record<string, number> }) => f.porDeposito[deposito.id] ?? 0
  const vendidoDe = (id: string) => vendido.find((v) => v.productoId === id && v.depositoId === deposito.id)?.cantidad ?? 0

  const palabras = normalizar(buscar).split(/\s+/).filter(Boolean)
  const coincide = (texto: string) => palabras.every((p) => normalizar(texto).includes(p))
  const visibles = filas.filter((f) =>
    (!categoria || (f.categoriaId ?? '') === categoria) &&
    coincide(`${f.productoNombre} ${f.subcategoria} ${f.productoId}`) &&
    (!ocultarCeros || hay(f) !== 0 || (esVenta && vendidoDe(f.productoId) > 0)))
  // Los «sin stock» (buffet): no están en el stock, solo en lo vendido.
  const soloVentas = esVenta ? vendido.filter((v) => v.depositoId === deposito.id && !filas.some((f) => f.productoId === v.productoId) && coincide(v.productoNombre)) : []

  const grupos = useMemo(() => {
    const orden = categorias.lista.map((c) => c.id)
    const m = new Map<string, StockFila[]>()
    for (const f of visibles) {
      const k = f.categoriaId ?? ''
      m.set(k, [...(m.get(k) ?? []), f])
    }
    return [...m.entries()].sort(([a], [b]) => (orden.indexOf(a) + 1 || 9999) - (orden.indexOf(b) + 1 || 9999))
  }, [visibles, categorias.lista])

  const usadas = categorias.lista.filter((c) => filas.some((f) => f.categoriaId === c.id))
  const columnas = esVenta ? 3 : 2

  return (
    <>
      <div className="filtros stk-filtros">
        <label className="campo">
          <span>Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {usadas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Buscar</span>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, subcategoría o código" />
        </label>
      </div>
      <label className="check stk-filtro">
        <input type="checkbox" checked={ocultarCeros} onChange={(e) => setOcultarCeros(e.target.checked)} />
        Ocultar los productos en 0
      </label>
      {grupos.length === 0 && soloVentas.length === 0 ? (
        <p className="suave">
          {palabras.length || categoria ? 'Ningún producto coincide con el filtro.' : `No hay nada en «${deposito.nombre}».`}
        </p>
      ) : (
        <table className="tabla stk-tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Hay</th>
              {esVenta && <th className="num">Vendido hoy</th>}
            </tr>
          </thead>
          <tbody>
            {grupos.map(([cat, lista]) => [
              <tr key={`g-${cat}`} className="stk-grupo"><th colSpan={columnas} scope="colgroup">{categorias.nombre(cat) || 'Otros'}</th></tr>,
              ...lista.map((f) => {
                const n = hay(f)
                const lotes = conLotes(f) ? f.lotes.filter((l) => hay(l) > 0) : []
                return (
                  <tr key={f.productoId} className={n === 0 ? 'apagado' : ''}>
                    <td>
                      {f.productoNombre}
                      {!f.activo && <span className="stk-desactivado">desactivado</span>}
                      {f.subcategoria && <div className="suave chico">{f.subcategoria}</div>}
                      {esVenta && n < 0 && <div className="chico stk-negativo">Se vendió más de lo que se cargó: faltan {-n} por cargar.</div>}
                      {lotes.length > 0 && (
                        <details className="stk-ver-lotes">
                          <summary>{lotes.length === 1 ? '1 lote' : `${lotes.length} lotes`}</summary>
                          <ul className="stk-lotes" aria-label={`Lotes de ${f.productoNombre}`}>
                            {lotes.map((l) => <li key={l.lote}><span>{l.lote}</span><strong>{hay(l)}</strong></li>)}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className={`num stk-total${n < 0 ? ' stk-negativo' : ''}`}>
                      {n}<span className="stk-unidad">{conUnidad(n, f.unidad).slice(String(n).length + 1)}</span>
                    </td>
                    {esVenta && <td className="num">{vendidoDe(f.productoId) || '—'}</td>}
                  </tr>
                )
              }),
            ])}
            {soloVentas.length > 0 && [
              <tr key="g-solo" className="stk-grupo"><th colSpan={columnas} scope="colgroup">Solo se registra lo vendido</th></tr>,
              ...soloVentas.map((v) => (
                <tr key={`v-${v.productoId}`}>
                  <td>{v.productoNombre}</td>
                  <td className="num suave">—</td>
                  <td className="num stk-total">{v.cantidad}</td>
                </tr>
              )),
            ]}
          </tbody>
        </table>
      )}
    </>
  )
}

/** Pasa de este depósito a otro. Por ejemplo, 20 chipas de «Frío» a «Venta frente». */
function Transferir({ desde, filas }: { desde: Deposito; filas: StockFila[] }) {
  const depositos = useDepositos()
  const sectores = useSectores()
  const [hacia, setHacia] = useState('')
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const registrar = useAccion((p: PedidoTransferencia) => post<Movimiento[]>('/transferencias', p))

  const hay = (f: { porDeposito: Record<string, number> }) => f.porDeposito[desde.id] ?? 0
  const conStock = filas.filter((f) => hay(f) > 0 || f.productoId === productoId)
  const destinos = depositos.lista.filter((d) => d.id !== desde.id)
  const fila = filas.find((f) => f.productoId === productoId)
  const conLotes = !!fila && (sectores.lista.find((s) => s.id === fila.sector)?.conLotes ?? false)
  const lotes = (fila?.lotes ?? []).filter((l) => hay(l) > 0)
  const disponible = !fila ? 0 : conLotes ? hay(lotes.find((l) => l.lote === lote) ?? { porDeposito: {} }) : hay(fila)

  const limpiar = () => {
    setAviso(null)
    setListo(null)
    registrar.limpiarError()
  }
  const elegirProducto = (id: string) => {
    limpiar()
    setProductoId(id)
    // Sugiere el lote más viejo: es el que conviene mover primero.
    setLote(filas.find((f) => f.productoId === id)?.lotes.find((l) => hay(l) > 0)?.lote ?? '')
  }

  const guardar = async () => {
    limpiar()
    if (!hacia) return setAviso('Elegí a qué depósito va.')
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote) return setAviso('Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá cuánto pasa.')
    if (cantidad > disponible) return setAviso(`Solo hay ${conUnidad(disponible, fila.unidad)} en «${desde.nombre}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await registrar.ejecutar({ productoId, lote: conLotes ? lote : null, cantidad, desde: desde.id, hacia })
    if (r) {
      setListo(`Listo: ${conUnidad(cantidad, fila.unidad)} de ${fila.productoNombre}${conLotes ? ` (lote ${lote})` : ''} pasaron de «${desde.nombre}» a «${depositos.nombre(hacia)}».`)
      setCantidad(0)
    }
  }

  if (!conStock.length && !listo) return null
  const error = aviso ?? registrar.error
  return (
    <>
      <h2>Transferir desde {desde.nombre}</h2>
      <div className="tarjeta">
        <p className="suave chico stk-ayuda">
          Pasá productos de «{desde.nombre}» a otro depósito. Por ejemplo, 20 chipas de un almacén en frío a «Venta frente».
          Para mandar a una sucursal usá <Link className="btn-discreto chico" to="/sector/envio">Envío a sucursal</Link>.
        </p>
        <label className="campo">
          <span>Hacia</span>
          <select value={hacia} onChange={(e) => { limpiar(); setHacia(e.target.value) }}>
            <option value="">Elegí el depósito</option>
            {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">Elegí un producto</option>
            {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({conUnidad(hay(f), f.unidad)})</option>)}
          </select>
        </label>
        {conLotes && (
          <label className="campo">
            <span>Lote</span>
            <select value={lote} onChange={(e) => { limpiar(); setLote(e.target.value) }}>
              <option value="">{lotes.length ? 'Elegí un lote' : 'Ningún lote con stock acá'}</option>
              {lotes.map((l, i) => <option key={l.lote} value={l.lote}>{l.lote} ({hay(l)}){i === 0 && lotes.length > 1 ? ' · el más viejo' : ''}</option>)}
            </select>
          </label>
        )}
        <Numero
          etiqueta={fila && (!conLotes || lote) ? `Cantidad (hay ${conUnidad(disponible, fila.unidad)})` : 'Cantidad'}
          valor={cantidad}
          onChange={(n) => { limpiar(); setCantidad(n) }}
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

const TIPOS: TipoAjuste[] = ['merma', 'vencimiento', 'ajuste', 'stock_inicial']
const MOTIVO_INICIAL = 'Stock existente al empezar a usar el sistema'
const RECIENTES = 10
const AYUDA: Record<TipoAjuste, string> = {
  merma: 'Resta del stock.',
  vencimiento: 'Resta del stock.',
  ajuste: 'Corrige el stock: suma o resta.',
  stock_inicial: 'Suma al stock lo que ya había.',
}
const EJEMPLO_MOTIVO: Record<TipoAjuste, string> = {
  merma: 'Ej.: se rompió la bolsa',
  vencimiento: 'Ej.: vencido el 08/10',
  ajuste: 'Ej.: conteo físico del viernes',
  stock_inicial: MOTIVO_INICIAL,
}

/** El administrador registra mermas, vencimientos, ajustes y stock inicial en este depósito, siempre con motivo. */
function AjusteStock({ deposito, filas }: { deposito: Deposito; filas: StockFila[] }) {
  const sectores = useSectores()
  const recientes = useConsulta<Movimiento[]>('/movimientos', { todos: 1, tipo: TIPOS.join(',') })
  const [tipo, setTipo] = useState<TipoAjuste>('merma')
  const [sentido, setSentido] = useState<1 | -1>(-1)
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const guardarAjuste = useAccion((p: PedidoAjuste) => post<Movimiento>('/ajustes', p))

  const signo = tipo === 'stock_inicial' ? 1 : tipo === 'ajuste' ? sentido : -1
  const fila = filas.find((f) => f.productoId === productoId)
  const conLotes = !!fila && (sectores.lista.find((s) => s.id === fila.sector)?.conLotes ?? false)
  const hay = (f: { porDeposito: Record<string, number> }) => f.porDeposito[deposito.id] ?? 0
  // Para restar se listan solo los productos y lotes con algo en este depósito.
  const opciones = signo > 0 ? filas : filas.filter((f) => hay(f) > 0 || f.productoId === productoId)
  const lotes = (fila?.lotes ?? []).filter((l) => signo > 0 || hay(l) > 0)
  const loteEscrito = conLotes && signo > 0
  const loteElegido = lotes.find((l) => l.lote === lote.trim().toUpperCase())
  const disponible = !fila ? 0 : conLotes ? (loteElegido ? hay(loteElegido) : 0) : hay(fila)
  const deEste = (recientes.datos ?? []).filter((m) => m.depositoId === deposito.id).slice(0, RECIENTES)

  const limpiar = () => {
    setAviso(null)
    setListo(null)
    guardarAjuste.limpiarError()
  }
  const elegirTipo = (t: TipoAjuste) => {
    limpiar()
    setTipo(t)
    setLote('')
    if (t === 'stock_inicial' && !motivo.trim()) setMotivo(MOTIVO_INICIAL)
    if (t !== 'stock_inicial' && motivo === MOTIVO_INICIAL) setMotivo('')
  }

  const guardar = async () => {
    limpiar()
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote.trim()) return setAviso(loteEscrito ? 'Escribí el lote.' : 'Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá una cantidad mayor que cero.')
    if (!motivo.trim()) return setAviso('Escribí el motivo.')
    if (signo < 0 && cantidad > disponible) return setAviso(`Solo hay ${conUnidad(disponible, fila.unidad)} en «${deposito.nombre}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await guardarAjuste.ejecutar({
      sector: fila.sector, productoId, tipo, cantidad, depositoId: deposito.id, motivo: motivo.trim(),
      ...(conLotes ? { lote: lote.trim() } : {}),
      ...(tipo === 'ajuste' ? { sentido } : {}),
    })
    if (r) {
      setListo(`Guardado: ${NOMBRE_TIPO_MOVIMIENTO[r.tipo].toLowerCase()} ${conSigno(r.cantidad)} de ${r.productoNombre}${r.lote ? ` (lote ${r.lote})` : ''} en «${deposito.nombre}».`)
      setCantidad(0)
      setLote('')
      setMotivo(tipo === 'stock_inicial' ? MOTIVO_INICIAL : '')
    }
  }

  const error = aviso ?? guardarAjuste.error
  return (
    <>
      <h2>Merma, vencimiento o ajuste en {deposito.nombre}</h2>
      <div className="tarjeta">
        <div className="segmentado stk-tipos" role="group" aria-label="Tipo">
          {TIPOS.map((t) => (
            <button key={t} type="button" className={tipo === t ? 'activo' : ''} aria-pressed={tipo === t} onClick={() => elegirTipo(t)}>
              {NOMBRE_TIPO_MOVIMIENTO[t]}
            </button>
          ))}
        </div>
        <p className="suave chico stk-ayuda">{AYUDA[tipo]}</p>
        {tipo === 'ajuste' && (
          <div className="segmentado" role="group" aria-label="Sentido del ajuste">
            <button type="button" className={sentido === 1 ? 'activo' : ''} aria-pressed={sentido === 1} onClick={() => { limpiar(); setSentido(1); setLote('') }}>Sumar (+)</button>
            <button type="button" className={sentido === -1 ? 'activo' : ''} aria-pressed={sentido === -1} onClick={() => { limpiar(); setSentido(-1); setLote('') }}>Restar (−)</button>
          </div>
        )}
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => { limpiar(); setProductoId(e.target.value); setLote('') }}>
            <option value="">{opciones.length ? 'Elegí un producto' : `No hay nada en «${deposito.nombre}» para restar`}</option>
            {opciones.map((f) => (
              <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({conUnidad(hay(f), f.unidad)}){f.activo ? '' : ' · desactivado'}</option>
            ))}
          </select>
        </label>
        {conLotes && (
          <label className="campo">
            <span>Lote{loteEscrito ? ' (escribí el código o elegí uno de la lista)' : ''}</span>
            {loteEscrito ? (
              <>
                <input
                  value={lote} onChange={(e) => { limpiar(); setLote(e.target.value) }} placeholder="Ej.: CH-261001-1"
                  list="stk-lotes-producto" autoCapitalize="characters" maxLength={40}
                />
                <datalist id="stk-lotes-producto">
                  {lotes.map((l) => <option key={l.lote} value={l.lote}>{hay(l)} acá</option>)}
                </datalist>
              </>
            ) : (
              <select value={lote} onChange={(e) => { limpiar(); setLote(e.target.value) }}>
                <option value="">{lotes.length ? 'Elegí un lote' : 'Este producto no tiene lotes acá'}</option>
                {lotes.map((l) => <option key={l.lote} value={l.lote}>{l.lote} ({hay(l)})</option>)}
              </select>
            )}
          </label>
        )}
        <Numero
          etiqueta={fila && signo < 0 && (!conLotes || lote) ? `Cantidad (hay ${conUnidad(disponible, fila.unidad)})` : 'Cantidad'}
          valor={cantidad}
          onChange={(n) => { limpiar(); setCantidad(n) }}
        />
        <label className="campo">
          <span>Motivo (obligatorio)</span>
          <input value={motivo} onChange={(e) => { limpiar(); setMotivo(e.target.value) }} placeholder={EJEMPLO_MOTIVO[tipo]} maxLength={300} />
        </label>
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{listo}</Aviso>
        <button className="btn-primario" onClick={() => void guardar()} disabled={guardarAjuste.enviando}>
          {guardarAjuste.enviando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {deEste.length > 0 && (
        <>
          <h2>Últimos ajustes en {deposito.nombre}</h2>
          <TablaMovimientos movimientos={deEste} />
          <p className="suave chico"><Link className="btn-discreto chico" to="/admin/historial">Ver todo en el historial</Link></p>
        </>
      )}
    </>
  )
}

/** Sucursales: lo que se les envió en el período (no tienen stock en el sistema). */
function Sucursales() {
  const hoy = diaPY()
  const [desde, setDesde] = useState(sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const puede = usePuede()
  const envios = useConsulta<EnvioResumen[]>('/envios', { desde, hasta })
  return (
    <>
      <div className="stk-cabeza">
        <div>
          <h2>Sucursales</h2>
          <p className="suave chico">De las sucursales solo se registra lo que se les envió; lo que venden ellas no entra en el sistema.</p>
        </div>
        {puede('stock.mover') && (
          <div className="stk-cabeza-acciones"><Link className="btn-secundario" to="/sector/envio">Nuevo envío</Link></div>
        )}
      </div>
      <div className="filtros stk-filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
      </div>
      <ConDatos consulta={envios}>
        {(lista) => {
          if (!lista.length) return <p className="suave">No hubo envíos a sucursales entre el {diaLegible(desde)} y el {diaLegible(hasta)}.</p>
          const porSucursal = new Map<string, EnvioResumen[]>()
          for (const e of lista) porSucursal.set(e.sucursalNombre, [...(porSucursal.get(e.sucursalNombre) ?? []), e])
          return (
            <table className="tabla stk-tabla">
              <thead><tr><th>Producto</th><th className="num">Enviado</th><th className="num">Último envío</th></tr></thead>
              <tbody>
                {[...porSucursal.entries()].map(([nombre, filas]) => [
                  <tr key={`g-${nombre}`} className="stk-grupo">
                    <th colSpan={3} scope="colgroup">{nombre} · {filas.reduce((s, f) => s + f.cantidad, 0)} en total</th>
                  </tr>,
                  ...filas.map((f) => (
                    <tr key={`${f.sucursalId}-${f.productoId}`}>
                      <td>{f.productoNombre}<div className="suave chico">{f.envios === 1 ? '1 envío' : `${f.envios} envíos`}</div></td>
                      <td className="num stk-total">{f.cantidad}</td>
                      <td className="num">{diaLegible(f.ultimo)}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          )
        }}
      </ConDatos>
    </>
  )
}

function EditarDeposito({ deposito, alCerrar }: { deposito: Deposito; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(deposito.nombre)
  const [descripcion, setDescripcion] = useState(deposito.descripcion)
  const guardar = useAccion((b: { nombre: string; descripcion: string }) => patch<Deposito>(`/depositos/${deposito.id}`, b))
  return (
    <Modal titulo={`Cambiar nombre de «${deposito.nombre}»`} alCerrar={alCerrar}>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} /></label>
      <label className="campo"><span>Descripción (opcional)</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} /></label>
      <Aviso>{guardar.error}</Aviso>
      <button className="btn-primario" disabled={guardar.enviando || !nombre.trim()} onClick={async () => {
        if (await guardar.ejecutar({ nombre: nombre.trim(), descripcion: descripcion.trim() })) alCerrar()
      }}>{guardar.enviando ? 'Guardando…' : 'Guardar'}</button>
    </Modal>
  )
}

function NuevoAlmacen({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (d: Deposito) => void }) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const crear = useAccion((b: { nombre: string; descripcion: string }) => post<Deposito>('/depositos', b))
  return (
    <Modal titulo="Nuevo almacén" alCerrar={alCerrar}>
      <p className="suave chico">Un almacén en frío más, por ejemplo «Cámara 2» o «Freezer del fondo». De acá se lleva a la venta o a las sucursales.</p>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Ej.: Cámara 2" autoFocus /></label>
      <label className="campo"><span>Descripción (opcional)</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} /></label>
      <Aviso>{crear.error}</Aviso>
      <button className="btn-primario" disabled={crear.enviando || !nombre.trim()} onClick={async () => {
        const d = await crear.ejecutar({ nombre: nombre.trim(), descripcion: descripcion.trim() })
        if (d) alCrear(d)
      }}>{crear.enviando ? 'Creando…' : 'Crear almacén'}</button>
    </Modal>
  )
}

function BorrarAlmacen({ deposito, alCerrar }: { deposito: Deposito; alCerrar: () => void }) {
  const borrar = useAccion(() => api(`/depositos/${deposito.id}`, { metodo: 'DELETE' }))
  return (
    <Modal titulo={`Borrar «${deposito.nombre}»`} alCerrar={alCerrar}>
      <p>
        El almacén tiene que estar vacío: si le queda algo, pasalo antes a otro depósito con «Transferir».
        Lo que pasó por acá sigue en el historial.
      </p>
      <Aviso>{borrar.error}</Aviso>
      <div className="stk-botones">
        <button className="btn-secundario" onClick={alCerrar} disabled={borrar.enviando}>Cancelar</button>
        <button className="btn-primario peligro" disabled={borrar.enviando} onClick={async () => {
          if (await borrar.ejecutar()) alCerrar()
        }}>{borrar.enviando ? 'Borrando…' : 'Sí, borrar'}</button>
      </div>
    </Modal>
  )
}
