// F01–F05: el operador elige una máquina de su sector y carga estado, temperatura (obligatoria en los
// equipos fríos y calientes), observación, mantenimiento y una foto opcional. Debajo, el historial de la
// máquina con la temperatura en rojo cuando quedó fuera de rango.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { CampoFoto, FotoBajoDemanda } from '../../components/Foto'
import { useSector } from '../../components/Layout'
import { IconoMaquinas } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaPY, fechaHoraPY, horaPY, sumarDias } from '../../shared/hora'
import {
  NOMBRE_ESTADO, NOMBRE_MOMENTO,
  type EstadoMaquina, type Lectura, type Maquina, type Momento, type PedidoLectura, type SectorId,
} from '../../shared/tipos'
import '../../styles/controles.css'

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
  const hoy = diaPY()
  const maquinas = useConsulta<Maquina[]>('/maquinas', { sector })
  const recientes = useConsulta<Lectura[]>('/lecturas', { sector, desde: sumarDias(hoy, -30) })
  const maquina = maquinas.datos?.find((m) => m.id === params.get('maquina'))

  if (maquina) {
    const deHoy = (recientes.datos ?? []).filter((l) => l.maquinaId === maquina.id && l.dia === hoy)
    return (
      <>
        <div className="titulo">
          <button className="volver" onClick={() => setParams({})} aria-label="Volver">‹</button>
          <h1>N° {maquina.numero} · {maquina.nombre}</h1>
        </div>
        <Formulario key={maquina.id} maquina={maquina} deHoy={recientes.datos ? deHoy : null} />
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
                return (
                  <button key={m.id} className={alerta ? 'item alerta' : 'item'} onClick={() => setParams({ maquina: m.id })}>
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
            <button className="btn-texto" onClick={() => setDias((d) => d + 60)}>Ver lecturas más viejas</button>
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
