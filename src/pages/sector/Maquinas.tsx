// F01–F05: el operador elige una máquina de su sector y carga estado, temperatura (obligatoria en los
// equipos fríos y calientes), observación, mantenimiento y una foto opcional. Debajo, el historial de la
// máquina con la temperatura en rojo cuando quedó fuera de rango. El supervisor (y el administrador) no carga
// lecturas desde acá sino fallas o incidencias, que quedan abiertas hasta que alguien las marca como resueltas.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { usePuede } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { CampoFoto, FotoBajoDemanda } from '../../components/Foto'
import { useElegirSector, useSector } from '../../components/Layout'
import { IconoMaquinas } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaPY, fechaHoraPY, horaPY, sumarDias } from '../../shared/hora'
import {
  NOMBRE_ESTADO, NOMBRE_MOMENTO, NOMBRE_TIPO_INCIDENCIA, SECTOR_IDS,
  type EstadoMaquina, type Incidencia, type PedidoIncidencia, type TipoIncidencia, type Lectura, type Maquina, type Momento, type PedidoLectura, type SectorId,
} from '../../shared/tipos'
import '../../styles/controles.css'
import BotonIcono from '../../components/BotonIcono'

// ---------- Ayudas que comparte la pantalla de controles del administrador ----------

/** "3,5 °C", "−18 °C". */
export function grados(n: number): string {
  return `${n.toLocaleString('es-PY', { maximumFractionDigits: 1 }).replace('-', '−')}\u00a0°C`
}

const numeroSolo = (n: number) => n.toLocaleString('es-PY', { maximumFractionDigits: 1 }).replace('-', '−')

/** "1 a 5 °C", "−18 °C o menos", "63 °C o más" o "Sin control de temperatura". */
export function textoRango(m: Pick<Maquina, 'tempMin' | 'tempMax'>): string {
  if (m.tempMin !== null && m.tempMax !== null) return `${numeroSolo(m.tempMin)} a ${grados(m.tempMax)}`
  if (m.tempMax !== null) return `${grados(m.tempMax)} o menos`
  if (m.tempMin !== null) return `${grados(m.tempMin)} o más`
  return 'Sin control de temperatura'
}

const tieneRango = (m: Pick<Maquina, 'tempMin' | 'tempMax'>) => m.tempMin !== null || m.tempMax !== null

/** Lo mismo que calcula el servidor (F04), para avisar antes de guardar. */
function fueraDeRango(m: Pick<Maquina, 'tempMin' | 'tempMax'>, t: number | null): boolean {
  if (t === null) return false
  return (m.tempMin !== null && t < m.tempMin) || (m.tempMax !== null && t > m.tempMax)
}

const esBuffet = (m: Maquina) => m.tipo === 'exhibidora_fria' || m.tipo === 'exhibidora_caliente'

/** Foto de una lectura: «Ver foto» la pide al servidor recién al tocarlo. */
export const FotoLectura = ({ lecturaId }: { lecturaId: string }) => (
  <FotoBajoDemanda ruta={`/lecturas/${lecturaId}/foto`} alt="Foto de la lectura" />
)

// ---------- Pantalla ----------

export default function Maquinas() {
  // Al cambiar de sector (administrador) todo empieza de cero.
  const sector = useSector()
  return <Pantalla key={sector} sector={sector} />
}

