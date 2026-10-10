// E01, E05, E07: ingreso de materia prima, estado de cada lote (con bloqueo del administrador)
// y lotes de chipa con lo que fue al horno, al congelador y lo que queda. Solo Chipería y el administrador.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { patch, post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { useUsuario } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { IconoLotes } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaLegible, diaPY, sumarDias } from '../../shared/hora'
import type { LoteChipa, LoteMP } from '../../shared/tipos'
import '../../styles/lotes.css'

/** Insumos de la planilla de chipas; el campo es libre. */
const INSUMOS = ['Queso', 'Almidón', 'Harina', 'Leche', 'Huevo', 'Grasa']
const UNIDADES = ['kg', 'g', 'l', 'unidades', 'bolsas']
const POR_PAGINA = 20

const formatoNumero = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 })
export const cantidadMP = (l: Pick<LoteMP, 'cantidad' | 'unidad'>) => `${formatoNumero.format(l.cantidad)} ${l.unidad}`

/** Días de `desde` a `hasta` (AAAA-MM-DD). */
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

export const vencido = (l: LoteMP, hoy = diaPY()) => l.vencimiento < hoy

/** Chips de estado: Disponible, Vencido, Bloqueado (puede tener los dos últimos). */
export function EstadoLoteMP({ lote }: { lote: LoteMP }) {
  const hoy = diaPY()
  if (lote.disponible) return <span className="lot-estado disponible">Disponible</span>
  return (
    <span className="lot-estados">
      {vencido(lote, hoy) && <span className="lot-estado vencido">Vencido</span>}
      {lote.bloqueado && <span className="lot-estado bloqueado">Bloqueado</span>}
    </span>
  )
}

export const enlaceTrazaMP = (id: string) => `/trazabilidad?mp=${encodeURIComponent(id)}`
export const enlaceTrazaLote = (codigo: string) => `/trazabilidad?lote=${encodeURIComponent(codigo)}`

export default function Lotes() {
  const usuario = useUsuario()
  const esAdmin = usuario.rol === 'admin'
  return (
    <>
      <Volver titulo="Materia prima y lotes" a={esAdmin ? '/admin' : '/sector'} icono={<IconoLotes />} />
      {esAdmin || usuario.rol === 'chiperia' ? <PantallaLotes esAdmin={esAdmin} /> : <Aviso>Los lotes y la trazabilidad son solo de Chipería.</Aviso>}
    </>
  )
}

function PantallaLotes({ esAdmin }: { esAdmin: boolean }) {
  const lotesMP = useConsulta<LoteMP[]>('/lotes-mp')
  return (
    <>
      <h2>Ingresar materia prima</h2>
      <FormLoteMP existentes={lotesMP.datos ?? []} />
      <h2>Lotes de materia prima</h2>
      <ConDatos consulta={lotesMP}>{(lotes) => <ListaLotesMP lotes={lotes} esAdmin={esAdmin} />}</ConDatos>
      <h2>Lotes de chipa</h2>
      <ListaLotesChipa />
    </>
  )
}

// ---------- Ingreso (E01) ----------

