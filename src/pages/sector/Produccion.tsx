// C01–C03, E02–E04: el operador carga en un solo registro todo lo que produjo, con lo cocinado
// (o al horno) y lo guardado en frío (o al congelador). En Chipería elige los lotes de materia prima
// y el sistema le devuelve el código del lote de chipa.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, Cargando, ConDatos } from '../../components/Estado'
import { useSector, useSectorActivo } from '../../components/Layout'
import Numero from '../../components/Numero'
import { IconoProduccion } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { diaPY, fechaHoraPY, turnoActual } from '../../shared/hora'
import type { LoteMP, PedidoProduccion, Produccion as Registro, Producto, Turno } from '../../shared/tipos'
import '../../styles/produccion.css'

type Cantidades = Record<string, { cocinado: number; guardado: number }>

/** Etiquetas de las dos cantidades: Chipería habla de horno y congelador (E04). */
const etiquetas = (conLotes: boolean) =>
  conLotes
    ? { cocinado: 'Horno (venta)', guardado: 'Congelador', cocinadoCorto: 'al horno', guardadoCorto: 'al congelador' }
    : { cocinado: 'Cocinado', guardado: 'Guardado en frío', cocinadoCorto: 'cocinado', guardadoCorto: 'guardado' }

const NOMBRE_TURNO: Record<Turno, string> = { dia: 'Turno día', noche: 'Turno noche' }

export default function Produccion() {
  // Al cambiar de sector (administrador) el formulario empieza de cero.
  const sector = useSector()
  return <Formulario key={sector} />
}

