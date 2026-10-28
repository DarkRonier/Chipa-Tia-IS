// E06: trazabilidad de Chipería. Desde un lote de materia prima hasta las sucursales donde terminó,
// desde un lote de chipa (de qué materia prima salió y adónde fue) y desde una sucursal de vuelta a la
// materia prima. Acepta ?mp=, ?lote= y ?sucursal= (con ?desde= y ?hasta=) para que otras pantallas enlacen acá.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useConsulta } from '../../cliente/consultas'
import { useUsuario } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { IconoTrazabilidad } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaLegible, diaPY, fechaHoraPY, sumarDias } from '../../shared/hora'
import {
  NOMBRE_TIPO_MOVIMIENTO,
  type LoteChipa, type LoteMP, type Movimiento, type Sucursal,
  type TrazabilidadLote, type TrazabilidadMP, type TrazabilidadSucursal,
} from '../../shared/tipos'
import { cantidadMP, enlaceTrazaLote, enlaceTrazaMP, EstadoLoteMP, vencido } from './Lotes'
import '../../styles/lotes.css'

type Modo = 'mp' | 'lote' | 'sucursal'
const MODOS: { id: Modo; nombre: string }[] = [
  { id: 'mp', nombre: 'Materia prima' },
  { id: 'lote', nombre: 'Lote de chipa' },
  { id: 'sucursal', nombre: 'Sucursal' },
]

const enlaceSucursal = (id: string | null) => `/trazabilidad?sucursal=${encodeURIComponent(id ?? '')}`
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export default function Trazabilidad() {
  const usuario = useUsuario()
  const esAdmin = usuario.rol === 'admin'
  return (
    <>
      <Volver titulo="Trazabilidad" a={esAdmin ? '/admin' : '/sector'} icono={<IconoTrazabilidad />} />
      {esAdmin || usuario.rol === 'chiperia' ? <PantallaTrazabilidad /> : <Aviso>Los lotes y la trazabilidad son solo de Chipería.</Aviso>}
    </>
  )
}

function PantallaTrazabilidad() {
  const [params, setParams] = useSearchParams()
  const mp = params.get('mp') ?? ''
  const lote = params.get('lote') ?? ''
  const sucursal = params.get('sucursal') ?? ''
  const pedido = params.get('modo')
  const modo: Modo = params.has('mp') ? 'mp'
    : params.has('lote') ? 'lote'
    : params.has('sucursal') ? 'sucursal'
    : MODOS.some((m) => m.id === pedido) ? (pedido as Modo) : 'mp'

  // Al seguir un enlace de la cadena (otro lote, otra sucursal), arrancar arriba.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [mp, lote, sucursal])

  const fijar = (valores: Record<string, string>) =>
    setParams(Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== '')), { replace: true })

  return (
    <>
      <div className="segmentado lot-modos" role="group" aria-label="Buscar desde">
        {MODOS.map((m) => (
          <button key={m.id} type="button" className={modo === m.id ? 'activo' : ''} aria-pressed={modo === m.id}
            onClick={() => modo !== m.id && fijar({ modo: m.id })}>
            {m.nombre}
          </button>
        ))}
      </div>
      {modo === 'mp' && <DesdeMP id={mp} elegir={(id) => fijar(id ? { mp: id } : { modo: 'mp' })} />}
      {modo === 'lote' && <DesdeLote codigo={lote} buscar={(c) => fijar(c ? { lote: c } : { modo: 'lote' })} />}
      {modo === 'sucursal' && (
        <DesdeSucursal
          id={sucursal}
          desde={params.get('desde') ?? ''}
          hasta={params.get('hasta') ?? ''}
          elegir={(v) => fijar(v.sucursal ? { sucursal: v.sucursal, desde: v.desde, hasta: v.hasta } : { modo: 'sucursal' })}
        />
      )}
    </>
  )
}

// ---------- Piezas de la cadena ----------

function ListaEnvios({ envios, conSucursal = true }: { envios: Movimiento[]; conSucursal?: boolean }) {
  return (
    <ul className="lot-envios">
      {envios.map((m) => (
        <li key={m.id}>
          <span>
            {conSucursal && <><Link to={enlaceSucursal(m.sucursalId)}>{m.sucursalNombre ?? 'Sucursal'}</Link><br /></>}
            <span className="suave chico">{fechaHoraPY(m.fecha)} · {m.productoNombre}</span>
          </span>
          <span className="cant">{-m.cantidad}</span>
        </li>
      ))}
    </ul>
  )
}

