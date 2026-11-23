// G01–G03: el operador elige un área de su sector y marca cada tarea de la planilla con X (diaria),
// XX (profunda) o - (no se hizo), como en las planillas RE-09: no se dejan cuadros en blanco.
// «Guardar limpieza» queda bloqueado hasta que cada tarea esté marcada (el servidor también lo exige).
// Una planilla mal cargada la anula el supervisor o el administrador, con un motivo.
// Fecha, hora, sector y usuario los pone el servidor; el comentario y la foto son opcionales (G06). Arriba
// avisa las áreas que no se limpiaron con la frecuencia mínima exigida (G08). Debajo, el historial
// del sector filtrable por área y fechas, con el "Controlado por" del administrador.
import { useState, type ReactNode } from 'react'
import { ErrorDeApi, post } from '../../cliente/api'
import { invalidar, useAccion, useConsulta } from '../../cliente/consultas'
import { usePuede } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { CampoFoto, FotoBajoDemanda } from '../../components/Foto'
import { useSectorActivo } from '../../components/Layout'
import { IconoLimpieza } from '../../components/Iconos'
import Volver from '../../components/Volver'
import type { Alerta } from '../../shared/alertas'
import { diaPY, fechaHoraPY, sumarDias } from '../../shared/hora'
import {
  NOMBRE_MARCA,
  type AreaLimpieza, type Limpieza, type Marca, type PedidoLimpieza, type SectorId, type TareaLimpieza,
} from '../../shared/tipos'
import '../../styles/controles.css'

export const MARCAS: Marca[] = ['X', 'XX', '-']

/** Clase de color de cada marca (la misma de los botones de la planilla). */
export const claseMarca = (m: Marca) => `marca-${m === '-' ? 'no' : m}`

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// ---------- Reporte guardado (historial y controles del administrador) ----------

/** Un reporte de limpieza: cuándo, quién, cuántas tareas de cada marca, lo que no se hizo y el control. */
export function TarjetaLimpieza({ l, nombreSector, accion }: { l: Limpieza; nombreSector: string; accion?: ReactNode }) {
  const cuenta = (m: Marca) => l.marcas.filter((x) => x.marca === m).length
  const noHechas = l.marcas.filter((x) => x.marca === '-')
  const conNumero = l.marcas.filter((x) => x.numero)
  const puede = usePuede()
  const clase = l.anuladaEn ? 'tarjeta ctl-limpieza ctl-anulada' : l.controladoPor ? 'tarjeta ctl-limpieza' : 'tarjeta ctl-limpieza ctl-sin-controlar'
  return (
    <article className={clase}>
      <div className="cabeza">
        <h3>{l.areaNombre}{l.anuladaEn && <span className="ctl-etiqueta-anulada">Anulada</span>}</h3>
        <span className="suave chico">{fechaHoraPY(l.fecha)}</span>
      </div>
      <p className="suave chico">{nombreSector} · {l.usuarioNombre}</p>
      <div className="ctl-cuentas">
        {MARCAS.filter((m) => cuenta(m) > 0).map((m) => (
          <span key={m} className={`ctl-cuenta ${claseMarca(m)}`}>{m} {NOMBRE_MARCA[m]}: {cuenta(m)}</span>
        ))}
      </div>
      {noHechas.length > 0 && noHechas.length < l.marcas.length && (
        <p className="chico ctl-no-hechas">No se hizo: {noHechas.map((x) => x.tareaNombre).join(', ')}</p>
      )}
      {conNumero.length > 0 && (
        <p className="chico">N° de equipo: {conNumero.map((x) => `${x.tareaNombre} ${x.numero}`).join(' · ')}</p>
      )}
      {l.comentario && <p className="chico ctl-comentario">“{l.comentario}”</p>}
      {l.tieneFoto && <FotoBajoDemanda ruta={`/limpiezas/${l.id}/foto`} alt="Foto de la limpieza" />}
      <details className="ctl-detalle chico">
        <summary>Ver la planilla completa ({plural(l.marcas.length, 'tarea', 'tareas')})</summary>
        <ul>
          {l.marcas.map((x) => (
            <li key={x.tareaId} className={x.marca === '-' ? 'marca-no' : ''}>
              <b aria-label={NOMBRE_MARCA[x.marca]}>{x.marca}</b>
              <span>{x.tareaNombre}{x.numero ? ` · N° ${x.numero}` : ''}</span>
            </li>
          ))}
        </ul>
      </details>
      {l.controladoPor && (
        <p className="ctl-controlado">✓ Controlado por {l.controladoPorNombre} el {fechaHoraPY(l.controladoEn ?? l.fecha)}</p>
      )}
      {l.anuladaEn ? (
        <p className="ctl-anulada-texto">
          Anulada por {l.anuladaPorNombre} el {fechaHoraPY(l.anuladaEn)}{l.motivoAnulacion ? `: «${l.motivoAnulacion}»` : ''}.
          {' '}No cuenta para el visto bueno ni para los reportes.
        </p>
      ) : (
        <>
          {!l.controladoPor && !accion && <p className="ctl-pendiente">Sin controlar todavía</p>}
          {accion}
          {puede('limpieza.controlar') && <AnularLimpieza l={l} />}
        </>
      )}
    </article>
  )
}