function Formulario() {
  const { id: sector, conLotes } = useSectorActivo()
  const hoy = diaPY()
  const productos = useConsulta<Producto[]>('/productos', { sector })
  const lotes = useConsulta<LoteMP[]>(conLotes ? '/lotes-mp' : null, { disponibles: true })
  const deHoy = useConsulta<Registro[]>('/producciones', { sector, desde: hoy, hasta: hoy })

  const [turno, setTurno] = useState<Turno>(() => turnoActual())
  const [cant, setCant] = useState<Cantidades>({})
  const [lotesMP, setLotesMP] = useState<string[]>([])
  const [buscar, setBuscar] = useState('')
  const [listo, setListo] = useState<Registro | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const guardarProduccion = useAccion((p: PedidoProduccion) => post<Registro>('/producciones', p))

  const et = etiquetas(conLotes)
  const activos = (productos.datos ?? []).filter((p) => p.activo)
  const disponibles = (lotes.datos ?? []).filter((l) => l.disponible)
  const elegidos = lotesMP.filter((id) => disponibles.some((l) => l.id === id))
  const amasadas = (deHoy.datos ?? []).map((p) => p.lote?.amasada ?? 0)
  const proximaAmasada = deHoy.datos ? Math.max(0, ...amasadas) + 1 : null

  const valor = (id: string) => cant[id] ?? { cocinado: 0, guardado: 0 }
  const conValor = (id: string) => valor(id).cocinado + valor(id).guardado > 0
  const setValor = (id: string, campo: 'cocinado' | 'guardado', n: number) => {
    setAviso(null)
    setCant((c) => ({ ...c, [id]: { ...valor(id), ...c[id], [campo]: n } }))
  }
  const items = activos.filter((p) => conValor(p.id)).map((p) => ({ productoId: p.id, ...valor(p.id) }))
  const texto = buscar.trim().toLowerCase()
  const visibles = activos.filter((p) => !texto || p.nombre.toLowerCase().includes(texto) || conValor(p.id))

  const guardar = async () => {
    setAviso(null)
    setListo(null)
    guardarProduccion.limpiarError()
    if (!items.length) return setAviso('Cargá al menos una cantidad.')
    if (conLotes && !elegidos.length) return setAviso('Elegí los lotes de materia prima usados.')
    const r = await guardarProduccion.ejecutar({ sector, turno, items, ...(conLotes ? { lotesMP: elegidos } : {}) })
    if (r) {
      setListo(r)
      setCant({})
      setLotesMP([])
      setBuscar('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (conLotes) {
      // Si un lote se bloqueó o venció mientras tanto, la lista se actualiza y deja de mostrarlo.
      lotes.recargar()
    }
  }

  const error = aviso ?? guardarProduccion.error

  return (
    <>
      <Volver titulo="Registrar producción" icono={<IconoProduccion />} />
      {listo && (
        <div className="ok prod-confirmacion" role="status">
          <div>
            <strong>Producción guardada.</strong> {fechaHoraPY(listo.fecha)} · {listo.usuarioNombre} · {NOMBRE_TURNO[listo.turno].toLowerCase()}
          </div>
          {listo.lote && (
            <div className="prod-lote">
              <span>Lote</span>
              <strong>{listo.lote.codigo}</strong>
              <span className="suave chico">amasada N° {listo.lote.amasada} de hoy</span>
            </div>
          )}
          <ul>
            {listo.items.map((i) => (
              <li key={i.productoId}>{i.productoNombre}: {i.cocinado} {et.cocinadoCorto}, {i.guardado} {et.guardadoCorto}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="tarjeta prod-turno">
        <div className="segmentado" role="group" aria-label="Turno">
          {(['dia', 'noche'] as Turno[]).map((t) => (
            <button key={t} type="button" className={turno === t ? 'activo' : ''} aria-pressed={turno === t} onClick={() => setTurno(t)}>
              {NOMBRE_TURNO[t]}
            </button>
          ))}
        </div>
        {conLotes && (
          <div className="campo prod-lotes-mp">
            <span>
              Lotes de materia prima usados
              {proximaAmasada !== null && <> · amasada N° {proximaAmasada} de hoy</>}
            </span>
            <ConDatos consulta={lotes}>
              {() =>
                disponibles.length === 0 ? (
                  <p className="suave">
                    No hay lotes de materia prima disponibles. <Link to="/sector/lotes">Cargalos en Materia prima y lotes</Link>.
                  </p>
                ) : (
                  <div className="chips">
                    {disponibles.map((l) => {
                      const activo = lotesMP.includes(l.id)
                      return (
                        <button
                          key={l.id}
                          type="button"
                          className={activo ? 'chip activo' : 'chip'}
                          aria-pressed={activo}
                          onClick={() => {
                            setAviso(null)
                            setLotesMP((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))
                          }}
                        >
                          {l.descripcion}
                        </button>
                      )
                    })}
                  </div>
                )
              }
            </ConDatos>
          </div>
        )}
      </div>

      <p className="suave">
        Escribí cuánto se hizo de cada producto. Lo que dejes vacío no se registra.
        {!!deHoy.datos?.length && (
          <>
            {' '}
            <button type="button" className="btn-texto" onClick={() => document.getElementById('registros-hoy')?.scrollIntoView({ behavior: 'smooth' })}>
              Ver {deHoy.datos.length === 1 ? 'la carga' : `las ${deHoy.datos.length} cargas`} de hoy
            </button>
          </>
        )}
      </p>
      <ConDatos consulta={productos}>
        {() =>
          activos.length === 0 ? (
            <p className="suave">Este sector no tiene productos cargados. El administrador los agrega en Catálogos.</p>
          ) : (
            <>
              {activos.length > 10 && (
                <input
                  className="buscar"
                  type="search"
                  placeholder="Buscar producto"
                  aria-label="Buscar producto"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                />
              )}
              <div className="lista-productos">
                {visibles.map((p) => (
                  <div key={p.id} className={conValor(p.id) ? 'fila-producto con-valor' : 'fila-producto'}>
                    <span className="nombre">{p.nombre}</span>
                    <Numero etiqueta={et.cocinado} valor={valor(p.id).cocinado} onChange={(n) => setValor(p.id, 'cocinado', n)} />
                    <Numero etiqueta={et.guardado} valor={valor(p.id).guardado} onChange={(n) => setValor(p.id, 'guardado', n)} />
                  </div>
                ))}
                {visibles.length === 0 && <p className="suave prod-sin-resultados">Ningún producto coincide con “{buscar.trim()}”.</p>}
              </div>
            </>
          )
        }
      </ConDatos>

      <h2 id="registros-hoy">Registros de hoy</h2>
      <RegistrosDeHoy consulta={deHoy} conLotes={conLotes} />

      <div className="accion-fija">
        <Aviso>{error}</Aviso>
        <button className="btn-primario" onClick={() => void guardar()} disabled={guardarProduccion.enviando}>
          {guardarProduccion.enviando
            ? 'Guardando…'
            : items.length
              ? `Guardar producción (${items.length} ${items.length === 1 ? 'producto' : 'productos'})`
              : 'Guardar producción'}
        </button>
      </div>
    </>
  )
}

function RegistrosDeHoy({ consulta, conLotes }: {
  consulta: { datos: Registro[] | undefined; error: string | null; cargando: boolean }
  conLotes: boolean
}) {
  const et = etiquetas(conLotes)
  if (consulta.error) return <Aviso>{consulta.error}</Aviso>
  if (!consulta.datos) return <Cargando />
  if (!consulta.datos.length) return <p className="suave">Todavía no hay cargas hoy.</p>
  return (
    <div className="prod-dia">
      {consulta.datos.map((p) => (
        <div className="prod-registro" key={p.id}>
          <div className="cabeza">
            <strong>{fechaHoraPY(p.fecha).split(' ')[1]}</strong>
            <span className="suave chico">{NOMBRE_TURNO[p.turno]} · {p.usuarioNombre}</span>
            {p.lote && <span className="chip">{p.lote.codigo}</span>}
          </div>
          <ul>
            {p.items.map((i) => (
              <li key={i.productoId}>{i.productoNombre}: {i.cocinado} {et.cocinadoCorto} · {i.guardado} {et.guardadoCorto}</li>
            ))}
          </ul>
          {p.corregidoEn && (
            <span className="prod-corregido">Corregido por {p.corregidoPorNombre} el {fechaHoraPY(p.corregidoEn)}</span>
          )}
        </div>
      ))}
    </div>
  )
}
