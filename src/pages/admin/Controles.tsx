// G03 y F04–F05 para el administrador: limpiezas del sector elegido arriba (o de todos) con el
// "Controlado por" de la planilla en papel, y las lecturas de máquinas con las temperaturas fuera de
// rango y las fallas en rojo. Filtros por sector y fechas.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorDeApi, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { invalidar, useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import { diaPY, fechaHoraPY, inicioDeMes, sumarDias } from '../../shared/hora'
import type { Lectura, Limpieza, SectorId } from '../../shared/tipos'
import { TarjetaLimpieza } from '../sector/Limpieza'
import { TablaLecturas } from '../sector/Maquinas'
import '../../styles/controles.css'

type Vista = 'limpieza' | 'temperaturas'
type Rango = 'hoy' | 'semana' | 'mes'

function rango(r: Rango, hoy: string): [string, string] {
  if (r === 'hoy') return [hoy, hoy]
  if (r === 'semana') return [sumarDias(hoy, -6), hoy]
  return [inicioDeMes(hoy), hoy]
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export type FiltroControles = {
  sector: SectorId | undefined
  desde: string
  hasta: string
}

export default function Controles() {
  const sector = useSectorActivo()
  const sectores = useSectores()
  const [params, setParams] = useSearchParams()
  const vista: Vista = params.get('ver') === 'temperaturas' ? 'temperaturas' : 'limpieza'
  const hoy = diaPY()
  const [todos, setTodos] = useState(false)
  const [desde, setDesde] = useState(() => rango('semana', hoy)[0])
  const [hasta, setHasta] = useState(hoy)
  const rangoMal = !!desde && !!hasta && desde > hasta
  const filtro: FiltroControles = { sector: todos ? undefined : sector.id, desde, hasta }

  const elegido = (['hoy', 'semana', 'mes'] as Rango[]).find((r) => {
    const [d, h] = rango(r, hoy)
    return d === desde && h === hasta
  })

  return (
    <>
      <h1>Limpieza y temperatura</h1>
      <div className="segmentado" role="group" aria-label="Qué controlar">
        {([['limpieza', 'Limpieza'], ['temperaturas', 'Temperaturas y máquinas']] as [Vista, string][]).map(([v, t]) => (
          <button
            key={v} type="button" aria-pressed={vista === v} className={vista === v ? 'activo' : ''}
            onClick={() => setParams(v === 'limpieza' ? {} : { ver: v }, { replace: true })}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="tarjeta ctl-filtros ctl-cuatro">
        <div className="campo ctl-ancho">
          <span>Sector</span>
          <div className="segmentado chico" role="group" aria-label="Sector">
            <button type="button" aria-pressed={!todos} className={!todos ? 'activo' : ''} onClick={() => setTodos(false)}>
              {sector.nombre || 'Sector elegido'}
            </button>
            <button type="button" aria-pressed={todos} className={todos ? 'activo' : ''} onClick={() => setTodos(true)}>
              Todos los sectores
            </button>
          </div>
        </div>
        <div className="campo ctl-ancho">
          <span>Período</span>
          <div className="segmentado chico" role="group" aria-label="Período">
            {([['hoy', 'Hoy'], ['semana', '7 días'], ['mes', 'Este mes']] as [Rango, string][]).map(([r, t]) => (
              <button
                key={r} type="button" aria-pressed={elegido === r} className={elegido === r ? 'activo' : ''}
                onClick={() => {
                  const [d, h] = rango(r, hoy)
                  setDesde(d)
                  setHasta(h)
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>

      {rangoMal ? (
        <Aviso>La fecha desde no puede ser posterior a la fecha hasta.</Aviso>
      ) : vista === 'limpieza' ? (
        <ControlLimpiezas filtro={filtro} nombreSector={sectores.nombre} />
      ) : (
        <ControlTemperaturas filtro={filtro} nombreSector={todos ? sectores.nombre : undefined} />
      )}
    </>
  )
}

// ---------- Limpiezas: "Controlado por" ----------

function ControlLimpiezas({ filtro, nombreSector }: { filtro: FiltroControles; nombreSector: (s: SectorId) => string }) {
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [hecho, setHecho] = useState<string | null>(null)
  const consulta = useConsulta<Limpieza[]>('/limpiezas', { ...filtro })
  const alControlar = (l: Limpieza) =>
    setHecho(`Controlaste ${l.areaNombre} (${nombreSector(l.sector)}) del ${fechaHoraPY(l.fecha)}.`)

  return (
    <ConDatos consulta={consulta}>
      {(todas) => {
        const pendientes = todas.filter((l) => !l.controladoPor)
        const lista = soloPendientes ? pendientes : todas
        return (
          <>
            <div className="segmentado chico" role="group" aria-label="Qué limpiezas ver">
              <button type="button" aria-pressed={soloPendientes} className={soloPendientes ? 'activo' : ''} onClick={() => setSoloPendientes(true)}>
                Sin controlar ({pendientes.length})
              </button>
              <button type="button" aria-pressed={!soloPendientes} className={!soloPendientes ? 'activo' : ''} onClick={() => setSoloPendientes(false)}>
                Todas ({todas.length})
              </button>
            </div>
            <Aviso tipo="ok">{hecho}</Aviso>
            {soloPendientes && pendientes.length > 1 && (
              <ControlarTodas
                lista={pendientes}
                alTerminar={(n) => setHecho(n === 1 ? 'Controlaste 1 limpieza.' : `Controlaste ${n} limpiezas.`)}
              />
            )}
            {lista.length === 0 ? (
              <p className="suave">
                {soloPendientes && todas.length > 0
                  ? 'Todas las limpiezas de estas fechas ya están controladas.'
                  : 'No hay limpiezas cargadas en estas fechas.'}
              </p>
            ) : (
              <>
                <p className="suave chico ctl-resumen">
                  {plural(lista.length, 'reporte', 'reportes')}
                  {' · '}
                  {plural(lista.reduce((s, l) => s + l.marcas.filter((m) => m.marca === '-').length, 0), 'tarea sin hacer', 'tareas sin hacer')}
                </p>
                {lista.map((l) => (
                  <TarjetaLimpieza
                    key={l.id} l={l} nombreSector={nombreSector(l.sector)}
                    accion={l.controladoPor ? undefined : <BotonControlar l={l} alControlar={alControlar} />}
                  />
                ))}
              </>
            )}
          </>
        )
      }}
    </ConDatos>
  )
}

function BotonControlar({ l, alControlar }: { l: Limpieza; alControlar: (l: Limpieza) => void }) {
  const controlar = useAccion(async () => {
    try {
      return await post<Limpieza>(`/limpiezas/${l.id}/control`)
    } catch (e) {
      // Ya la controló otra persona: se recarga para mostrar quién.
      if (e instanceof ErrorDeApi && e.codigo === 'ya_controlada') invalidar()
      throw e
    }
  })
  return (
    <>
      <Aviso>{controlar.error}</Aviso>
      <button
        type="button" className="btn-secundario" disabled={controlar.enviando}
        onClick={async () => {
          const r = await controlar.ejecutar()
          if (r) alControlar(r)
        }}
      >
        {controlar.enviando ? 'Guardando…' : 'Controlar'}
      </button>
    </>
  )
}

/** Visto bueno a todas las limpiezas pendientes de la lista, con confirmación en la misma pantalla. */
function ControlarTodas({ lista, alTerminar }: { lista: Limpieza[]; alTerminar: (n: number) => void }) {
  const [confirmar, setConfirmar] = useState(false)
  const controlar = useAccion(async (ids: string[]) => {
    let n = 0
    try {
      for (const id of ids) {
        try {
          await post<Limpieza>(`/limpiezas/${id}/control`)
          n++
        } catch (e) {
          // Si otra persona la controló mientras tanto, se sigue con las demás.
          if (!(e instanceof ErrorDeApi && e.codigo === 'ya_controlada')) throw e
        }
      }
    } catch (e) {
      // Las que ya se controlaron quedan: se recarga la lista para mostrarlo.
      invalidar()
      throw e
    }
    return n
  })
  const n = lista.length

  if (!confirmar) {
    return (
      <div className="fila-acciones">
        <button type="button" className="btn-texto" onClick={() => setConfirmar(true)}>Controlar las {n} de la lista</button>
      </div>
    )
  }
  return (
    <div className="tarjeta ctl-confirmar">
      <p>
        ¿Das el visto bueno a las <strong>{n} limpiezas</strong> sin controlar de la lista?
      </p>
      <Aviso>{controlar.error}</Aviso>
      <div className="fila-acciones">
        <button
          type="button" className="btn-primario" disabled={controlar.enviando}
          onClick={async () => {
            const r = await controlar.ejecutar(lista.map((l) => l.id))
            if (r !== undefined) {
              setConfirmar(false)
              alTerminar(r)
            }
          }}
        >
          {controlar.enviando ? 'Guardando…' : `Sí, controlar las ${n}`}
        </button>
        <button type="button" className="btn-texto" disabled={controlar.enviando} onClick={() => setConfirmar(false)}>Cancelar</button>
      </div>
    </div>
  )
}

// ---------- Temperaturas y estado de las máquinas ----------

const conProblema = (l: Lectura) => l.fueraDeRango || l.estado !== 'funciona'

function ControlTemperaturas({ filtro, nombreSector }: { filtro: FiltroControles; nombreSector?: (s: SectorId) => string }) {
  const [soloProblemas, setSoloProblemas] = useState(true)
  const consulta = useConsulta<Lectura[]>('/lecturas', { ...filtro })

  return (
    <ConDatos consulta={consulta}>
      {(todas) => {
        const problemas = todas.filter(conProblema)
        const fuera = todas.filter((l) => l.fueraDeRango).length
        const fallas = todas.filter((l) => l.estado !== 'funciona').length
        const lista = soloProblemas ? problemas : todas
        return (
          <>
            <div className="segmentado chico" role="group" aria-label="Qué lecturas ver">
              <button type="button" aria-pressed={soloProblemas} className={soloProblemas ? 'activo' : ''} onClick={() => setSoloProblemas(true)}>
                Fuera de rango o con fallas ({problemas.length})
              </button>
              <button type="button" aria-pressed={!soloProblemas} className={!soloProblemas ? 'activo' : ''} onClick={() => setSoloProblemas(false)}>
                Todas ({todas.length})
              </button>
            </div>
            <p className="suave chico ctl-resumen">
              {plural(todas.length, 'lectura', 'lecturas')}
              {' · '}
              <span className={fuera ? 'rojo' : ''}>{plural(fuera, 'fuera de rango', 'fuera de rango')}</span>
              {' · '}
              <span className={fallas ? 'rojo' : ''}>{plural(fallas, 'con fallas o fuera de servicio', 'con fallas o fuera de servicio')}</span>
            </p>
            {lista.length === 0 ? (
              <p className="suave">
                {soloProblemas && todas.length > 0
                  ? 'Ninguna lectura de estas fechas quedó fuera de rango ni con fallas.'
                  : 'No hay lecturas cargadas en estas fechas.'}
              </p>
            ) : (
              <TablaLecturas lecturas={lista} conMaquina nombreSector={nombreSector} />
            )}
          </>
        )
      }}
    </ConDatos>
  )
}