/** Planilla mal cargada: el supervisor o el administrador la anula con un motivo. Confirmación en la misma tarjeta. */
function AnularLimpieza({ l }: { l: Limpieza }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const anular = useAccion(async (m: string) => {
    try {
      return await post<Limpieza>(`/limpiezas/${l.id}/anular`, { motivo: m })
    } catch (e) {
      // Ya la anuló otra persona: se recarga para mostrar quién.
      if (e instanceof ErrorDeApi && e.codigo === 'ya_anulada') invalidar()
      throw e
    }
  })
  if (!abierto) {
    return (
      <button type="button" className="btn-discreto chico rojo ctl-anular" onClick={() => setAbierto(true)}>
        Anular planilla mal cargada
      </button>
    )
  }
  return (
    <div className="tarjeta ctl-confirmar" role="group" aria-label={`Anular la limpieza de ${l.areaNombre}`}>
      <p>
        La planilla queda en el historial como anulada y deja de contar. Después el sector la vuelve a cargar bien.
      </p>
      <label className="campo">
        <span>Motivo</span>
        <input
          autoFocus maxLength={300} value={motivo} placeholder="Ej.: se guardó todo como «-» por error"
          onChange={(e) => { anular.limpiarError(); setMotivo(e.target.value) }}
        />
      </label>
      {anular.error && <p className="error" role="alert">{anular.error}</p>}
      <div className="fila-acciones">
        <button
          type="button" className="btn-primario" disabled={anular.enviando || !motivo.trim()}
          onClick={() => void anular.ejecutar(motivo.trim())}
        >
          {anular.enviando ? 'Anulando…' : 'Anular planilla'}
        </button>
        <button type="button" className="btn-secundario" onClick={() => { setAbierto(false); setMotivo(''); anular.limpiarError() }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------- Pantalla ----------

interface Borrador {
  marcas: Record<string, Marca>
  numeros: Record<string, string>
  comentario: string
  foto: string | null
}

const VACIO: Borrador = { marcas: {}, numeros: {}, comentario: '', foto: null }

export default function LimpiezaPage() {
  const sector = useSectorActivo()
  // Al cambiar de sector (administrador) todo empieza de cero.
  return <Pantalla key={sector.id} sector={sector.id} nombreSector={sector.nombre} />
}

function Pantalla({ sector, nombreSector }: { sector: SectorId; nombreSector: string }) {
  const areas = useConsulta<AreaLimpieza[]>('/areas', { sector })
  const [areaId, setAreaId] = useState<string | null>(null)
  // Lo marcado en cada área se conserva si el operador cambia de área sin guardar.
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})

  return (
    <>
      <Volver titulo="Limpieza y desinfección" icono={<IconoLimpieza />} />
      <AlertasLimpieza sector={sector} />
      <ConDatos consulta={areas}>
        {(lista) => {
          if (lista.length === 0) {
            return <p className="suave">Este sector no tiene áreas de limpieza cargadas.</p>
          }
          const area = lista.find((a) => a.id === areaId) ?? lista[0]
          const empezadas = (id: string) => Object.keys(borradores[id]?.marcas ?? {}).length > 0
          return (
            <>
              <div className="chips ctl-areas" role="group" aria-label="Área a reportar">
                {lista.map((a) => (
                  <button
                    key={a.id} type="button" aria-pressed={a.id === area.id}
                    className={a.id === area.id ? 'chip activo' : 'chip'} onClick={() => setAreaId(a.id)}
                  >
                    {a.nombre}{a.id !== area.id && empezadas(a.id) ? ' •' : ''}
                  </button>
                ))}
              </div>
              <Planilla
                key={area.id} area={area} sector={sector}
                borrador={borradores[area.id] ?? VACIO}
                cambiar={(f) => setBorradores((b) => ({ ...b, [area.id]: f(b[area.id] ?? VACIO) }))}
              />
            </>
          )
        }}
      </ConDatos>
      <HistorialLimpiezas sector={sector} nombreSector={nombreSector} areas={areas.datos ?? []} />
      <div className="ctl-espacio" aria-hidden="true" />
    </>
  )
}

// ---------- Áreas atrasadas (G08) ----------

function AlertasLimpieza({ sector }: { sector: SectorId }) {
  const alertas = useConsulta<Alerta[]>('/limpieza/alertas', { sector })
  // Si no se pudo calcular, no estorba: la planilla se puede cargar igual.
  if (!alertas.datos?.length) return null
  return (
    <div className="ctl-alertas" role="region" aria-label="Limpiezas atrasadas">
      {alertas.datos.map((a) => <p key={a.texto} className="ctl-alerta">{a.texto}</p>)}
    </div>
  )
}

// ---------- Planilla del área (G01, G02) ----------

function Planilla({ area, sector, borrador, cambiar }: {
  area: AreaLimpieza
  sector: SectorId
  borrador: Borrador
  cambiar: (f: (b: Borrador) => Borrador) => void
}) {
  const guardarLimpieza = useAccion((p: PedidoLimpieza) => post<Limpieza>('/limpiezas', p))
  // Al tocar «Guardar» con tareas sin marcar, se pintan las que faltan.
  const [resaltar, setResaltar] = useState(false)
  const [listo, setListo] = useState<Limpieza | null>(null)
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  const [preparandoFoto, setPreparandoFoto] = useState(false)
  const tareas = area.tareas.filter((t) => t.activo)
  const faltan = tareas.filter((t) => !borrador.marcas[t.id])
  const marcadas = tareas.length - faltan.length

  const tocar = () => {
    setListo(null)
    setErrorFoto(null)
    guardarLimpieza.limpiarError()
  }
  const marcar = (t: TareaLimpieza, m: Marca) => {
    tocar()
    cambiar((b) => ({ ...b, marcas: { ...b.marcas, [t.id]: m } }))
  }
  const marcarTodo = (m: Marca) => {
    tocar()
    cambiar((b) => ({ ...b, marcas: Object.fromEntries(tareas.map((t) => [t.id, m])) }))
  }

  const enviar = async () => {
    const r = await guardarLimpieza.ejecutar({
      areaId: area.id,
      sector,
      marcas: tareas.map((t) => {
        const marca = borrador.marcas[t.id]
        const numero = t.pideNumero && marca !== '-' ? borrador.numeros[t.id]?.trim() || null : null
        return { tareaId: t.id, marca, numero }
      }),
      comentario: borrador.comentario.trim(),
      foto: borrador.foto,
    })
    if (!r) return
    setListo(r)
    setResaltar(false)
    cambiar(() => VACIO)
  }

  const guardar = () => {
    tocar()
    // Como en la planilla en papel: no se guarda con cuadros en blanco. Se muestran las que faltan.
    if (faltan.length) {
      setResaltar(true)
      document.getElementById(`tarea-${faltan[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    void enviar()
  }

  if (tareas.length === 0) return <p className="suave">Esta área no tiene tareas para marcar.</p>

  const enviando = guardarLimpieza.enviando
  const mensaje = errorFoto ?? guardarLimpieza.error
  return (
    <>
      <div className="ctl-progreso">
        <span className="suave chico">
          {area.codigo && <>{area.codigo} · </>}Marcadas <strong>{marcadas}</strong> de {tareas.length}
        </span>
        <span className="ctl-todo chico">
          <span className="suave">Marcar todo:</span>
          {MARCAS.map((m) => (
            <button key={m} type="button" className="btn-icono-accion btn-marca" title={`Marcar todo como ${NOMBRE_MARCA[m]}`} aria-label={`Marcar todo como ${NOMBRE_MARCA[m]}`} onClick={() => marcarTodo(m)}>{m}</button>
          ))}
        </span>
      </div>
      <div className="lista-limpieza">
        {tareas.map((t) => {
          const elegida = borrador.marcas[t.id]
          return (
            <div key={t.id} id={`tarea-${t.id}`} className={resaltar && !elegida ? 'fila-limpieza ctl-falta' : 'fila-limpieza'}>
              <span className="ctl-tarea">{t.nombre}</span>
              <div className="segmentado chico ctl-marcas" role="group" aria-label={t.nombre}>
                {MARCAS.map((m) => (
                  <button
                    key={m} type="button" aria-pressed={elegida === m} aria-label={`${t.nombre}: ${NOMBRE_MARCA[m]}`}
                    className={elegida === m ? `activo ${claseMarca(m)}` : ''} onClick={() => marcar(t, m)}
                  >
                    <strong>{m}</strong>
                    <small>{NOMBRE_MARCA[m]}</small>
                  </button>
                ))}
              </div>
              {t.pideNumero && elegida && elegida !== '-' && (
                <input
                  className="nro" placeholder="N° de equipo" aria-label={`N° de equipo de ${t.nombre}`} maxLength={30}
                  value={borrador.numeros[t.id] ?? ''}
                  onChange={(e) => {
                    tocar()
                    const v = e.target.value
                    cambiar((b) => ({ ...b, numeros: { ...b.numeros, [t.id]: v } }))
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      <label className="campo">
        <span>Comentario (opcional)</span>
        <textarea
          rows={2} maxLength={500} value={borrador.comentario}
          onChange={(e) => {
            tocar()
            const v = e.target.value
            cambiar((b) => ({ ...b, comentario: v }))
          }}
        />
      </label>
      <CampoFoto
        foto={borrador.foto}
        alCambiar={(f) => { tocar(); cambiar((b) => ({ ...b, foto: f })) }}
        alError={setErrorFoto}
        alOcupado={setPreparandoFoto}
      />
      <div className="accion-fija">
        <div className="ctl-barra">
          {faltan.length > 0 && (
            <p id="ctl-faltan" className={resaltar ? 'ctl-faltan-aviso error' : 'ctl-faltan-aviso suave'} role={resaltar ? 'alert' : undefined}>
              {faltan.length === 1
                ? 'Falta marcar 1 tarea con X, XX o - para poder guardar.'
                : `Faltan marcar ${faltan.length} tareas con X, XX o - para poder guardar.`}
            </p>
          )}
          {mensaje && <p className="error" role="alert">{mensaje}</p>}
          {listo && (
            <p className="ok" role="status">
              Limpieza de {listo.areaNombre} guardada · {fechaHoraPY(listo.fecha)}.
            </p>
          )}
          {/* Bloqueado (gris) mientras falten tareas; tocarlo igual muestra cuáles faltan. */}
          <button
            className={faltan.length ? 'btn-primario ctl-bloqueado' : 'btn-primario'} onClick={() => void guardar()}
            disabled={enviando || preparandoFoto} aria-disabled={faltan.length > 0} aria-describedby={faltan.length ? 'ctl-faltan' : undefined}
          >
            {enviando ? 'Guardando…' : 'Guardar limpieza'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------- Historial del sector (G03) ----------

function HistorialLimpiezas({ sector, nombreSector, areas }: { sector: SectorId; nombreSector: string; areas: AreaLimpieza[] }) {
  const hoy = diaPY()
  const [area, setArea] = useState('')
  const [desde, setDesde] = useState(() => sumarDias(hoy, -6))
  const [hasta, setHasta] = useState(hoy)
  const rangoMal = !!desde && !!hasta && desde > hasta
  const consulta = useConsulta<Limpieza[]>(rangoMal ? null : '/limpiezas', { sector, area, desde, hasta })

  return (
    <section aria-labelledby="historial-limpieza">
      <h2 id="historial-limpieza">Reportes anteriores</h2>
      <div className="tarjeta ctl-filtros">
        <label className="campo ctl-ancho">
          <span>Área</span>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      {rangoMal ? (
        <Aviso>La fecha desde no puede ser posterior a la fecha hasta.</Aviso>
      ) : (
        <ConDatos consulta={consulta}>
          {(lista) =>
            lista.length === 0 ? (
              <p className="suave">No hay limpiezas cargadas con esos filtros.</p>
            ) : (
              <>
                <p className="suave chico ctl-resumen">
                  {plural(lista.length, 'reporte', 'reportes')}
                  {' · '}
                  {plural(lista.filter((l) => !l.controladoPor).length, 'sin controlar', 'sin controlar')}
                </p>
                {lista.map((l) => <TarjetaLimpieza key={l.id} l={l} nombreSector={nombreSector} />)}
              </>
            )
          }
        </ConDatos>
      )}
    </section>
  )
}