function Pantalla({ sector }: { sector: SectorId }) {
  const [params, setParams] = useSearchParams()
  const puede = usePuede()
  const elegirSector = useElegirSector()
  const hoy = diaPY()
  const maquinas = useConsulta<Maquina[]>('/maquinas', { sector })
  const recientes = useConsulta<Lectura[]>('/lecturas', { sector, desde: sumarDias(hoy, -30) })
  const abiertas = useConsulta<Incidencia[]>('/incidencias', { sector, abiertas: true })
  const maquina = maquinas.datos?.find((m) => m.id === params.get('maquina'))

  // Un aviso de otra máquina trae su sector (?sector=…): administrador y supervisor pasan a mirar ese sector.
  const sectorPedido = params.get('sector')
  useEffect(() => {
    if (!sectorPedido) return
    if ((SECTOR_IDS as string[]).includes(sectorPedido)) elegirSector(sectorPedido as SectorId)
    const resto = new URLSearchParams(params)
    resto.delete('sector')
    setParams(resto, { replace: true })
  }, [sectorPedido]) // eslint-disable-line react-hooks/exhaustive-deps

  if (maquina) {
    const deHoy = (recientes.datos ?? []).filter((l) => l.maquinaId === maquina.id && l.dia === hoy)
    return (
      <>
        <div className="titulo">
          <button className="volver" onClick={() => setParams({})} aria-label="Volver">‹</button>
          <h1>N° {maquina.numero} · {maquina.nombre}</h1>
        </div>
        {puede('maquinas.lectura') && <Formulario key={maquina.id} maquina={maquina} deHoy={recientes.datos ? deHoy : null} />}
        <Incidencias key={`inc-${maquina.id}`} maquina={maquina} reportar={puede('maquinas.incidencia')} />
        <Historial maquina={maquina} />
      </>
    )
  }

  const ultima = (id: string) => recientes.datos?.find((l) => l.maquinaId === id)
  return (
    <>
      <Volver titulo="Máquinas y temperatura" icono={<IconoMaquinas />} />
      <ConDatos consulta={maquinas}>
        {(lista) =>
          lista.length === 0 ? (
            <p className="suave">Este sector no tiene máquinas cargadas.</p>
          ) : (
            <div className="lista">
              {lista.map((m) => {
                const u = ultima(m.id)
                const alerta = !!u && (u.fueraDeRango || u.estado !== 'funciona')
                const hoyCuenta = (recientes.datos ?? []).filter((l) => l.maquinaId === m.id && l.dia === hoy).length
                const incidencias = (abiertas.datos ?? []).filter((i) => i.maquinaId === m.id).length
                return (
                  <button key={m.id} className={alerta || incidencias ? 'item alerta' : 'item'} onClick={() => setParams({ maquina: m.id })}>
                    <strong>N° {m.numero} · {m.nombre}</strong>
                    <span className="suave">{tieneRango(m) ? `Rango: ${textoRango(m)}` : 'Sin control de temperatura'}</span>
                    <span className={alerta ? 'error chico' : 'suave chico'}>
                      {recientes.datos === undefined
                        ? ' '
                        : u
                          ? `Última: ${fechaHoraPY(u.fecha)}${u.temperatura !== null ? ` · ${grados(u.temperatura)}` : ''} · ${NOMBRE_ESTADO[u.estado]}${u.fueraDeRango ? ' · fuera de rango' : ''}`
                          : 'Sin lecturas en los últimos 30 días'}
                    </span>
                    {recientes.datos !== undefined && (
                      <span className="suave chico">Hoy: {hoyCuenta === 0 ? 'sin lecturas' : hoyCuenta === 1 ? '1 lectura' : `${hoyCuenta} lecturas`}</span>
                    )}
                    {incidencias > 0 && (
                      <span className="error chico">{incidencias === 1 ? '1 falla o incidencia sin resolver' : `${incidencias} fallas o incidencias sin resolver`}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        }
      </ConDatos>
      {recientes.error && <Aviso>{recientes.error}</Aviso>}
    </>
  )
}

// ---------- Formulario de lectura ----------

/** Momento que corresponde: la planilla pide dos lecturas por día (inicio y fin; en el buffet inicial e intermedia). */
function momentoSugerido(m: Maquina, deHoy: Lectura[] | null): Momento {
  // Hornos, amasadoras…: no tienen control diario de temperatura; se reporta cuando pasa algo.
  if (!tieneRango(m)) return 'otro'
  if (esBuffet(m)) return deHoy?.some((l) => l.momento === 'inicial') ? 'intermedia' : 'inicial'
  if (!deHoy) return horaPY() < 12 ? 'inicio' : 'fin'
  const hay = (x: Momento) => deHoy.some((l) => l.momento === x)
  return !hay('inicio') ? 'inicio' : !hay('fin') ? 'fin' : 'otro'
}

/** Deja solo dígitos y una coma o punto decimal. */
function limpiarNumero(v: string): string {
  const s = v.replace(/[^\d.,]/g, '').replace(/\./g, ',')
  const [entero, ...resto] = s.split(',')
  return (resto.length ? `${entero},${resto.join('').slice(0, 1)}` : entero).slice(0, 5)
}

const ESTADOS: EstadoMaquina[] = ['funciona', 'con_fallas', 'fuera_de_servicio']

function Formulario({ maquina, deHoy }: { maquina: Maquina; deHoy: Lectura[] | null }) {
  const pideTemp = tieneRango(maquina)
  const momentos: Momento[] = esBuffet(maquina) ? ['inicial', 'intermedia', 'otro'] : ['inicio', 'fin', 'otro']
  const [momentoElegido, setMomento] = useState<Momento | null>(null)
  const [estado, setEstado] = useState<EstadoMaquina>('funciona')
  const [temp, setTemp] = useState('')
  // Freezers: lo normal es bajo cero (y el teclado decimal del iPhone no tiene el signo menos).
  const [negativo, setNegativo] = useState(maquina.tempMax !== null && maquina.tempMax <= 0)
  const [obs, setObs] = useState('')
  const [mant, setMant] = useState(false)
  const [mantDesc, setMantDesc] = useState('')
  const [mantPor, setMantPor] = useState('')
  const [foto, setFoto] = useState<string | null>(null)
  const [achicando, setAchicando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<Lectura | null>(null)
  const guardarLectura = useAccion((p: PedidoLectura) => post<Lectura>('/lecturas', p))

  const momento = momentoElegido ?? momentoSugerido(maquina, deHoy)
  const numero = temp === '' ? null : Number(temp.replace(',', '.'))
  const t = numero === null || Number.isNaN(numero) ? null : negativo ? -numero : numero
  const fuera = fueraDeRango(maquina, t)
  const enviando = guardarLectura.enviando

  const tocar = () => {
    setError(null)
    setListo(null)
    guardarLectura.limpiarError()
  }

  const cambiarTemp = (v: string) => {
    tocar()
    if (/[-−]/.test(v)) setNegativo(true)
    else if (v.includes('+')) setNegativo(false)
    setTemp(limpiarNumero(v))
  }

  const guardar = async () => {
    tocar()
    if (temp !== '' && t === null) return setError('Revisá la temperatura: tiene que ser un número.')
    if (pideTemp && t === null && estado !== 'fuera_de_servicio') {
      return setError('Cargá la temperatura actual: en esta máquina es obligatoria.')
    }
    if (estado !== 'funciona' && !obs.trim()) return setError('Contá en la observación qué le pasa a la máquina.')
    if (mant && !mantDesc.trim()) return setError('Contá qué mantenimiento se hizo.')
    const r = await guardarLectura.ejecutar({
      maquinaId: maquina.id,
      momento,
      estado,
      temperatura: t,
      observacion: obs.trim(),
      mantenimiento: mant ? mantDesc.trim() : null,
      mantenimientoPor: mant ? mantPor.trim() || null : null,
      foto,
    })
    if (!r) return
    setListo(r)
    setMomento(null)
    setEstado('funciona')
    setTemp('')
    setObs('')
    setMant(false)
    setMantDesc('')
    setMantPor('')
    setFoto(null)
  }

  return (
    <div className="tarjeta">
      <p className="suave ctl-rango">
        {pideTemp ? <>Rango aceptable: <strong>{textoRango(maquina)}</strong></> : 'Sin control de temperatura'}
      </p>

      <div className="campo">
        <span>Momento de la lectura</span>
        <div className="segmentado ctl-sin-margen" role="group" aria-label="Momento de la lectura">
          {momentos.map((m) => (
            <button key={m} type="button" className={momento === m ? 'activo' : ''} aria-pressed={momento === m} onClick={() => { tocar(); setMomento(m) }}>
              {NOMBRE_MOMENTO[m].replace(' (buffet)', '')}
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <span>Estado</span>
        <div className="segmentado ctl-sin-margen ctl-estados" role="group" aria-label="Estado">
          {ESTADOS.map((e) => (
            <button
              key={e} type="button" aria-pressed={estado === e}
              className={estado === e ? `activo ctl-estado-${e}` : ''}
              onClick={() => { tocar(); setEstado(e) }}
            >
              {NOMBRE_ESTADO[e]}
            </button>
          ))}
        </div>
      </div>

      {pideTemp && (
        <div className="campo">
          <label htmlFor="temperatura" className="ctl-etiqueta">
            Temperatura actual (°C){estado === 'fuera_de_servicio' ? ' · si no se puede medir, dejala vacía' : ' · obligatoria'}
          </label>
          <div className={fuera ? 'ctl-temp ctl-temp-fuera' : 'ctl-temp'}>
            <button
              type="button" className="ctl-signo" onClick={() => { tocar(); setNegativo((n) => !n) }}
              aria-label={negativo ? 'Bajo cero. Tocá para cambiar a positivo' : 'Positivo. Tocá para cambiar a bajo cero'}
            >
              {negativo ? '−' : '+'}
            </button>
            <input
              id="temperatura" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
              value={temp} onChange={(e) => cambiarTemp(e.target.value)} className={fuera ? 'rojo' : ''}
              aria-invalid={fuera}
            />
            <span className="ctl-unidad">°C</span>
          </div>
          {fuera && t !== null && (
            <p className="error ctl-aviso" role="alert">{grados(t)} está fuera de rango ({textoRango(maquina)}).</p>
          )}
        </div>
      )}

      <label className="campo">
        <span>Observación{estado === 'funciona' ? ' (opcional)' : ''}</span>
        <textarea
          rows={2} value={obs} maxLength={500} onChange={(e) => { tocar(); setObs(e.target.value) }}
          placeholder={estado === 'con_fallas' ? '¿Qué falla tiene?' : estado === 'fuera_de_servicio' ? '¿Qué pasó? ¿A quién se avisó?' : ''}
        />
      </label>

      <label className="check">
        <input type="checkbox" checked={mant} onChange={(e) => { tocar(); setMant(e.target.checked) }} /> Se hizo mantenimiento
      </label>
      {mant && (
        <>
          <label className="campo">
            <span>Qué se hizo</span>
            <textarea rows={2} maxLength={500} value={mantDesc} onChange={(e) => { tocar(); setMantDesc(e.target.value) }} placeholder="Limpieza, cambio de partes, verificación…" />
          </label>
          <label className="campo">
            <span>Lo hizo (empresa o persona)</span>
            <input value={mantPor} maxLength={120} onChange={(e) => { tocar(); setMantPor(e.target.value) }} />
          </label>
        </>
      )}

      <CampoFoto foto={foto} alCambiar={(f) => { tocar(); setFoto(f) }} alError={setError} alOcupado={setAchicando} />

      <Aviso>{error ?? guardarLectura.error}</Aviso>
      {listo && (
        listo.fueraDeRango ? (
          <p className="ctl-guardado-rojo" role="status">
            Guardado. Quedó marcado en rojo: {listo.temperatura !== null ? grados(listo.temperatura) : ''} está fuera de rango
            ({textoRango(maquina)}). Avisá al encargado.
          </p>
        ) : (
          <p className="ok" role="status">
            Lectura guardada{listo.temperatura !== null ? `: ${grados(listo.temperatura)}` : ''} · {NOMBRE_ESTADO[listo.estado]}.
          </p>
        )
      )}
      <button className="btn-primario" onClick={() => void guardar()} disabled={enviando || achicando}>
        {enviando ? 'Guardando…' : 'Guardar reporte'}
      </button>
    </div>
  )
}

// ---------- Fallas e incidencias ----------

const TIPOS_INCIDENCIA: TipoIncidencia[] = ['falla', 'incidencia']

/** Las fallas e incidencias de la máquina (abiertas primero) y, para el supervisor y el administrador, el formulario. */
function Incidencias({ maquina, reportar }: { maquina: Maquina; reportar: boolean }) {
  const lista = useConsulta<Incidencia[]>('/incidencias', { sector: maquina.sector, maquina: maquina.id })
  const [tipo, setTipo] = useState<TipoIncidencia>('falla')
  const [descripcion, setDescripcion] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const crear = useAccion((p: PedidoIncidencia) => post<Incidencia>('/incidencias', p))
  const resolver = useAccion((id: string, resolucion: string) => post<Incidencia>(`/incidencias/${id}/resolver`, { resolucion }))
  const [resolviendo, setResolviendo] = useState<string | null>(null)
  const [resolucion, setResolucion] = useState('')

  const guardar = async () => {
    setAviso(null)
    setListo(null)
    if (!descripcion.trim()) return setAviso('Contá qué pasó.')
    const r = await crear.ejecutar({ maquinaId: maquina.id, tipo, descripcion: descripcion.trim() })
    if (r) {
      setListo(`${NOMBRE_TIPO_INCIDENCIA[r.tipo]} reportada. Queda abierta hasta que alguien la marque como resuelta.`)
      setDescripcion('')
    }
  }
  const marcarResuelta = async (id: string) => {
    if (await resolver.ejecutar(id, resolucion.trim())) {
      setResolviendo(null)
      setResolucion('')
    }
  }

  const ordenadas = [...(lista.datos ?? [])].sort((a, b) => Number(!!a.resueltaEn) - Number(!!b.resueltaEn))
  if (!reportar && lista.datos && lista.datos.length === 0) return null
  return (
    <>
      <h2>Fallas e incidencias</h2>
      {reportar && (
        <div className="tarjeta">
          <div className="segmentado ctl-sin-margen" role="group" aria-label="Tipo">
            {TIPOS_INCIDENCIA.map((t) => (
              <button key={t} type="button" className={tipo === t ? 'activo' : ''} aria-pressed={tipo === t} onClick={() => setTipo(t)}>
                {NOMBRE_TIPO_INCIDENCIA[t]}
              </button>
            ))}
          </div>
          <label className="campo">
            <span>Qué pasó</span>
            <textarea value={descripcion} maxLength={500} rows={3} onChange={(e) => setDescripcion(e.target.value)}
              placeholder={tipo === 'falla' ? 'Ej.: no enfría, hace ruido, pierde agua' : 'Ej.: puerta mal cerrada, burlete roto'} />
          </label>
          <Aviso>{aviso ?? crear.error}</Aviso>
          {listo && <p className="ok" role="status">{listo}</p>}
          <button className="btn-primario" onClick={() => void guardar()} disabled={crear.enviando}>
            {crear.enviando ? 'Guardando…' : `Reportar ${NOMBRE_TIPO_INCIDENCIA[tipo].toLowerCase()}`}
          </button>
        </div>
      )}
      <ConDatos consulta={lista}>
        {() => ordenadas.length === 0 ? (
          <p className="suave">Esta máquina no tiene fallas ni incidencias reportadas.</p>
        ) : (
          <div className="lista">
            {ordenadas.map((i) => (
              <div key={i.id} className={i.resueltaEn ? 'tarjeta' : 'tarjeta fila-roja'}>
                <strong>{NOMBRE_TIPO_INCIDENCIA[i.tipo]}{i.resueltaEn ? ' · resuelta' : ' · sin resolver'}</strong>
                <div>{i.descripcion}</div>
                <div className="suave chico">{fechaHoraPY(i.fecha)} · {i.usuarioNombre}</div>
                {i.resueltaEn && (
                  <div className="suave chico">
                    Resuelta el {fechaHoraPY(i.resueltaEn)} por {i.resueltaPorNombre}{i.resolucion ? `: ${i.resolucion}` : ''}
                  </div>
                )}
                {reportar && !i.resueltaEn && (resolviendo === i.id ? (
                  <>
                    <label className="campo">
                      <span>Qué se hizo (opcional)</span>
                      <input value={resolucion} maxLength={500} onChange={(e) => setResolucion(e.target.value)} />
                    </label>
                    <Aviso>{resolver.error}</Aviso>
                    <button className="btn-primario" onClick={() => void marcarResuelta(i.id)} disabled={resolver.enviando}>
                      {resolver.enviando ? 'Guardando…' : 'Marcar como resuelta'}
                    </button>
                    <BotonIcono icono="cancelar" texto="Cancelar" onClick={() => setResolviendo(null)} />
                  </>
                ) : (
                  <BotonIcono icono="check" texto="Marcar como resuelta" tono="positivo" onClick={() => { resolver.limpiarError(); setResolucion(''); setResolviendo(i.id) }} />
                ))}
              </div>
            ))}
          </div>
        )}
      </ConDatos>
    </>
  )
}

// ---------- Historial de la máquina (F05) ----------

function Historial({ maquina }: { maquina: Maquina }) {
  const hoy = diaPY()
  const [dias, setDias] = useState(30)
  const lecturas = useConsulta<Lectura[]>('/lecturas', { sector: maquina.sector, maquina: maquina.id, desde: sumarDias(hoy, -dias) })
  return (
    <>
      <h2>Historial</h2>
      <ConDatos consulta={lecturas}>
        {(lista) => (
          <>
            {lista.length === 0 ? (
              <p className="suave">Sin lecturas en los últimos {dias} días.</p>
            ) : (
              <TablaLecturas lecturas={lista} />
            )}
            <BotonIcono icono="historial" texto="Ver lecturas más viejas" onClick={() => setDias((d) => d + 60)} />
          </>
        )}
      </ConDatos>
    </>
  )
}

/** Tabla de lecturas: fecha y usuario, temperatura (roja si quedó fuera de rango), estado, observación y foto. */
export function TablaLecturas({ lecturas, conMaquina = false, nombreSector }: {
  lecturas: Lectura[]
  /** Muestra la máquina (y el sector) en la primera columna, para listados de varias máquinas. */
  conMaquina?: boolean
  nombreSector?: (s: SectorId) => string
}) {
  return (
    <table className="tabla ctl-tabla">
      <thead>
        <tr>
          <th>{conMaquina ? 'Fecha y máquina' : 'Fecha'}</th>
          <th className="num">T°</th>
          <th>Estado y observación</th>
        </tr>
      </thead>
      <tbody>
        {lecturas.map((l) => {
          const alerta = l.fueraDeRango || l.estado !== 'funciona'
          return (
            <tr key={l.id} className={alerta ? 'fila-roja' : ''}>
              <td>
                {fechaHoraPY(l.fecha)}
                {conMaquina && (
                  <div className="ctl-maquina">
                    N° {l.maquinaNumero} · {l.maquinaNombre}
                    {nombreSector && <span className="suave"> · {nombreSector(l.sector)}</span>}
                  </div>
                )}
                <div className="suave chico">{l.usuarioNombre}</div>
              </td>
              <td className="num">
                {l.temperatura === null ? '—' : <strong className={l.fueraDeRango ? 'ctl-temp-roja' : ''}>{grados(l.temperatura)}</strong>}
                {l.fueraDeRango && <div className="chico">fuera de rango</div>}
              </td>
              <td>
                <span className={l.estado === 'funciona' ? '' : 'ctl-estado-mal'}>{NOMBRE_ESTADO[l.estado]}</span>
                <span className="suave chico"> · {NOMBRE_MOMENTO[l.momento]}</span>
                {l.observacion && <div className="chico">{l.observacion}</div>}
                {l.mantenimiento && (
                  <div className="chico">Mantenimiento: {l.mantenimiento}{l.mantenimientoPor ? ` (${l.mantenimientoPor})` : ''}</div>
                )}
                {l.tieneFoto && <FotoLectura lecturaId={l.id} />}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