function FormLoteMP({ existentes }: { existentes: LoteMP[] }) {
  const hoy = diaPY()
  const vacio = { insumo: '', proveedor: '', numeroLote: '', cantidad: '', vencimiento: '' }
  const [f, setF] = useState({ ...vacio, fechaIngreso: hoy, unidad: 'kg' })
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const guardar = useAccion((cuerpo: Record<string, unknown>) => post<LoteMP>('/lotes-mp', cuerpo))
  const cambiar = (c: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...c }))
    setAviso(null)
    setErrorLocal(null)
    guardar.limpiarError()
  }

  // Sugerencias: los insumos de la planilla más los ya usados; proveedores del insumo elegido primero.
  const insumos = [...new Set([...INSUMOS, ...existentes.map((l) => l.insumo)])].slice(0, 8)
  const proveedores = [...new Set([
    ...existentes.filter((l) => l.insumo.toLowerCase() === f.insumo.trim().toLowerCase()).map((l) => l.proveedor),
    ...existentes.map((l) => l.proveedor),
  ])]

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const texto = f.cantidad.trim().replace(/\./g, '').replace(',', '.')
    const cantidad = f.cantidad.trim() === '' ? null : Number(f.cantidad.includes(',') ? texto : f.cantidad.trim())
    if (cantidad !== null && !Number.isFinite(cantidad)) return setErrorLocal('La cantidad tiene que ser un número, por ejemplo 25 o 12,5.')
    const lote = await guardar.ejecutar({
      insumo: f.insumo,
      proveedor: f.proveedor,
      numeroLote: f.numeroLote,
      fechaIngreso: f.fechaIngreso,
      cantidad,
      unidad: f.unidad,
      vencimiento: f.vencimiento,
    })
    if (lote) {
      setF((x) => ({ ...x, ...vacio }))
      setAviso(`Listo: ${lote.descripcion} (${cantidadMP(lote)}) ya se puede elegir al registrar chipas.`)
    }
  }

  const minimoVence = f.fechaIngreso > hoy ? f.fechaIngreso : hoy
  return (
    <form className="tarjeta lot-form" onSubmit={(e) => void enviar(e)} noValidate>
      <div className="campo lot-ancho">
        <label htmlFor="lot-insumo" className="lot-etiqueta">Insumo</label>
        <div className="chips" role="group" aria-label="Insumos frecuentes">
          {insumos.map((i) => (
            <button type="button" key={i} className={`chip${f.insumo.trim().toLowerCase() === i.toLowerCase() ? ' activo' : ''}`}
              aria-pressed={f.insumo.trim().toLowerCase() === i.toLowerCase()} onClick={() => cambiar({ insumo: i })}>
              {i}
            </button>
          ))}
        </div>
        <input id="lot-insumo" value={f.insumo} onChange={(e) => cambiar({ insumo: e.target.value })} placeholder="Elegí arriba o escribí otro" maxLength={60} />
      </div>
      <label className="campo">
        <span>Proveedor</span>
        <input value={f.proveedor} onChange={(e) => cambiar({ proveedor: e.target.value })} placeholder="Ej.: Lácteos Tatiana" list="lot-proveedores" maxLength={100} autoComplete="off" />
        <datalist id="lot-proveedores">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <label className="campo">
        <span>N° de lote <span className="lot-opcional">(si el envase lo trae)</span></span>
        <input value={f.numeroLote} onChange={(e) => cambiar({ numeroLote: e.target.value })} placeholder="Opcional" maxLength={60} autoComplete="off" />
      </label>
      <label className="campo">
        <span>Fecha de ingreso</span>
        <input type="date" value={f.fechaIngreso} max={hoy} onChange={(e) => cambiar({ fechaIngreso: e.target.value })} />
      </label>
      <div className="campo">
        <label htmlFor="lot-cantidad" className="lot-etiqueta">Cantidad</label>
        <div className="lot-cantidad">
          <input id="lot-cantidad" type="text" inputMode="decimal" value={f.cantidad} placeholder="0"
            onChange={(e) => cambiar({ cantidad: e.target.value })} autoComplete="off" />
          <select aria-label="Unidad" value={f.unidad} onChange={(e) => cambiar({ unidad: e.target.value })}>
            {UNIDADES.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <label className="campo">
        <span>Vencimiento</span>
        <input type="date" value={f.vencimiento} min={minimoVence} onChange={(e) => cambiar({ vencimiento: e.target.value })} />
      </label>
      <div className="lot-ancho">
        <Aviso>{errorLocal ?? guardar.error}</Aviso>
        <Aviso tipo="ok">{aviso}</Aviso>
        <button className="btn-primario" type="submit" disabled={guardar.enviando}>
          {guardar.enviando ? 'Guardando…' : 'Agregar lote'}
        </button>
      </div>
    </form>
  )
}

// ---------- Lotes de materia prima (E07) ----------