/** Total enviado a cada sucursal, la que más recibió primero. */
function porSucursal(envios: Movimiento[]) {
  const m = new Map<string, { id: string; nombre: string; total: number }>()
  for (const e of envios) {
    const id = e.sucursalId ?? ''
    const fila = m.get(id) ?? { id, nombre: e.sucursalNombre ?? 'Sucursal', total: 0 }
    fila.total += -e.cantidad
    m.set(id, fila)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre))
}

function Destinos({ envios }: { envios: Movimiento[] }) {
  return (
    <div className="lot-destinos">
      {porSucursal(envios).map((d) => (
        <Link key={d.id} className="chip" to={enlaceSucursal(d.id)}>{d.nombre}<strong>{d.total}</strong></Link>
      ))}
    </div>
  )
}

function Cifras({ lote }: { lote: LoteChipa }) {
  return (
    <div className="lot-cifras">
      <span>Horno <strong>{lote.horno}</strong></span>
      <span>Congelador <strong>{lote.congelador}</strong></span>
      <span>Queda <strong>{lote.stock}</strong></span>
    </div>
  )
}

const datosLote = (l: LoteChipa) => (l.produccionId ? `${diaLegible(l.dia)} · amasada ${l.amasada}` : `desde ${diaLegible(l.dia)} · sin registro de producción`)

function MateriaPrimaDe({ lote }: { lote: Pick<LoteChipa, 'lotesMP'> }) {
  if (!lote.lotesMP.length) return <p className="suave chico">Sin materia prima registrada.</p>
  return (
    <ul className="lot-lista-mp">
      {lote.lotesMP.map((mp) => <li key={mp.id}><Link to={enlaceTrazaMP(mp.id)}>{mp.descripcion}</Link></li>)}
    </ul>
  )
}

// ---------- Desde un lote de materia prima (hacia adelante) ----------

function nombreOpcion(l: LoteMP) {
  if (l.disponible) return l.descripcion
  return `${l.descripcion} (${[vencido(l) && 'vencido', l.bloqueado && 'bloqueado'].filter(Boolean).join(', ')})`
}

function DesdeMP({ id, elegir }: { id: string; elegir: (id: string) => void }) {
  const lotes = useConsulta<LoteMP[]>('/lotes-mp')
  const traza = useConsulta<TrazabilidadMP>(id ? `/trazabilidad/mp/${encodeURIComponent(id)}` : null)
  const lista = lotes.datos ?? []
  return (
    <>
      <label className="campo">
        <span>Lote de materia prima</span>
        <select value={id} onChange={(e) => elegir(e.target.value)} disabled={!lotes.datos && !lotes.error}>
          <option value="">{lotes.datos ? (lista.length ? 'Elegí un lote…' : 'Todavía no hay lotes cargados') : 'Cargando…'}</option>
          {id && lotes.datos && !lista.some((l) => l.id === id) && <option value={id}>Lote {id}</option>}
          {lista.map((l) => <option key={l.id} value={l.id}>{nombreOpcion(l)}</option>)}
        </select>
      </label>
      <Aviso>{lotes.error}</Aviso>
      {id && (
        <ConDatos consulta={traza}>{(t) => <CadenaMP t={t} />}</ConDatos>
      )}
    </>
  )
}

function CadenaMP({ t }: { t: TrazabilidadMP }) {
  const l = t.loteMP
  return (
    <div className="lot-cadena">
      <section className="tarjeta lot-paso principal" aria-label="Lote de materia prima">
        <p className="lot-titulo-seccion">Materia prima</p>
        <div className="lot-cabeza"><h3>{l.descripcion}</h3><EstadoLoteMP lote={l} /></div>
        <div className="lot-cifras">
          <span><strong>{cantidadMP(l)}</strong></span>
          <span>ingresó {diaLegible(l.fechaIngreso)}</span>
          <span>vence {diaLegible(l.vencimiento)}</span>
        </div>
      </section>
      <div className="lot-flecha">Se usó en {plural(t.lotesChipa.length, 'lote de chipa', 'lotes de chipa')}</div>
      {t.lotesChipa.length === 0 ? (
        <p className="lot-vacio">Este lote todavía no se usó en ninguna amasada.</p>
      ) : (
        <>
          <div className="lot-grupo">
            {t.lotesChipa.map((lc) => {
              const envios = t.envios.filter((m) => m.lote === lc.codigo)
              return (
                <section key={lc.id} className="tarjeta lot-paso" aria-label={`Lote de chipa ${lc.codigo}`}>
                  <div className="lot-cabeza">
                    <Link className="lot-codigo" to={enlaceTrazaLote(lc.codigo)}>Lote {lc.codigo}</Link>
                    <span className="suave chico">{datosLote(lc)}</span>
                  </div>
                  <Cifras lote={lc} />
                  {envios.length ? <ListaEnvios envios={envios} /> : <p className="suave chico">Sin envíos a sucursales todavía.</p>}
                </section>
              )
            })}
          </div>
          <div className="lot-flecha">
            {t.envios.length ? `Llegó a ${plural(porSucursal(t.envios).length, 'sucursal', 'sucursales')}` : 'Todavía no llegó a ninguna sucursal'}
          </div>
          {t.envios.length > 0 && <Destinos envios={t.envios} />}
        </>
      )}
    </div>
  )
}

