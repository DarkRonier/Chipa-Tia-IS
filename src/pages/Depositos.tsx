// Depósitos (Mati, 2026-11-21, tercera vuelta). Arriba, los TIPOS de depósito; abajo, la lista de depósitos de ese
// tipo, y al tocar uno, lo que tiene:
//   - Venta directa: Venta frente y Venta comedor. Cada caja descuenta de su depósito; cada uno recibe solo los
//     productos de sus categorías (el administrador las elige). Muestra cuánto hay y cuánto se vendió hoy.
//   - Depósito frío: varios (Materia prima, cámaras, freezers…), cada uno con su stock. Si tiene una máquina vinculada
//     muestra su última temperatura y avisa si está fuera de rango.
//   - Sucursal: no tiene stock; se muestra solo lo que se le envió desde la matriz.
// El super-administrador crea y borra depósitos fríos y sucursales.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, patch, post } from '../cliente/api'
import { useCategorias, useDepositos, useSectores } from '../cliente/catalogo'
import { useAccion, useConsulta } from '../cliente/consultas'
import { useEsSuper, usePuede, useUsuario } from '../cliente/sesion'
import { normalizar } from '../components/Buscador'
import { Aviso, ConDatos } from '../components/Estado'
import Modal from '../components/Modal'
import Numero from '../components/Numero'
import { Flecha } from '../components/Volver'
import { diaLegible, diaPY, fechaHoraPY, sumarDias } from '../shared/hora'
import { sectorDeRol } from '../shared/permisos'
import {
  NOMBRE_ESTADO, NOMBRE_TIPO_DEPOSITO, NOMBRE_TIPO_MOVIMIENTO, type Categoria, type Deposito, type EnvioResumen, type Maquina,
  type Movimiento, type PedidoAjuste, type PedidoTransferencia, type StockFila, type Sucursal, type TipoAjuste, type TipoDeposito,
  type VendidoFila,
} from '../shared/tipos'
import { conSigno, TablaMovimientos } from './sector/Historial'
import '../styles/catalogos.css'
import '../styles/stock.css'

type Tipo = TipoDeposito | 'sucursal'
const TIPOS_DEPOSITO: Tipo[] = ['venta', 'almacen', 'sucursal']
const PLURAL: Record<Tipo, string> = { venta: 'Venta directa', almacen: 'Depósitos fríos', sucursal: 'Sucursales' }
const EXPLICACION: Record<Tipo, string> = {
  venta: 'Lo que está listo para vender. Cada caja descuenta de su depósito, y cada uno recibe solo los productos de sus categorías.',
  almacen: 'Donde se guarda: producción, materia prima, mercadería. Cada uno tiene su propio stock. Si tiene una máquina vinculada (heladera, freezer), se ve su última temperatura.',
  sucursal: 'Las sucursales no llevan stock en el sistema: solo se registra lo que se les envía desde la matriz.',
}
/** Una medición de más de 12 horas ya no dice cómo está la máquina ahora. */
const MEDICION_VIEJA_MS = 12 * 60 * 60 * 1000

/** «12 kg», «3 unidades», «1 docena». */
export function conUnidad(n: number, unidad: string) {
  const u = (unidad || 'unidades').trim()
  if (Math.abs(n) !== 1) return `${n} ${u}`
  const singular: Record<string, string> = { unidades: 'unidad', docenas: 'docena', litros: 'litro', paquetes: 'paquete', porciones: 'porción' }
  return `${n} ${singular[u] ?? u}`
}

const grados = (t: number) => `${t.toLocaleString('es-PY', { maximumFractionDigits: 1 })} °C`

