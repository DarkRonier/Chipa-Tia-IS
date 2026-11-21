// Piezas que comparten las pantallas de catálogo (Catálogos y Mantenimiento): fila editable, lista con los
// desactivados plegados, formulario de alta y elección de sectores.
import { useState, type FormEvent, type ReactNode } from 'react'
import { useAccion } from '../../cliente/consultas'
import { Aviso } from '../../components/Estado'
import BotonIcono from '../../components/BotonIcono'
import { SECTOR_IDS, type Sector, type SectorId } from '../../shared/tipos'

export interface Campo {
  clave: string
  etiqueta: string
  valor: string
  max?: number
}

/**
 * Fila de catálogo: nombre, detalle y acciones. "Renombrar" abre la edición en línea de `campos`;
 * `guardar` recibe solo lo que cambió. Con `cambiarActivo` muestra Desactivar / Activar.
 */
export function FilaEditable({ titulo, prefijo, detalle, activo = true, campos, guardar, cambiarActivo, textoEditar = 'Renombrar', debajo }: {
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
          <BotonIcono icono="editar" texto={`${textoEditar} ${titulo}`} onClick={abrir} />
          {cambiarActivo && (
            <BotonIcono
              icono={activo ? 'desactivar' : 'activar'} texto={`${activo ? 'Desactivar' : 'Activar'} ${titulo}`} tono={activo ? 'peligro' : 'positivo'}
              disabled={accion.enviando} onClick={() => void accion.ejecutar(() => cambiarActivo(!activo))}
            />
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
export function ListaConInactivos<T extends { id: string; activo: boolean }>({ items, vacio, textoInactivos, render }: {
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
export function FormAlta({ titulo, children, enviando, error, ok, alEnviar, boton = 'Agregar' }: {
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

export function SectoresCheck({ elegidos, sectores, alCambiar, deshabilitado, permitirVacio = false }: {
  elegidos: SectorId[]
  sectores: Sector[]
  alCambiar: (s: SectorId[]) => void
  deshabilitado?: boolean
  /** Las categorías pueden quedar sin sectores; las áreas de limpieza no. */
  permitirVacio?: boolean
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
              disabled={deshabilitado || (!permitirVacio && marcado && elegidos.length === 1)}
              onChange={() => alternar(s.id)}
            />
            {s.nombre}
          </label>
        )
      })}
    </div>
  )
}