// ---------- Desde un lote de chipa ----------

function DesdeLote({ codigo, buscar }: { codigo: string; buscar: (c: string) => void }) {
  const [texto, setTexto] = useState(codigo)
  useEffect(() => setTexto(codigo), [codigo])
  const recientes = useConsulta<LoteChipa[]>('/lotes-chipa', { desde: sumarDias(diaPY(), -30) })
  const traza = useConsulta<TrazabilidadLote>(codigo ? `/trazabilidad/lote/${encodeURIComponent(codigo)}` : null)
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    buscar(texto.trim())
  }
  const ultimos = (recientes.datos ?? []).slice(0, 8)
  return (
    <>
      <form className="lot-buscar" onSubmit={enviar}>
        <label className="campo">
          <span>Código del lote de chipa</span>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: CH-261010-1" list="lot-codigos"
            autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <datalist id="lot-codigos">{(recientes.datos ?? []).map((l) => <option key={l.id} value={l.codigo} />)}</datalist>
        </label>
        <button className="btn-primario" type="submit" disabled={!texto.trim()}>Buscar</button>
      </form>
      {ultimos.length > 0 && (
        <div className="chips lot-recientes" role="group" aria-label="Lotes recientes">
          {ultimos.map((l) => (
            <button key={l.id} type="button" className={`chip${l.codigo === codigo ? ' activo' : ''}`} onClick={() => buscar(l.codigo)}>{l.codigo}</button>
          ))}
        </div>
      )}
      {codigo && (
        <ConDatos consulta={traza}>{(t) => <CadenaLote t={t} />}</ConDatos>
      )}
    </>
  )
}

