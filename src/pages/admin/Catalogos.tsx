// B01–B04: el administrador carga y edita productos, máquinas, áreas y tareas de limpieza, sucursales
// y el nombre de los sectores. Nada se borra: se desactiva y el historial lo sigue mostrando.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { patch, post } from '../../cliente/api'
import { textoRango, useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSector } from '../../components/Layout'
import {
  FRECUENCIAS_LIMPIEZA, NOMBRE_TIPO_MAQUINA, SECTOR_IDS,
  type AreaLimpieza, type Maquina, type Producto, type Sector, type SectorId, type Sucursal, type TareaLimpieza, type TipoMaquina,
} from '../../shared/tipos'
import '../../styles/catalogos.css'

type Pestana = 'productos' | 'maquinas' | 'limpieza' | 'sucursales' | 'sectores'
const PESTANAS: [Pestana, string][] = [
  ['productos', 'Productos'],
  ['maquinas', 'Máquinas'],
  ['limpieza', 'Limpieza'],
  ['sucursales', 'Sucursales'],
  ['sectores', 'Sectores'],
]

export default function Catalogos() {
  const [params, setParams] = useSearchParams()
  const pestana: Pestana = PESTANAS.some(([p]) => p === params.get('ver')) ? (params.get('ver') as Pestana) : 'productos'
  const sectorArriba = useSector()
  const [sector, setSector] = useState<SectorId>(sectorArriba)
  useEffect(() => setSector(sectorArriba), [sectorArriba])
  const sectores = useSectores()
  const porSector = pestana === 'productos' || pestana === 'maquinas' || pestana === 'limpieza'

  return (
    <>
      <h1>Catálogos</h1>
      <div className="segmentado pestanas-cat" role="tablist">
        {PESTANAS.map(([p, texto]) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pestana === p}
            className={pestana === p ? 'activo' : ''}
            onClick={() => setParams({ ver: p }, { replace: true })}
          >
            {texto}
          </button>
        ))}
      </div>

      {porSector && (
        <div className="selector-sector">
          <span>Sector</span>
          <div className="chips" role="group" aria-label="Sector">
            {sectores.lista.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip${s.id === sector ? ' activo' : ''}`}
                aria-pressed={s.id === sector}
                onClick={() => setSector(s.id)}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        </div>
      )}

      {pestana === 'productos' && <Productos sector={sector} nombreSector={sectores.nombre(sector)} />}
      {pestana === 'maquinas' && <Maquinas sector={sector} nombreSector={sectores.nombre(sector)} />}
      {pestana === 'limpieza' && <Limpieza sector={sector} sectores={sectores.lista} />}
      {pestana === 'sucursales' && <Sucursales />}
      {pestana === 'sectores' && <Sectores />}
    </>
  )
}

// ---------- Piezas comunes ----------

interface Campo {
  clave: string
  etiqueta: string
  valor: string
  max?: number
}

/**
 * Fila de catálogo: nombre, detalle y acciones. "Renombrar" abre la edición en línea de `campos`;
 * `guardar` recibe solo lo que cambió. Con `cambiarActivo` muestra Desactivar / Activar.
 */
function FilaEditable({ titulo, prefijo, detalle, activo = true, campos, guardar, cambiarActivo, textoEditar = 'Renombrar', debajo }: {
  titulo: string
  prefijo?: ReactNode
  detalle?: ReactNode
  activo?: boolean
  campos: Campo[]
  guardar: (cambios: Record<string, string>) => Promise<unknown>
  cambiarActivo?: (activo: boolean) => Promise<unknown>
  textoEditar?: string
  /** Control extra bajo el nombre (por ejemplo, "Pide N° de equipo"). */
  debajo?: ReactNode
}) {
  const [editando, setEditando] = useState(false)
  const [valores, setValores] = useState<Record<string, string>>({})
  const accion = useAccion((f: () => Promise<unknown>) => f())

  const abrir = () => {
    accion.limpiarError()
    setValores(Object.fromEntries(campos.map((c) => [c.clave, c.valor])))
    setEditando(true)
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const cambios = Object.fromEntries(campos.filter((c) => valores[c.clave].trim() !== c.valor).map((c) => [c.clave, valores[c.clave]]))
    if (!Object.keys(cambios).length) return setEditando(false)
    if (await accion.ejecutar(() => guardar(cambios))) setEditando(false)
  }

  return (
    <div className={`fila-cat${activo ? '' : ' inactiva'}`}>
      <div>
        <div className="cabeza">
          {prefijo}
          <span className="nombre">{titulo}</span>
          {!activo && <span className="etiqueta apagada">Desactivado</span>}
        </div>
        {detalle && <div className="detalle">{detalle}</div>}
        {!editando && debajo}
      </div>
      {!editando && (
        <div className="acciones-cat con-botones">
          <button type="button" className="btn-secundario" onClick={abrir}>{textoEditar}</button>
          {cambiarActivo && (
            <button type="button" className="btn-secundario" disabled={accion.enviando} onClick={() => void accion.ejecutar(() => cambiarActivo(!activo))}>
              {activo ? 'Desactivar' : 'Activar'}
            </button>
          )}
        </div>
      )}
      {editando && (
        <form className="editor" onSubmit={enviar}>
          {campos.map((c, i) => (
            <label key={c.clave} className="campo">
              <span>{c.etiqueta}</span>
              <input
                value={valores[c.clave] ?? ''}
                maxLength={c.max ?? 100}
                autoFocus={i === 0}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                onKeyDown={(e) => e.key === 'Escape' && setEditando(false)}
              />
            </label>
          ))}
          <div className="botones-cat">
            <button className="btn-primario" disabled={accion.enviando}>{accion.enviando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn-secundario" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </form>
      )}
      <Aviso>{accion.error}</Aviso>
    </div>
  )
}

/** Lista con los activos a la vista y los desactivados plegados al final. */
function ListaConInactivos<T extends { id: string; activo: boolean }>({ items, vacio, textoInactivos, render }: {
  items: T[]
  vacio: string
  textoInactivos: string
  render: (t: T) => ReactNode
}) {
  const activos = items.filter((i) => i.activo)
  const inactivos = items.filter((i) => !i.activo)
  return (
    <>
      {activos.length ? <div className="lista-cat">{activos.map(render)}</div> : <p className="suave">{vacio}</p>}
      {inactivos.length > 0 && (
        <details className="inactivos">
          <summary>{textoInactivos} ({inactivos.length})</summary>
          <div className="lista-cat">{inactivos.map(render)}</div>
        </details>
      )}
    </>
  )
}

/** Formulario de alta de una sola línea (nombre y, si hace falta, más campos). */
function FormAlta({ titulo, children, enviando, error, ok, alEnviar, boton = 'Agregar' }: {
  titulo: string
  children: ReactNode
  enviando: boolean
  error: string | null
  ok?: string | null
  alEnviar: () => void
  boton?: string
}) {
  return (
    <form className="form-cat" onSubmit={(e) => { e.preventDefault(); alEnviar() }}>
      <h2>{titulo}</h2>
      <div className="tarjeta filtros">
        {children}
        <button className="btn-primario" disabled={enviando}>{enviando ? 'Guardando…' : boton}</button>
      </div>
      <Aviso>{error}</Aviso>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
    </form>
  )
}

// ---------- Productos (B01) ----------

function Productos({ sector, nombreSector }: { sector: SectorId; nombreSector: string }) {
  const c = useConsulta<Producto[]>('/productos', { sector, todos: true })
  const [nombre, setNombre] = useState('')
  const [unidad, setUnidad] = useState('')
  const [ok, setOk] = useState<string | null>(null)
  const crear = useAccion(() => post<Producto>('/productos', { sector, nombre, unidad: unidad || undefined }))
  const agregar = async () => {
    setOk(null)
    const p = await crear.ejecutar()
    if (p) {
      setOk(`«${p.nombre}» agregado a ${nombreSector}.`)
      setNombre('')
      setUnidad('')
    }
  }

  return (
    <>
      <ConDatos consulta={c}>
        {(lista) => (
          <ListaConInactivos
            items={lista}
            vacio="Este sector todavía no tiene productos."
            textoInactivos="Productos desactivados"
            render={(p) => (
              <FilaEditable
                key={p.id}
                titulo={p.nombre}
                detalle={p.unidad !== 'unidades' ? `Se cuenta en ${p.unidad}` : null}
                activo={p.activo}
                campos={[
                  { clave: 'nombre', etiqueta: 'Nombre', valor: p.nombre },
                  { clave: 'unidad', etiqueta: 'Unidad', valor: p.unidad, max: 30 },
                ]}
                guardar={(cambios) => patch(`/productos/${p.id}`, cambios)}
                cambiarActivo={(activo) => patch(`/productos/${p.id}`, { activo })}
              />
            )}
          />
        )}
      </ConDatos>
      <FormAlta titulo={`Nuevo producto en ${nombreSector}`} enviando={crear.enviando} error={crear.error} ok={ok} alEnviar={() => void agregar()}>
        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} />
        </label>
        <label className="campo">
          <span>Unidad (vacío = unidades)</span>
          <input value={unidad} onChange={(e) => setUnidad(e.target.value)} maxLength={30} placeholder="unidades" />
        </label>
      </FormAlta>
    </>
  )
}

// ---------- Máquinas (B02) ----------

interface DatosMaquina { numero: string; nombre: string; tipo: TipoMaquina; min: string; max: string }

/** Rangos de las planillas (RE-TE.01), se proponen al elegir el tipo si los campos están vacíos. */
const RANGO_SUGERIDO: Record<TipoMaquina, [string, string]> = {
  heladera: ['1', '5'],
  congelador: ['', '-18'],
  exhibidora_fria: ['1', '10'],
  exhibidora_caliente: ['63', ''],
  otra: ['', ''],
}

/** '' → null; "2,5" → 2.5; si no es un número se manda tal cual para que la API diga qué está mal. */
function aTemperatura(s: string): number | string | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.').replace('−', '-'))
  return Number.isFinite(n) ? n : t
}

const cuerpoMaquina = (d: DatosMaquina) => ({
  nombre: d.nombre,
  tipo: d.tipo,
  tempMin: d.tipo === 'otra' ? null : aTemperatura(d.min),
  tempMax: d.tipo === 'otra' ? null : aTemperatura(d.max),
})

const aTexto = (n: number | null) => (n === null ? '' : String(n))

function CamposMaquina({ d, set, conNumero, siguiente }: {
  d: DatosMaquina
  set: (d: DatosMaquina) => void
  conNumero: boolean
  siguiente?: number
}) {
  const cambiarTipo = (tipo: TipoMaquina) => {
    const vacio = d.min.trim() === '' && d.max.trim() === ''
    set({ ...d, tipo, ...(vacio ? { min: RANGO_SUGERIDO[tipo][0], max: RANGO_SUGERIDO[tipo][1] } : {}) })
  }
  return (
    <>
      {conNumero && (
        <label className="campo">
          <span>N°{siguiente !== undefined ? ` (vacío = ${siguiente})` : ''}</span>
          <input type="number" inputMode="numeric" min={1} max={999} value={d.numero} onChange={(e) => set({ ...d, numero: e.target.value })} />
        </label>
      )}
      <label className="campo">
        <span>Nombre</span>
        <input value={d.nombre} onChange={(e) => set({ ...d, nombre: e.target.value })} maxLength={80} />
      </label>
      <label className="campo">
        <span>Tipo</span>
        <select value={d.tipo} onChange={(e) => cambiarTipo(e.target.value as TipoMaquina)}>
          {(Object.keys(NOMBRE_TIPO_MAQUINA) as TipoMaquina[]).map((t) => <option key={t} value={t}>{NOMBRE_TIPO_MAQUINA[t]}</option>)}
        </select>
      </label>
      {d.tipo !== 'otra' && (
        <>
          {/* Sin inputMode="numeric": el teclado numérico del iPhone no tiene signo menos (freezer −18 °C). */}
          <label className="campo">
            <span>T° mínima °C (vacío = sin mínimo)</span>
            <input type="number" step="any" value={d.min} onChange={(e) => set({ ...d, min: e.target.value })} />
          </label>
          <label className="campo">
            <span>T° máxima °C (vacío = sin máximo)</span>
            <input type="number" step="any" value={d.max} onChange={(e) => set({ ...d, max: e.target.value })} />
          </label>
        </>
      )}
    </>
  )
}

function Maquinas({ sector, nombreSector }: { sector: SectorId; nombreSector: string }) {
  const c = useConsulta<Maquina[]>('/maquinas', { sector, todos: true })
  const vacia: DatosMaquina = { numero: '', nombre: '', tipo: 'heladera', min: '1', max: '5' }
  const [d, setD] = useState<DatosMaquina>(vacia)
  const [ok, setOk] = useState<string | null>(null)
  const crear = useAccion(() =>
    post<Maquina>('/maquinas', { sector, ...cuerpoMaquina(d), numero: d.numero.trim() === '' ? undefined : Number(d.numero) }))
  const siguiente = c.datos ? Math.max(0, ...c.datos.map((m) => m.numero)) + 1 : undefined
  const agregar = async () => {
    setOk(null)
    const m = await crear.ejecutar()
    if (m) {
      setOk(`Máquina N° ${m.numero} «${m.nombre}» agregada a ${nombreSector} (${textoRango(m)}).`)
      setD(vacia)
    }
  }

  return (
    <>
      <ConDatos consulta={c}>
        {(lista) => (
          <ListaConInactivos
            items={lista}
            vacio="Este sector todavía no tiene máquinas."
            textoInactivos="Máquinas desactivadas"
            render={(m) => <FilaMaquina key={m.id} m={m} />}
          />
        )}
      </ConDatos>
      <FormAlta titulo={`Nueva máquina en ${nombreSector}`} enviando={crear.enviando} error={crear.error} ok={ok} alEnviar={() => void agregar()}>
        <CamposMaquina d={d} set={setD} conNumero siguiente={siguiente} />
      </FormAlta>
    </>
  )
}

function FilaMaquina({ m }: { m: Maquina }) {
  const [editando, setEditando] = useState(false)
  const [d, setD] = useState<DatosMaquina | null>(null)
  const accion = useAccion((cuerpo: object) => patch<Maquina>(`/maquinas/${m.id}`, cuerpo))

  const abrir = () => {
    accion.limpiarError()
    setD({ numero: String(m.numero), nombre: m.nombre, tipo: m.tipo, min: aTexto(m.tempMin), max: aTexto(m.tempMax) })
    setEditando(true)
  }
  const guardar = async (e: FormEvent) => {
    e.preventDefault()
    if (!d) return
    const cuerpo = { ...cuerpoMaquina(d), numero: d.numero.trim() === '' ? null : Number(d.numero) }
    if (await accion.ejecutar(cuerpo)) setEditando(false)
  }

  return (
    <div className={`fila-cat${m.activo ? '' : ' inactiva'}`}>
      <div>
        <div className="cabeza">
          <span className="numero-maq" title="N° de máquina">{m.numero}</span>
          <span className="nombre">{m.nombre}</span>
          {!m.activo && <span className="etiqueta apagada">Desactivada</span>}
        </div>
        <div className="detalle">{NOMBRE_TIPO_MAQUINA[m.tipo]} · <strong>{textoRango(m)}</strong></div>
      </div>
      {!editando && (
        <div className="acciones-cat con-botones">
          <button type="button" className="btn-secundario" onClick={abrir}>Editar</button>
          <button type="button" className="btn-secundario" disabled={accion.enviando} onClick={() => void accion.ejecutar({ activo: !m.activo })}>
            {m.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      )}
      {editando && d && (
        <form className="editor" onSubmit={guardar}>
          <CamposMaquina d={d} set={setD} conNumero />
          <div className="botones-cat">
            <button className="btn-primario" disabled={accion.enviando}>{accion.enviando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn-secundario" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </form>
      )}
      <Aviso>{accion.error}</Aviso>
    </div>
  )
}

// ---------- Limpieza (B03) ----------

function Limpieza({ sector, sectores }: { sector: SectorId; sectores: Sector[] }) {
  const c = useConsulta<AreaLimpieza[]>('/areas', { sector, todos: true })
  const [areaId, setAreaId] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const nombreSector = (id: SectorId) => sectores.find((s) => s.id === id)?.nombre ?? id

  const creada = (a: AreaLimpieza) => {
    setCreando(false)
    setAreaId(a.id)
    setOk(a.sectores.includes(sector)
      ? `Área «${a.nombre}» creada. Agregale las tareas abajo.`
      : `Área «${a.nombre}» creada para ${a.sectores.map(nombreSector).join(', ')}. Elegí ese sector arriba para verla.`)
  }

  return (
    <>
      <ConDatos consulta={c}>
        {(areas) => {
          if (!areas.length) return <p className="suave">Este sector no tiene áreas de limpieza.</p>
          const area = areas.find((a) => a.id === areaId) ?? areas.find((a) => a.activo) ?? areas[0]
          return (
            <>
              <label className="campo">
                <span>Área</span>
                <select value={area.id} onChange={(e) => { setAreaId(e.target.value); setOk(null) }}>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}{a.codigo ? ` (${a.codigo})` : ''}{a.activo ? '' : ' · desactivada'}
                    </option>
                  ))}
                </select>
              </label>
              {ok && <Aviso tipo="ok">{ok}</Aviso>}
              <DetalleArea key={area.id} area={area} sectores={sectores} />
            </>
          )
        }}
      </ConDatos>
      {!c.datos?.length && ok && <Aviso tipo="ok">{ok}</Aviso>}
      {creando ? (
        <NuevaArea sectorInicial={sector} sectores={sectores} alCrear={creada} alCancelar={() => setCreando(false)} />
      ) : (
        <button type="button" className="btn-secundario btn-nueva-area" onClick={() => { setCreando(true); setOk(null) }}>
          Nueva área de limpieza
        </button>
      )}
    </>
  )
}

function SectoresCheck({ elegidos, sectores, alCambiar, deshabilitado }: {
  elegidos: SectorId[]
  sectores: Sector[]
  alCambiar: (s: SectorId[]) => void
  deshabilitado?: boolean
}) {
  const alternar = (id: SectorId) =>
    alCambiar(SECTOR_IDS.filter((s) => (s === id ? !elegidos.includes(s) : elegidos.includes(s))))
  return (
    <div className="sectores-check">
      {sectores.map((s) => {
        const marcado = elegidos.includes(s.id)
        return (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              checked={marcado}
              // No se puede dejar un área sin sectores.
              disabled={deshabilitado || (marcado && elegidos.length === 1)}
              onChange={() => alternar(s.id)}
            />
            {s.nombre}
          </label>
        )
      })}
    </div>
  )
}

function DetalleArea({ area, sectores }: { area: AreaLimpieza; sectores: Sector[] }) {
  const cambiar = useAccion((cuerpo: object) => patch<AreaLimpieza>(`/areas/${area.id}`, cuerpo))
  // Sectores que cargan el área: cambian al instante y vuelven atrás si la API lo rechaza.
  const [elegidos, setElegidos] = useState(area.sectores)
  const clave = area.sectores.join(',')
  useEffect(() => setElegidos(area.sectores), [clave]) // por contenido, no por referencia del arreglo
  const cambiarSectores = async (s: SectorId[]) => {
    setElegidos(s)
    if (!(await cambiar.ejecutar({ sectores: s }))) setElegidos(area.sectores)
  }
  // Frecuencia mínima de limpieza (G08): igual, cambia al instante y vuelve atrás si la API la rechaza.
  const [frecuencia, setFrecuencia] = useState(area.frecuenciaDias)
  useEffect(() => setFrecuencia(area.frecuenciaDias), [area.frecuenciaDias])
  const cambiarFrecuencia = async (dias: number | null) => {
    setFrecuencia(dias)
    if (!(await cambiar.ejecutar({ frecuenciaDias: dias }))) setFrecuencia(area.frecuenciaDias)
  }
  // Un valor cargado a mano que no está entre las opciones habituales igual se muestra.
  const opcionesFrecuencia = FRECUENCIAS_LIMPIEZA.some((f) => f.dias === frecuencia)
    ? FRECUENCIAS_LIMPIEZA
    : [...FRECUENCIAS_LIMPIEZA, { dias: frecuencia, nombre: `Cada ${frecuencia} días` }]
  const [nombre, setNombre] = useState('')
  const [pideNumero, setPideNumero] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const nueva = useAccion(() => post<TareaLimpieza>(`/areas/${area.id}/tareas`, { nombre, pideNumero }))
  const agregar = async () => {
    setOk(null)
    const t = await nueva.ejecutar()
    if (t) {
      setOk(`Tarea «${t.nombre}» agregada al final de ${area.nombre}.`)
      setNombre('')
      setPideNumero(false)
    }
  }

  return (
    <>
      <div className="tarjeta tarjeta-area">
        <FilaEditable
          titulo={area.nombre}
          detalle={area.codigo ? `Planilla ${area.codigo}` : 'Sin código de planilla'}
          activo={area.activo}
          campos={[
            { clave: 'nombre', etiqueta: 'Nombre del área', valor: area.nombre, max: 80 },
            { clave: 'codigo', etiqueta: 'Código de planilla', valor: area.codigo, max: 30 },
          ]}
          guardar={(cambios) => patch(`/areas/${area.id}`, cambios)}
          cambiarActivo={(activo) => patch(`/areas/${area.id}`, { activo })}
        />
        <div className="campo">
          <span>La cargan</span>
          <SectoresCheck
            elegidos={elegidos}
            sectores={sectores}
            deshabilitado={cambiar.enviando}
            alCambiar={(s) => void cambiarSectores(s)}
          />
          <Aviso>{cambiar.error}</Aviso>
        </div>
        <label className="campo">
          <span>Limpieza mínima exigida</span>
          <select
            value={frecuencia === null ? '' : String(frecuencia)} disabled={cambiar.enviando}
            onChange={(e) => void cambiarFrecuencia(e.target.value === '' ? null : Number(e.target.value))}
          >
            {opcionesFrecuencia.map((f) => <option key={f.dias ?? 'ninguna'} value={f.dias === null ? '' : String(f.dias)}>{f.nombre}</option>)}
          </select>
          <small className="suave">Si pasa más tiempo sin limpiar, el sector ve un aviso en Limpieza.</small>
        </label>
      </div>

      <h2>Tareas</h2>
      {(() => {
        const activas = area.tareas.filter((t) => t.activo)
        const inactivas = area.tareas.filter((t) => !t.activo)
        return (
          <>
            {activas.length
              ? <ol className="lista-tareas">{activas.map((t) => <li key={t.id}><FilaTarea t={t} /></li>)}</ol>
              : <p className="suave">Esta área no tiene tareas activas.</p>}
            {inactivas.length > 0 && (
              <details className="inactivos">
                <summary>Tareas desactivadas ({inactivas.length})</summary>
                <div className="lista-cat">{inactivas.map((t) => <FilaTarea key={t.id} t={t} />)}</div>
              </details>
            )}
          </>
        )
      })()}

      <FormAlta titulo={`Nueva tarea en ${area.nombre}`} enviando={nueva.enviando} error={nueva.error} ok={ok} alEnviar={() => void agregar()}>
        <label className="campo">
          <span>Tarea (qué se limpia)</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Ej.: Piso, Basureros, Mesada" />
        </label>
        <label className="check">
          <input type="checkbox" checked={pideNumero} onChange={(e) => setPideNumero(e.target.checked)} />
          Pide N° de equipo
        </label>
      </FormAlta>
    </>
  )
}

function FilaTarea({ t }: { t: TareaLimpieza }) {
  const numero = useAccion((pide: boolean) => patch<TareaLimpieza>(`/tareas/${t.id}`, { pideNumero: pide }))
  // Se marca al instante; si la API lo rechaza vuelve a como estaba.
  const [pide, setPide] = useState(t.pideNumero)
  useEffect(() => setPide(t.pideNumero), [t.pideNumero])
  const alternar = async (v: boolean) => {
    setPide(v)
    if (!(await numero.ejecutar(v))) setPide(t.pideNumero)
  }
  return (
    <>
      <FilaEditable
        titulo={t.nombre}
        activo={t.activo}
        detalle={!t.activo && t.pideNumero ? 'Pide N° de equipo' : null}
        campos={[{ clave: 'nombre', etiqueta: 'Tarea', valor: t.nombre }]}
        guardar={(cambios) => patch(`/tareas/${t.id}`, cambios)}
        cambiarActivo={(activo) => patch(`/tareas/${t.id}`, { activo })}
        debajo={t.activo && (
          <label className="check pide-numero">
            <input type="checkbox" checked={pide} disabled={numero.enviando} onChange={(e) => void alternar(e.target.checked)} />
            <span className="chico">Pide N° de equipo</span>
          </label>
        )}
      />
      <Aviso>{numero.error}</Aviso>
    </>
  )
}

function NuevaArea({ sectorInicial, sectores, alCrear, alCancelar }: {
  sectorInicial: SectorId
  sectores: Sector[]
  alCrear: (a: AreaLimpieza) => void
  alCancelar: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [elegidos, setElegidos] = useState<SectorId[]>([sectorInicial])
  const crear = useAccion(() => post<AreaLimpieza>('/areas', { nombre, codigo, sectores: elegidos }))
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const a = await crear.ejecutar()
    if (a) alCrear(a)
  }
  return (
    <form className="form-cat nueva-area" onSubmit={enviar}>
      <h2>Nueva área de limpieza</h2>
      <div className="tarjeta">
        <div className="editor sin-margen">
          <label className="campo">
            <span>Nombre del área</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} autoFocus />
          </label>
          <label className="campo">
            <span>Código de planilla (opcional)</span>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={30} placeholder="RE-09.10" />
          </label>
        </div>
        <div className="campo">
          <span>La cargan</span>
          <SectoresCheck elegidos={elegidos} sectores={sectores} alCambiar={setElegidos} />
        </div>
        <div className="botones-cat">
          <button className="btn-primario" disabled={crear.enviando}>{crear.enviando ? 'Creando…' : 'Crear área'}</button>
          <button type="button" className="btn-secundario" onClick={alCancelar}>Cancelar</button>
        </div>
      </div>
      <Aviso>{crear.error}</Aviso>
    </form>
  )
}

// ---------- Sucursales (B04) ----------

function Sucursales() {
  const c = useConsulta<Sucursal[]>('/sucursales', { todos: true })
  const [nombre, setNombre] = useState('')
  const [ok, setOk] = useState<string | null>(null)
  const crear = useAccion(() => post<Sucursal>('/sucursales', { nombre }))
  const agregar = async () => {
    setOk(null)
    const s = await crear.ejecutar()
    if (s) {
      setOk(`«${s.nombre}» agregada.`)
      setNombre('')
    }
  }
  return (
    <>
      <ConDatos consulta={c}>
        {(lista) => (
          <ListaConInactivos
            items={lista}
            vacio="Todavía no hay sucursales."
            textoInactivos="Sucursales desactivadas"
            render={(s) => (
              <FilaEditable
                key={s.id}
                titulo={s.nombre}
                activo={s.activo}
                campos={[{ clave: 'nombre', etiqueta: 'Nombre', valor: s.nombre, max: 80 }]}
                guardar={(cambios) => patch(`/sucursales/${s.id}`, cambios)}
                cambiarActivo={(activo) => patch(`/sucursales/${s.id}`, { activo })}
              />
            )}
          />
        )}
      </ConDatos>
      <FormAlta titulo="Nueva sucursal" enviando={crear.enviando} error={crear.error} ok={ok} alEnviar={() => void agregar()}>
        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
        </label>
      </FormAlta>
    </>
  )
}

// ---------- Sectores ----------

function Sectores() {
  const c = useConsulta<Sector[]>('/sectores')
  return (
    <>
      <ConDatos consulta={c}>
        {(lista) => (
          <div className="lista-cat">
            {lista.map((s) => (
              <FilaEditable
                key={s.id}
                titulo={s.nombre}
                detalle={s.conLotes ? 'Con lotes y trazabilidad' : null}
                campos={[{ clave: 'nombre', etiqueta: 'Nombre del sector', valor: s.nombre, max: 40 }]}
                guardar={(cambios) => patch(`/sectores/${s.id}`, cambios)}
              />
            ))}
          </div>
        )}
      </ConDatos>
    </>
  )
}