/** «entre 1 y 5 °C», «−18 °C o menos», «63 °C o más». */
export function rangoTexto(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `entre ${min.toLocaleString('es-PY')} y ${grados(max)}`
  if (max !== null) return `${grados(max)} o menos`
  if (min !== null) return `${grados(min)} o más`
  return ''
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
export function hace(iso: string, ahora = Date.now()) {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

/** Cómo está la máquina de un depósito frío: sin máquina, sin medir, bien, vieja (hace mucho) o mal (fuera de rango o rota). */
export function estadoFrio(d: Deposito, ahora = Date.now()): 'sin_maquina' | 'sin_medir' | 'bien' | 'vieja' | 'mal' {
  if (!d.maquina) return 'sin_maquina'
  const u = d.maquina.ultima
  if (!u) return 'sin_medir'
  if (u.fueraDeRango || u.estado !== 'funciona') return 'mal'
  if (ahora - Date.parse(u.fecha) > MEDICION_VIEJA_MS) return 'vieja'
  return 'bien'
}

/** Si un depósito de venta recibe el producto (por su categoría; sin categoría cuenta como «Otros»). Los fríos reciben todo. */
function admite(d: Deposito, categoriaId: string | null, otros: string | undefined) {
  return d.tipo !== 'venta' || d.categorias.includes(categoriaId ?? otros ?? '')
}

export default function Depositos() {
  const [params, setParams] = useSearchParams()
  const depositos = useDepositos()
  const sucursales = useConsulta<Sucursal[]>('/sucursales')
  const stock = useConsulta<StockFila[]>('/stock', { todos: 1 })
  const esSuper = useEsSuper()
  const [creando, setCreando] = useState(false)
  const tipo = (TIPOS_DEPOSITO as string[]).includes(params.get('tipo') ?? '') ? params.get('tipo') as Tipo : 'venta'
  const ver = params.get('ver')
  const ir = (t: Tipo, id?: string) => setParams(id ? { tipo: t, ver: id } : { tipo: t })

  const cuantos = (t: Tipo) => t === 'sucursal' ? (sucursales.datos?.length ?? 0) : depositos.lista.filter((d) => d.tipo === t).length
  const alertas = depositos.lista.filter((d) => d.tipo === 'almacen' && estadoFrio(d) === 'mal').length

  return (
    <>
      <h1>Depósitos</h1>
      <div className="segmentado stk-tipos-deposito" role="tablist" aria-label="Tipo de depósito">
        {TIPOS_DEPOSITO.map((t) => (
          <button key={t} type="button" role="tab" className={tipo === t ? 'activo' : ''} aria-selected={tipo === t} onClick={() => ir(t)}>
            {PLURAL[t]} <span className="stk-cuenta">{cuantos(t)}</span>
            {t === 'almacen' && alertas > 0 && <span className="stk-alerta-punto" title="Hay una temperatura fuera de rango" aria-label="con alerta de temperatura" />}
          </button>
        ))}
      </div>
      <ConDatos consulta={depositos}>
        {(lista) => {
          if (ver && tipo === 'sucursal') {
            const s = sucursales.datos?.find((x) => x.id === ver)
            return (
              <>
                <VolverALista tipo={tipo} alVolver={() => ir(tipo)} />
                {s ? <SucursalElegida key={s.id} sucursal={s} alBorrar={() => ir(tipo)} /> : sucursales.datos && <p className="suave">Esa sucursal ya no existe.</p>}
              </>
            )
          }
          const elegido = ver ? lista.find((d) => d.id === ver) : undefined
          if (ver) {
            return (
              <>
                <VolverALista tipo={tipo} alVolver={() => ir(tipo)} />
                {elegido ? <DepositoElegido key={elegido.id} deposito={elegido} stock={stock} alBorrar={() => ir(tipo)} /> : <p className="suave">Ese depósito ya no existe.</p>}
              </>
            )
          }
          return (
            <>
              <p className="suave chico stk-explica">{EXPLICACION[tipo]}</p>
              {tipo === 'sucursal' ? (
                <ListaSucursales sucursales={sucursales.datos ?? []} alElegir={(id) => ir('sucursal', id)} alCrear={esSuper ? () => setCreando(true) : null} />
              ) : (
                <ListaDepositos
                  depositos={lista.filter((d) => d.tipo === tipo)} stock={stock.datos ?? []}
                  alElegir={(id) => ir(tipo, id)} alCrear={esSuper && tipo === 'almacen' ? () => setCreando(true) : null}
                />
              )}
              {creando && tipo === 'almacen' && <NuevoFrio alCerrar={() => setCreando(false)} alCrear={(d) => { setCreando(false); ir('almacen', d.id) }} />}
              {creando && tipo === 'sucursal' && <NuevaSucursal alCerrar={() => setCreando(false)} alCrear={(s) => { setCreando(false); ir('sucursal', s.id) }} />}
            </>
          )
        }}
      </ConDatos>
    </>
  )
}

function VolverALista({ tipo, alVolver }: { tipo: Tipo; alVolver: () => void }) {
  return (
    <button type="button" className="btn-discreto stk-volver" onClick={alVolver}>
      <Flecha /> {tipo === 'venta' ? 'Depósitos de venta directa' : PLURAL[tipo]}
    </button>
  )
}

/** Tarjetas de los depósitos de un tipo: nombre, cuántos productos tiene y, en los fríos, la temperatura. */
function ListaDepositos({ depositos, stock, alElegir, alCrear }: {
  depositos: Deposito[]; stock: StockFila[]; alElegir: (id: string) => void; alCrear: (() => void) | null
}) {
  const categorias = useCategorias()
  return (
    <ul className="stk-lista" aria-label="Depósitos">
      {depositos.map((d) => {
        const conStock = stock.filter((f) => (f.porDeposito[d.id] ?? 0) > 0).length
        return (
          <li key={d.id}>
            <button type="button" className="tarjeta stk-item" onClick={() => alElegir(d.id)}>
              <span className="stk-item-cabeza">
                <strong>{d.nombre}</strong>
                <Flecha derecha />
              </span>
              {d.descripcion && <span className="suave chico">{d.descripcion}</span>}
              <span className="chico">{conStock === 0 ? 'Vacío' : conStock === 1 ? '1 producto con stock' : `${conStock} productos con stock`}</span>
              {d.tipo === 'venta' && (
                <span className="suave chico">Recibe: {d.categorias.map((c) => categorias.nombre(c)).filter(Boolean).join(', ') || 'ninguna categoría'}</span>
              )}
              {d.tipo === 'almacen' && <ChipTemperatura deposito={d} />}
            </button>
          </li>
        )
      })}
      {alCrear && (
        <li>
          <button type="button" className="tarjeta stk-item stk-item-nuevo" onClick={alCrear}>+ Nuevo depósito frío</button>
        </li>
      )}
    </ul>
  )
}

/** En la tarjeta de un depósito frío: «Freezer 1 · −20 °C · hace 2 h», en rojo si está mal. */
function ChipTemperatura({ deposito }: { deposito: Deposito }) {
  const m = deposito.maquina
  const estado = estadoFrio(deposito)
  if (!m) return <span className="suave chico">Sin máquina vinculada</span>
  const u = m.ultima
  return (
    <span className={`stk-temp-chip stk-temp-${estado}`}>
      {m.nombre}
      {u ? <> · {u.temperatura !== null ? grados(u.temperatura) : NOMBRE_ESTADO[u.estado].toLowerCase()} · {hace(u.fecha)}</> : ' · sin medir'}
      {estado === 'mal' && ' · revisar'}
    </span>
  )
}

function ListaSucursales({ sucursales, alElegir, alCrear }: { sucursales: Sucursal[]; alElegir: (id: string) => void; alCrear: (() => void) | null }) {
  const hoy = diaPY()
  const envios = useConsulta<EnvioResumen[]>('/envios', { desde: sumarDias(hoy, -6), hasta: hoy })
  return (
    <ul className="stk-lista" aria-label="Sucursales">
      {sucursales.map((s) => {
        const de = (envios.datos ?? []).filter((e) => e.sucursalId === s.id)
        const total = de.reduce((n, e) => n + e.cantidad, 0)
        return (
          <li key={s.id}>
            <button type="button" className="tarjeta stk-item" onClick={() => alElegir(s.id)}>
              <span className="stk-item-cabeza"><strong>{s.nombre}</strong><Flecha derecha /></span>
              <span className="chico">{envios.datos ? (total ? `Últimos 7 días: ${total} enviados (${de.length === 1 ? '1 producto' : `${de.length} productos`})` : 'Sin envíos en los últimos 7 días') : ' '}</span>
            </button>
          </li>
        )
      })}
      {!sucursales.length && <li className="suave">No hay sucursales cargadas.</li>}
      {alCrear && (
        <li><button type="button" className="tarjeta stk-item stk-item-nuevo" onClick={alCrear}>+ Nueva sucursal</button></li>
      )}
    </ul>
  )
}

function DepositoElegido({ deposito, stock, alBorrar }: {
  deposito: Deposito; stock: ReturnType<typeof useConsulta<StockFila[]>>; alBorrar: () => void
}) {
  const u = useUsuario()
  const puede = usePuede()
  const esSuper = useEsSuper()
  const categorias = useCategorias()
  const esVenta = deposito.tipo === 'venta'
  const vendido = useConsulta<VendidoFila[]>(esVenta ? '/stock/vendido' : null)
  const [editando, setEditando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const miSector = sectorDeRol(u.rol)
  // Un sector transfiere lo que elabora y lo comprado de sus categorías habilitadas (la API dice cuáles son).
  const delSector = useConsulta<StockFila[]>(miSector && puede('stock.mover') ? '/stock' : null, { sector: miSector ?? undefined })
  const idsDelSector = new Set((delSector.datos ?? []).map((f) => f.productoId))

  return (
    <>
      <div className="stk-cabeza">
        <div>
          <h2>{deposito.nombre} <span className="etiqueta stk-tipo-etiqueta">{NOMBRE_TIPO_DEPOSITO[deposito.tipo]}</span></h2>
          {(deposito.descripcion || esVenta) && (
            <p className="suave chico">
              {deposito.descripcion}
              {esVenta && ' Se registra cuánto hay y cuánto se vende.'}
            </p>
          )}
          {esVenta && (
            <p className="chico stk-recibe">
              Recibe: {deposito.categorias.map((c) => categorias.nombre(c)).filter(Boolean).join(', ') || 'ninguna categoría todavía'}
            </p>
          )}
        </div>
        <div className="stk-cabeza-acciones">
          {puede('catalogos.editar') && <button type="button" className="btn-discreto" onClick={() => setEditando(true)}>Editar</button>}
          {esSuper && deposito.tipo === 'almacen' && !deposito.sistema && (
            <button type="button" className="btn-discreto rojo" onClick={() => setBorrando(true)}>Borrar depósito</button>
          )}
        </div>
      </div>
      {deposito.tipo === 'almacen' && deposito.maquina && <PanelTemperatura deposito={deposito} />}
      <ConDatos consulta={stock}>
        {(filas) => (
          <>
            <TablaDeposito deposito={deposito} filas={filas} vendido={vendido.datos ?? []} />
            {esVenta && (
              <p className="suave chico stk-ayuda">
                Lo que está en «{deposito.nombre}» ya está a la venta: de acá solo se vende o, si se perdió o venció, se registra como merma.
              </p>
            )}
            {puede('stock.mover') && !esVenta && (
              <Transferir
                key={deposito.id}
                desde={deposito}
                filas={filas.filter((f) => !miSector || idsDelSector.has(f.productoId))}
              />
            )}
            {puede('stock.ajustar') && <AjusteStock key={`a-${deposito.id}`} deposito={deposito} filas={filas} />}
          </>
        )}
      </ConDatos>
      {editando && <EditarDeposito deposito={deposito} alCerrar={() => setEditando(false)} />}
      {borrando && <BorrarDeposito deposito={deposito} alCerrar={() => setBorrando(false)} alBorrar={alBorrar} />}
    </>
  )
}

/** Última medición de la máquina vinculada y, si está mal, qué hacer. */
function PanelTemperatura({ deposito }: { deposito: Deposito }) {
  const puede = usePuede()
  const m = deposito.maquina!
  const u = m.ultima
  const estado = estadoFrio(deposito)
  const rango = rangoTexto(m.tempMin, m.tempMax)
  return (
    <div className={`tarjeta stk-temp stk-temp-${estado}`} role={estado === 'mal' ? 'alert' : undefined}>
      <div className="stk-temp-fila">
        <div>
          <div className="suave chico">Máquina vinculada</div>
          <strong>{m.nombre}</strong>
          {rango && <div className="suave chico">Tiene que estar {rango}</div>}
        </div>
        <div className="stk-temp-valor">
          {u ? (
            <>
              <strong>{u.temperatura !== null ? grados(u.temperatura) : '—'}</strong>
              <div className="suave chico">{fechaHoraPY(u.fecha)} ({hace(u.fecha)}){u.usuarioNombre && ` · ${u.usuarioNombre}`}</div>
            </>
          ) : <span className="suave">Sin mediciones</span>}
        </div>
      </div>
      {estado === 'mal' && u && (
        <p className="stk-temp-aviso">
          {u.fueraDeRango
            ? <>La última temperatura está fuera de rango ({u.temperatura !== null ? grados(u.temperatura) : '—'}; tiene que estar {rango}). </>
            : <>La máquina quedó como «{NOMBRE_ESTADO[u.estado].toLowerCase()}». </>}
          <strong>Revisá la máquina o retirá los productos perecederos</strong> y pasalos a otro depósito con «Transferir».
        </p>
      )}
      {estado === 'vieja' && <p className="stk-temp-nota">La última medición es de {hace(u!.fecha)}: conviene medir de nuevo.</p>}
      {estado === 'sin_medir' && <p className="stk-temp-nota">Todavía no se cargó ninguna medición de esta máquina.</p>}
      {puede('maquinas.lectura') && (estado !== 'bien') && (
        <Link className="btn-discreto chico" to="/sector/maquinas">Cargar una medición</Link>
      )}
    </div>
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
  const otros = categorias.lista.find((c) => c.sistema)?.id
  const conLotes = (f: StockFila) => sectores.lista.find((s) => s.id === f.sector)?.conLotes ?? false
  const hay = (f: { porDeposito: Record<string, number> }) => f.porDeposito[deposito.id] ?? 0
  const corresponde = (f: StockFila) => admite(deposito, f.categoriaId, otros)
  const vendidoDe = (id: string) => vendido.find((v) => v.productoId === id && v.depositoId === deposito.id)?.cantidad ?? 0

  const palabras = normalizar(buscar).split(/\s+/).filter(Boolean)
  const coincide = (texto: string) => palabras.every((p) => normalizar(texto).includes(p))
  const visibles = filas.filter((f) =>
    (corresponde(f) || hay(f) !== 0) &&
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

  const usadas = categorias.lista.filter((c) => filas.some((f) => f.categoriaId === c.id && (corresponde(f) || hay(f) !== 0)))
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
                      {!corresponde(f) && <div className="chico stk-negativo">Su categoría no va en este depósito.</div>}
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
  const fila = filas.find((f) => f.productoId === productoId)
  // Transferir es solo de un frío a otro frío (Mati, 2026-11-23). A la venta: «Sacar para la venta»; a una sucursal: «Envío a sucursal».
  const destinos = depositos.almacenes.filter((d) => d.id !== desde.id)
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
    if (!fila) return setAviso('Elegí el producto.')
    if (!hacia || !destinos.some((d) => d.id === hacia)) return setAviso('Elegí a qué depósito va.')
    if (conLotes && !lote) return setAviso('Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá cuánto pasa.')
    if (cantidad > disponible) return setAviso(`Solo hay ${conUnidad(disponible, fila.unidad)} en «${desde.nombre}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await registrar.ejecutar({ productoId, lote: conLotes ? lote : null, cantidad, desde: desde.id, hacia })
    if (r) {
      setListo(`Listo: ${conUnidad(cantidad, fila.unidad)} de ${fila.productoNombre}${conLotes ? ` (lote ${lote})` : ''} pasaron de «${desde.nombre}» a «${depositos.nombre(hacia)}».`)
      setCantidad(0)
    }
  }

  if ((!conStock.length || !destinos.length) && !listo) return null
  const error = aviso ?? registrar.error
  return (
    <>
      <h2>Transferir desde {desde.nombre}</h2>
      <div className="tarjeta">
        <p className="suave chico stk-ayuda">
          Pasá productos de «{desde.nombre}» a otro depósito frío. Por ejemplo, 20 chipas de «Cámara 1» a «Cámara 2».
          Para ponerlos a la venta usá <Link className="btn-discreto chico" to="/sector/salida">Sacar para la venta</Link>;
          para mandarlos a una sucursal, <Link className="btn-discreto chico" to="/sector/envio">Envío a sucursal</Link>.
        </p>
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">Elegí un producto</option>
            {conStock.map((f) => <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({conUnidad(hay(f), f.unidad)})</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Hacia</span>
          <select value={hacia} onChange={(e) => { limpiar(); setHacia(e.target.value) }}>
            <option value="">Elegí el depósito</option>
            {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
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

/** Una sucursal: lo que se le envió en el período (no tiene stock en el sistema). */
function SucursalElegida({ sucursal, alBorrar }: { sucursal: Sucursal; alBorrar: () => void }) {
  const hoy = diaPY()
  const [desde, setDesde] = useState(sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const puede = usePuede()
  const esSuper = useEsSuper()
  const [editando, setEditando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const envios = useConsulta<EnvioResumen[]>('/envios', { desde, hasta })
  return (
    <>
      <div className="stk-cabeza">
        <div>
          <h2>{sucursal.nombre} <span className="etiqueta stk-tipo-etiqueta">Sucursal</span></h2>
          <p className="suave chico">De las sucursales solo se registra lo que se les envía; lo que venden ellas no entra en el sistema.</p>
        </div>
        <div className="stk-cabeza-acciones">
          {puede('stock.mover') && <Link className="btn-secundario" to="/sector/envio">Nuevo envío</Link>}
          {puede('catalogos.editar') && <button type="button" className="btn-discreto" onClick={() => setEditando(true)}>Cambiar nombre</button>}
          {esSuper && <button type="button" className="btn-discreto rojo" onClick={() => setBorrando(true)}>Borrar sucursal</button>}
        </div>
      </div>
      <div className="filtros stk-filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
      </div>
      <ConDatos consulta={envios}>
        {(lista) => {
          const filas = lista.filter((e) => e.sucursalId === sucursal.id)
          if (!filas.length) return <p className="suave">No hubo envíos a {sucursal.nombre} entre el {diaLegible(desde)} y el {diaLegible(hasta)}.</p>
          return (
            <table className="tabla stk-tabla">
              <thead><tr><th>Producto</th><th className="num">Enviado</th><th className="num">Último envío</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.productoId}>
                    <td>{f.productoNombre}<div className="suave chico">{f.envios === 1 ? '1 envío' : `${f.envios} envíos`}</div></td>
                    <td className="num stk-total">{f.cantidad}</td>
                    <td className="num">{diaLegible(f.ultimo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th>Total</th><th className="num">{filas.reduce((s, f) => s + f.cantidad, 0)}</th><th /></tr></tfoot>
            </table>
          )
        }}
      </ConDatos>
      {editando && <RenombrarSucursal sucursal={sucursal} alCerrar={() => setEditando(false)} />}
      {borrando && <BorrarSucursal sucursal={sucursal} alCerrar={() => setBorrando(false)} alBorrar={alBorrar} />}
    </>
  )
}

function EditarDeposito({ deposito, alCerrar }: { deposito: Deposito; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(deposito.nombre)
  const [descripcion, setDescripcion] = useState(deposito.descripcion)
  const [maquinaId, setMaquinaId] = useState(deposito.maquina?.id ?? '')
  const [cats, setCats] = useState<string[]>(deposito.categorias)
  const categorias = useCategorias()
  const esVenta = deposito.tipo === 'venta'
  const guardar = useAccion((b: object) => patch<Deposito>(`/depositos/${deposito.id}`, b))
  const alternar = (id: string) => setCats((x) => x.includes(id) ? x.filter((c) => c !== id) : [...x, id])
  return (
    <Modal titulo={`Editar «${deposito.nombre}»`} alCerrar={alCerrar}>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} /></label>
      <label className="campo"><span>Descripción (opcional)</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} /></label>
      {deposito.tipo === 'almacen' && <ElegirMaquina valor={maquinaId} onChange={setMaquinaId} />}
      {esVenta && <ElegirCategorias lista={categorias.lista} elegidas={cats} alternar={alternar} />}
      <Aviso>{guardar.error}</Aviso>
      <button className="btn-primario" disabled={guardar.enviando || !nombre.trim()} onClick={async () => {
        const b: Record<string, unknown> = { nombre: nombre.trim(), descripcion: descripcion.trim() }
        if (deposito.tipo === 'almacen') b.maquinaId = maquinaId || null
        if (esVenta) b.categorias = cats
        if (await guardar.ejecutar(b)) alCerrar()
      }}>{guardar.enviando ? 'Guardando…' : 'Guardar'}</button>
    </Modal>
  )
}

/** Máquina para ver la temperatura de un depósito frío (opcional: un depósito frío no tiene por qué tener una). */
function ElegirMaquina({ valor, onChange }: { valor: string; onChange: (id: string) => void }) {
  const maquinas = useConsulta<Maquina[]>('/maquinas')
  const sectores = useSectores()
  // Primero las que miden temperatura (heladeras, freezers, exhibidoras frías).
  const lista = [...(maquinas.datos ?? [])].sort((a, b) => Number(b.tempMin !== null || b.tempMax !== null) - Number(a.tempMin !== null || a.tempMax !== null))
  return (
    <label className="campo">
      <span>Máquina vinculada (opcional)</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Ninguna</option>
        {lista.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nombre} · {sectores.nombre(m.sector)}{m.tempMin !== null || m.tempMax !== null ? ` (${rangoTexto(m.tempMin, m.tempMax)})` : ''}
          </option>
        ))}
      </select>
      <small className="suave">Si tiene una, al abrir el depósito se ve la última temperatura medida y un aviso si está fuera de rango.</small>
    </label>
  )
}

function ElegirCategorias({ lista, elegidas, alternar }: { lista: Categoria[]; elegidas: string[]; alternar: (id: string) => void }) {
  return (
    <fieldset className="campo stk-categorias">
      <legend>Categorías que recibe</legend>
      <small className="suave">Solo los productos de estas categorías se pueden pasar a este depósito. Por ejemplo, el buffet va a Venta comedor.</small>
      {lista.filter((c) => c.activo || elegidas.includes(c.id)).map((c) => (
        <label key={c.id} className="check">
          <input type="checkbox" checked={elegidas.includes(c.id)} onChange={() => alternar(c.id)} />
          {c.nombre}
        </label>
      ))}
    </fieldset>
  )
}

function NuevoFrio({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (d: Deposito) => void }) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [maquinaId, setMaquinaId] = useState('')
  const crear = useAccion((b: object) => post<Deposito>('/depositos', b))
  return (
    <Modal titulo="Nuevo depósito frío" alCerrar={alCerrar}>
      <p className="suave chico">Un lugar más donde guardar, con su propio stock: por ejemplo «Cámara 2», «Freezer del fondo» o «Depósito seco».</p>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Ej.: Cámara 2" autoFocus /></label>
      <label className="campo"><span>Descripción (opcional)</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} /></label>
      <ElegirMaquina valor={maquinaId} onChange={setMaquinaId} />
      <Aviso>{crear.error}</Aviso>
      <button className="btn-primario" disabled={crear.enviando || !nombre.trim()} onClick={async () => {
        const d = await crear.ejecutar({ nombre: nombre.trim(), descripcion: descripcion.trim(), maquinaId: maquinaId || null })
        if (d) alCrear(d)
      }}>{crear.enviando ? 'Creando…' : 'Crear depósito'}</button>
    </Modal>
  )
}

function BorrarDeposito({ deposito, alCerrar, alBorrar }: { deposito: Deposito; alCerrar: () => void; alBorrar: () => void }) {
  const borrar = useAccion(() => api(`/depositos/${deposito.id}`, { metodo: 'DELETE' }))
  return (
    <Modal titulo={`Borrar «${deposito.nombre}»`} alCerrar={alCerrar}>
      <p>
        El depósito tiene que estar vacío: si le queda algo, pasalo antes a otro con «Transferir».
        Lo que pasó por acá sigue en el historial.
      </p>
      <Aviso>{borrar.error}</Aviso>
      <div className="stk-botones">
        <button className="btn-secundario" onClick={alCerrar} disabled={borrar.enviando}>Cancelar</button>
        <button className="btn-primario peligro" disabled={borrar.enviando} onClick={async () => {
          if (await borrar.ejecutar()) { alCerrar(); alBorrar() }
        }}>{borrar.enviando ? 'Borrando…' : 'Sí, borrar'}</button>
      </div>
    </Modal>
  )
}

function NuevaSucursal({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (s: Sucursal) => void }) {
  const [nombre, setNombre] = useState('')
  const crear = useAccion((b: { nombre: string }) => post<Sucursal>('/sucursales', b))
  return (
    <Modal titulo="Nueva sucursal" alCerrar={alCerrar}>
      <p className="suave chico">Aparece como destino en «Envío a sucursal». No lleva stock: solo se registra lo que se le manda.</p>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} placeholder="Ej.: Sucursal Luque" autoFocus /></label>
      <Aviso>{crear.error}</Aviso>
      <button className="btn-primario" disabled={crear.enviando || !nombre.trim()} onClick={async () => {
        const s = await crear.ejecutar({ nombre: nombre.trim() })
        if (s) alCrear(s)
      }}>{crear.enviando ? 'Creando…' : 'Crear sucursal'}</button>
    </Modal>
  )
}

function RenombrarSucursal({ sucursal, alCerrar }: { sucursal: Sucursal; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(sucursal.nombre)
  const guardar = useAccion((b: { nombre: string }) => patch<Sucursal>(`/sucursales/${sucursal.id}`, b))
  return (
    <Modal titulo={`Cambiar nombre de «${sucursal.nombre}»`} alCerrar={alCerrar}>
      <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} /></label>
      <Aviso>{guardar.error}</Aviso>
      <button className="btn-primario" disabled={guardar.enviando || !nombre.trim()} onClick={async () => {
        if (await guardar.ejecutar({ nombre: nombre.trim() })) alCerrar()
      }}>{guardar.enviando ? 'Guardando…' : 'Guardar'}</button>
    </Modal>
  )
}

function BorrarSucursal({ sucursal, alCerrar, alBorrar }: { sucursal: Sucursal; alCerrar: () => void; alBorrar: () => void }) {
  const borrar = useAccion(() => api(`/sucursales/${sucursal.id}`, { metodo: 'DELETE' }))
  return (
    <Modal titulo={`Borrar «${sucursal.nombre}»`} alCerrar={alCerrar}>
      <p>Deja de aparecer como destino de los envíos. Lo que ya se le envió sigue en el historial y en la trazabilidad.</p>
      <Aviso>{borrar.error}</Aviso>
      <div className="stk-botones">
        <button className="btn-secundario" onClick={alCerrar} disabled={borrar.enviando}>Cancelar</button>
        <button className="btn-primario peligro" disabled={borrar.enviando} onClick={async () => {
          if (await borrar.ejecutar()) { alCerrar(); alBorrar() }
        }}>{borrar.enviando ? 'Borrando…' : 'Sí, borrar'}</button>
      </div>
    </Modal>
  )
}