function CadenaLote({ t }: { t: TrazabilidadLote }) {
  const { lote, produccion } = t
  return (
    <div className="lot-cadena">
      <section className="tarjeta lot-paso" aria-label="Materia prima usada">
        <p className="lot-titulo-seccion">Materia prima usada</p>
        <MateriaPrimaDe lote={lote} />
      </section>
      <div className="lot-flecha">Con eso se hizo</div>
      <section className="tarjeta lot-paso principal" aria-label={`Lote de chipa ${lote.codigo}`}>
        <div className="lot-cabeza">
          <h3 className="lot-codigo">Lote {lote.codigo}</h3>
          <span className="suave chico">{datosLote(lote)}</span>
        </div>
        {produccion && (
          <>
            <p className="suave chico">
              Registrado el {fechaHoraPY(produccion.fecha)} por {produccion.usuarioNombre} · turno {produccion.turno === 'dia' ? 'día' : 'noche'}
              {produccion.corregidoEn && ` · corregido por ${produccion.corregidoPorNombre ?? 'el administrador'} el ${fechaHoraPY(produccion.corregidoEn)}`}
            </p>
            <table className="tabla">
              <thead><tr><th>Producto</th><th className="num">Horno</th><th className="num">Congelador</th></tr></thead>
              <tbody>
                {produccion.items.map((i) => (
                  <tr key={i.productoId}><td>{i.productoNombre}</td><td className="num">{i.cocinado}</td><td className="num">{i.guardado}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <Cifras lote={lote} />
      </section>
      <div className="lot-flecha">
        {t.envios.length ? `Se envió a ${plural(porSucursal(t.envios).length, 'sucursal', 'sucursales')}` : 'Todavía no se envió a ninguna sucursal'}
      </div>
      {t.envios.length > 0 && (
        <section className="tarjeta lot-paso" aria-label="Envíos a sucursales">
          <Destinos envios={t.envios} />
          <ListaEnvios envios={t.envios} />
        </section>
      )}
      {t.otrosMovimientos.length > 0 && (
        <>
          <h2>Otros movimientos del lote</h2>
          <section className="tarjeta" aria-label="Otros movimientos del lote">
            <ul className="lot-envios">
              {t.otrosMovimientos.map((m) => (
                <li key={m.id}>
                  <span>
                    {NOMBRE_TIPO_MOVIMIENTO[m.tipo]}{m.motivo ? `: ${m.motivo}` : ''}<br />
                    <span className="suave chico">{fechaHoraPY(m.fecha)} · {m.productoNombre} · {m.usuarioNombre}</span>
                  </span>
                  <span className="cant">{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

// ---------- Desde una sucursal (hacia atrás) ----------

function DesdeSucursal({ id, desde, hasta, elegir }: {
  id: string; desde: string; hasta: string
  elegir: (v: { sucursal: string; desde: string; hasta: string }) => void
}) {
  const sucursales = useConsulta<Sucursal[]>('/sucursales', { todos: true })
  const traza = useConsulta<TrazabilidadSucursal>(id ? `/trazabilidad/sucursal/${encodeURIComponent(id)}` : null, { desde, hasta })
  const lista = sucursales.datos ?? []
  return (
    <>
      <label className="campo">
        <span>Sucursal</span>
        <select value={id} onChange={(e) => elegir({ sucursal: e.target.value, desde, hasta })} disabled={!sucursales.datos && !sucursales.error}>
          <option value="">{sucursales.datos ? 'Elegí una sucursal…' : 'Cargando…'}</option>
          {id && sucursales.datos && !lista.some((s) => s.id === id) && <option value={id}>{id}</option>}
          {lista.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.activo ? '' : ' (desactivada)'}</option>)}
        </select>
      </label>
      <Aviso>{sucursales.error}</Aviso>
      <div className="lot-fechas">
        <label className="campo">
          <span>Desde <span className="lot-opcional">(opcional)</span></span>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => elegir({ sucursal: id, desde: e.target.value, hasta })} disabled={!id} />
        </label>
        <label className="campo">
          <span>Hasta <span className="lot-opcional">(opcional)</span></span>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => elegir({ sucursal: id, desde, hasta: e.target.value })} disabled={!id} />
        </label>
      </div>
      {id && (
        <ConDatos consulta={traza}>{(t) => <CadenaSucursal t={t} conFechas={!!(desde || hasta)} />}</ConDatos>
      )}
    </>
  )
}

function CadenaSucursal({ t, conFechas }: { t: TrazabilidadSucursal; conFechas: boolean }) {
  const total = t.envios.reduce((s, m) => s - m.cantidad, 0)
  // Envíos agrupados por lote, el lote del envío más nuevo primero.
  const grupos = new Map<string, Movimiento[]>()
  for (const m of t.envios) {
    const k = m.lote ?? ''
    grupos.set(k, [...(grupos.get(k) ?? []), m])
  }
  return (
    <div className="lot-cadena">
      <section className="tarjeta lot-paso principal" aria-label="Sucursal">
        <p className="lot-titulo-seccion">Sucursal</p>
        <div className="lot-cabeza">
          <h3>{t.sucursal.nombre}</h3>
          {!t.sucursal.activo && <span className="lot-estado bloqueado">Desactivada</span>}
        </div>
        <div className="lot-cifras">
          <span>Recibió <strong>{total}</strong> chipas</span>
          <span><strong>{t.envios.length}</strong> {t.envios.length === 1 ? 'envío' : 'envíos'}</span>
          <span>de <strong>{grupos.size}</strong> {grupos.size === 1 ? 'lote' : 'lotes'}</span>
        </div>
      </section>
      {t.envios.length === 0 ? (
        <p className="lot-vacio">No hay envíos de chipa a esta sucursal{conFechas ? ' en estas fechas' : ''}.</p>
      ) : (
        <>
          <div className="lot-flecha arriba">Vino de estos lotes de chipa</div>
          <div className="lot-grupo">
            {[...grupos].map(([codigo, envios]) => {
              const lc = t.lotesChipa.find((l) => l.codigo === codigo)
              const recibido = envios.reduce((s, m) => s - m.cantidad, 0)
              return (
                <section key={codigo} className="tarjeta lot-paso" aria-label={`Lote de chipa ${codigo}`}>
                  <div className="lot-cabeza">
                    {codigo ? <Link className="lot-codigo" to={enlaceTrazaLote(codigo)}>Lote {codigo}</Link> : <span className="lot-codigo">Sin lote</span>}
                    <span>recibió <strong>{recibido}</strong></span>
                  </div>
                  {lc && <span className="suave chico">{datosLote(lc)}</span>}
                  <ListaEnvios envios={envios} conSucursal={false} />
                  <p className="lot-titulo-seccion">Materia prima</p>
                  <MateriaPrimaDe lote={lc ?? { lotesMP: [] }} />
                </section>
              )
            })}
          </div>
          <div className="lot-flecha arriba">{plural(t.lotesMP.length, 'lote de materia prima', 'lotes de materia prima')} en total</div>
          {t.lotesMP.length > 0 && (
            <section className="tarjeta" aria-label="Lotes de materia prima">
              <ul className="lot-lista-mp">
                {t.lotesMP.map((l) => (
                  <li key={l.id}><Link to={enlaceTrazaMP(l.id)}>{l.descripcion}</Link><EstadoLoteMP lote={l} /></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
