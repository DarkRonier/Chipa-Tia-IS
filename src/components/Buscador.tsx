// Buscador dinámico para listas largas (cientos de productos): se escribe parte del nombre o del código y aparecen
// los que coinciden, sin importar mayúsculas ni tildes. Reemplaza al <select>, que en una lista larga no sirve.
// Teclado: flechas para moverse, Enter elige, Escape cierra. Al salir del campo la lista se cierra.
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'

export interface OpcionBuscador {
  id: string
  nombre: string
  /** Código u otro texto por el que también se busca (se muestra al lado). */
  codigo?: string
  /** Texto chico al lado del nombre (sector, categoría, unidad). */
  detalle?: string
}

/** Minúsculas y sin tildes, para comparar «quesu» con «Quesú». */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Las opciones que contienen todas las palabras buscadas (en el nombre o el código); primero las que empiezan igual. */
export function filtrarOpciones<T extends OpcionBuscador>(opciones: T[], texto: string, maximo = 30): T[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (!palabras.length) return opciones.slice(0, maximo)
  const q = palabras.join(' ')
  const con = opciones
    .map((o) => {
      const nombre = normalizar(o.nombre)
      const codigo = normalizar(o.codigo ?? '')
      const todo = `${nombre} ${codigo}`
      if (!palabras.every((p) => todo.includes(p))) return null
      const puntos = codigo === q ? 0 : codigo.startsWith(q) ? 1 : nombre.startsWith(q) ? 2 : 3
      return { o, puntos }
    })
    .filter((x): x is { o: T; puntos: number } => x !== null)
  con.sort((a, b) => a.puntos - b.puntos || a.o.nombre.localeCompare(b.o.nombre, 'es'))
  return con.slice(0, maximo).map((x) => x.o)
}

interface Props<T extends OpcionBuscador> {
  etiqueta: string
  /** Oculta la etiqueta (queda para lectores de pantalla), para usarlo dentro de una fila con encabezados. */
  sinEtiqueta?: boolean
  opciones: T[]
  elegido: T | null
  onElegir: (o: T | null) => void
  placeholder?: string
  /** Opción fija al final de los resultados (por ejemplo «Otro gasto, sin stock»). */
  extra?: { texto: string; alElegir: () => void }
  /** Permite dejarlo vacío borrando el texto (por ejemplo, proveedor «Sin nombre»). */
  vaciable?: boolean
  autoFocus?: boolean
  className?: string
  /** id del campo de texto (para enfocarlo desde afuera). */
  inputId?: string
}

function BuscadorBase<T extends OpcionBuscador>(
  { etiqueta, sinEtiqueta, opciones, elegido, onElegir, placeholder = 'Buscá por nombre o código…', extra, vaciable, autoFocus, className, inputId }: Props<T>,
  ref: React.ForwardedRef<HTMLInputElement>,
) {
  const propio = useId()
  const id = inputId ?? propio
  const [texto, setTexto] = useState<string | null>(null) // null = mostrando lo elegido
  const [abierto, setAbierto] = useState(false)
  const [marcado, setMarcado] = useState(0)
  const lista = useRef<HTMLUListElement>(null)
  const resultados = useMemo(() => (abierto ? filtrarOpciones(opciones, texto ?? '') : []), [opciones, texto, abierto])
  const filas = resultados.length + (extra ? 1 : 0)

  useEffect(() => setMarcado(0), [texto])
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${marcado}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [marcado])

  const cerrar = () => {
    setAbierto(false)
    if (vaciable && texto !== null && !texto.trim()) onElegir(null)
    setTexto(null)
  }
  const elegir = (i: number) => {
    if (i < resultados.length) onElegir(resultados[i])
    else extra?.alElegir()
    setTexto(null)
    setAbierto(false)
  }

  return (
    <div className={`campo buscador${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className={sinEtiqueta ? 'solo-lector' : undefined}>{etiqueta}</label>
      <div className="buscador-caja">
        <svg className="buscador-lupa" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          ref={ref} id={id} value={texto ?? elegido?.nombre ?? ''} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
          role="combobox" aria-expanded={abierto} aria-controls={`${id}-lista`} aria-autocomplete="list"
          aria-activedescendant={abierto && filas ? `${id}-${marcado}` : undefined}
          className={elegido && texto === null ? 'con-valor' : undefined}
          onFocus={(e) => { setAbierto(true); e.currentTarget.select() }}
          onClick={() => setAbierto(true)}
          onBlur={cerrar}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setMarcado((m) => Math.min(m + 1, filas - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)) }
            else if (e.key === 'Enter' && abierto && filas) { e.preventDefault(); elegir(marcado) }
            else if (e.key === 'Escape') { setTexto(null); setAbierto(false) }
          }}
        />
        {elegido?.codigo && texto === null && <span className="buscador-codigo">{elegido.codigo}</span>}
      </div>
      {abierto && (
        <ul className="buscador-lista" id={`${id}-lista`} role="listbox" ref={lista}>
          {resultados.map((o, i) => (
            <li key={o.id} id={`${id}-${i}`} data-i={i} role="option" aria-selected={i === marcado}
              className={i === marcado ? 'marcado' : undefined}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setMarcado(i)} onClick={() => elegir(i)}>
              <span className="buscador-nombre">{o.nombre}</span>
              {(o.codigo || o.detalle) && <span className="suave chico">{[o.codigo, o.detalle].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
          {!resultados.length && <li className="suave chico buscador-nada" role="presentation">No hay nada con «{texto}».</li>}
          {extra && (
            <li id={`${id}-${resultados.length}`} data-i={resultados.length} role="option" aria-selected={marcado === resultados.length}
              className={`buscador-extra${marcado === resultados.length ? ' marcado' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setMarcado(resultados.length)} onClick={() => elegir(resultados.length)}>
              {extra.texto}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

const Buscador = forwardRef(BuscadorBase) as <T extends OpcionBuscador>(
  p: Props<T> & { ref?: React.Ref<HTMLInputElement> },
) => ReturnType<typeof BuscadorBase>
export default Buscador