type Filtro = 'todos' | 'disponibles' | 'vencidos' | 'bloqueados'

function ListaLotesMP({ lotes, esAdmin }: { lotes: LoteMP[]; esAdmin: boolean }) {
  const hoy = diaPY()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [cuantos, setCuantos] = useState(POR_PAGINA)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cambiar = useAccion((id: string, bloqueado: boolean) => patch<LoteMP>(`/lotes-mp/${encodeURIComponent(id)}`, { bloqueado }))

  if (!lotes.length) return <p className="lot-vacio">Todavía no hay lotes de materia prima. Cargá el primero con el formulario de arriba.</p>

  const grupos: Record<Filtro, LoteMP[]> = {
    todos: lotes,
    disponibles: lotes.filter((l) => l.disponible),
    vencidos: lotes.filter((l) => vencido(l, hoy)),
    bloqueados: lotes.filter((l) => l.bloqueado),
  }
  const nombres: Record<Filtro, string> = { todos: 'Todos', disponibles: 'Disponibles', vencidos: 'Vencidos', bloqueados: 'Bloqueados' }
  const visibles = grupos[filtro]

  const confirmar = async (l: LoteMP) => {
    const r = await cambiar.ejecutar(l.id, !l.bloqueado)
    if (r) {
      setConfirmando(null)
      setAviso(r.bloqueado
        ? `${r.descripcion} quedó bloqueado: ya no aparece para elegir al registrar chipas.`
        : `${r.descripcion} quedó desbloqueado: vuelve a aparecer para elegir.`)
    }
  }

  return (
    <>
      <div className="lot-filtros" role="group" aria-label="Filtrar lotes por estado">
        {(Object.keys(grupos) as Filtro[]).map((k) => (
          <button key={k} type="button" className={`chip${filtro === k ? ' activo' : ''}`} aria-pressed={filtro === k}
            onClick={() => { setFiltro(k); setCuantos(POR_PAGINA) }}>
            {nombres[k]} ({grupos[k].length})
          </button>
        ))}
      </div>
      <Aviso tipo="ok">{aviso}</Aviso>
      {visibles.length === 0 ? (
        <p className="lot-vacio">No hay lotes {nombres[filtro].toLowerCase()}.</p>
      ) : (
        <table className="tabla lot-tabla">
          <thead><tr><th>Lote</th><th>Vence</th><th className="lot-col-estado">Estado</th></tr></thead>
          <tbody>
            {visibles.slice(0, cuantos).map((l) => {
              const faltan = diasEntre(hoy, l.vencimiento)
              const abierto = confirmando === l.id
              return [
                <tr key={l.id} className={abierto ? 'lot-con-confirmacion' : ''}>
                  <td className={l.disponible ? '' : 'apagado'}>
                    <strong>{l.insumo}</strong> · {l.proveedor}
                    <div className="lot-sub">
                      {l.numeroLote ? `lote ${l.numeroLote} · ` : ''}{cantidadMP(l)} · ingresó {diaLegible(l.fechaIngreso)}
                    </div>
                    <Link className="chico" to={enlaceTrazaMP(l.id)}>Ver trazabilidad</Link>
                  </td>
                  <td className={l.disponible ? '' : 'apagado'}>
                    {diaLegible(l.vencimiento)}
                    {l.disponible && faltan <= 7 && (
                      <div className="lot-sub lot-pronto">{faltan === 0 ? 'vence hoy' : faltan === 1 ? 'vence mañana' : `en ${faltan} días`}</div>
                    )}
                  </td>
                  <td>
                    <EstadoLoteMP lote={l} />
                    {esAdmin && !vencido(l, hoy) && !abierto && (
                      <div>
                        <button type="button" className="btn-texto" onClick={() => { setConfirmando(l.id); setAviso(null); cambiar.limpiarError() }}>
                          {l.bloqueado ? 'Desbloquear' : 'Bloquear'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>,
                abierto && (
                  <tr key={`${l.id}-confirmar`} className="lot-confirmar">
                    <td colSpan={3}>
                      <p>
                        {l.bloqueado
                          ? <>¿Desbloquear <strong>{l.descripcion}</strong>? Vuelve a aparecer para elegir al registrar chipas.</>
                          : <>¿Bloquear <strong>{l.descripcion}</strong>? Ya no se va a poder elegir para producir. Queda en el historial y en la trazabilidad.</>}
                      </p>
                      <Aviso>{cambiar.error}</Aviso>
                      <div className="fila-acciones">
                        <button type="button" className="btn-primario" disabled={cambiar.enviando} onClick={() => void confirmar(l)}>
                          {cambiar.enviando ? 'Guardando…' : l.bloqueado ? 'Sí, desbloquear' : 'Sí, bloquear'}
                        </button>
                        <button type="button" className="btn-texto" disabled={cambiar.enviando} onClick={() => setConfirmando(null)}>Cancelar</button>
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      )}
      {visibles.length > cuantos && (
        <button type="button" className="btn-secundario lot-mas" onClick={() => setCuantos((c) => c + POR_PAGINA)}>
          Mostrar más ({visibles.length - cuantos} restantes)
        </button>
      )}
    </>
  )
}

// ---------- Lotes de chipa (E03–E05) ----------

function ListaLotesChipa() {
  const hoy = diaPY()
  const [desde, setDesde] = useState(sumarDias(hoy, -30))
  const [hasta, setHasta] = useState(hoy)
  const [cuantos, setCuantos] = useState(POR_PAGINA)
  const lotes = useConsulta<LoteChipa[]>('/lotes-chipa', { desde, hasta })
  return (
    <>
      <div className="lot-fechas">
        <label className="campo">
          <span>Desde</span>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => { setDesde(e.target.value); setCuantos(POR_PAGINA) }} />
        </label>
        <label className="campo">
          <span>Hasta</span>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => { setHasta(e.target.value); setCuantos(POR_PAGINA) }} />
        </label>
      </div>
      <ConDatos consulta={lotes}>
        {(lista) => lista.length === 0 ? (
          <p className="lot-vacio">No hay lotes de chipa en estas fechas. Cada amasada registrada en Producción crea su lote.</p>
        ) : (
          <>
            <table className="tabla lot-tabla">
              <thead><tr><th>Lote</th><th className="num">Horno</th><th className="num">Congelador</th><th className="num">Queda</th></tr></thead>
              <tbody>
                {lista.slice(0, cuantos).flatMap((l) => [
                  <tr key={l.id} className={`lot-fila-lote${l.stock === 0 ? ' apagado' : ''}`}>
                    <td>
                      <Link className="lot-codigo" to={enlaceTrazaLote(l.codigo)}>{l.codigo}</Link>
                      <div className="lot-sub">{diaLegible(l.dia)} · amasada {l.amasada}</div>
                    </td>
                    <td className="num">{l.horno}</td>
                    <td className="num">{l.congelador}</td>
                    <td className="num"><strong>{l.stock}</strong></td>
                  </tr>,
                  <tr key={`${l.id}-mp`} className={`lot-fila-mp${l.stock === 0 ? ' apagado' : ''}`}>
                    <td colSpan={4}>
                      {l.lotesMP.length > 0 ? (
                        <ul className="lot-mp-usados" aria-label={`Materia prima del lote ${l.codigo}`}>
                          {l.lotesMP.map((mp) => <li key={mp.id}>{mp.descripcion}</li>)}
                        </ul>
                      ) : <span className="lot-sub">Sin materia prima registrada</span>}
                    </td>
                  </tr>,
                ])}
              </tbody>
            </table>
            {lista.length > cuantos && (
              <button type="button" className="btn-secundario lot-mas" onClick={() => setCuantos((c) => c + POR_PAGINA)}>
                Mostrar más ({lista.length - cuantos} restantes)
              </button>
            )}
          </>
        )}
      </ConDatos>
    </>
  )
}
