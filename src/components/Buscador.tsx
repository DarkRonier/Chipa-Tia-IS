// Buscador dinámico para listas largas (cientos de productos): se escribe parte del nombre o del código y aparecen
// los que coinciden, sin importar mayúsculas ni tildes. Reemplaza al <select>, que en una lista larga no sirve.
import { useId, useMemo, useState } from 'react'

export interface OpcionBuscador {
  id: string
  nombre: string
  /** Código u otro texto por el que también se busca (se muestra al lado). */
  codigo?: string
  /** Texto chico debajo del nombre (sector, categoría, unidad). */
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
  opciones: T[]
  elegido: T | null
  onElegir: (o: T | null) => void
  placeholder?: string
  /** Opción fija al final de los resultados (por ejemplo «Otro gasto, sin stock»). */
  extra?: { texto: string; alElegir: () => void }
  /** Texto cuando no hay nada elegido y se quiere mostrar un valor por defecto (ej. «Sin nombre»). */
  textoVacio?: string
  autoFocus?: boolean
}

export default function Buscador<T extends OpcionBuscador>({
  etiqueta, opciones, elegido, onElegir, placeholder = 'Escribí el nombre o el código…', extra, textoVacio, autoFocus,
}: Props<T>) {
  const id = useId()
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const resultados = useMemo(() => (abierto ? filtrarOpciones(opciones, texto) : []), [opciones, texto, abierto])

  if (elegido || (textoVacio && !abierto)) {
    return (
      <div className="campo buscador">
        <span>{etiqueta}</span>
        <div className="buscador-elegido">
          <span>
            <strong>{elegido ? elegido.nombre : textoVacio}</strong>
            {elegido?.codigo && <span className="suave chico"> · {elegido.codigo}</span>}
            {elegido?.detalle && <span className="suave chico"> · {elegido.detalle}</span>}
          </span>
          <button type="button" className="btn-texto" onClick={() => { onElegir(null); setTexto(''); setAbierto(true) }}>
            {elegido ? 'Cambiar' : 'Elegir'}
          </button>
        </div>
      </div>
    )
  }

  const elegir = (o: T) => {
    onElegir(o)
    setTexto('')
    setAbierto(false)
  }
  return (
    <div className="campo buscador">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id} type="search" value={texto} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus || (!!textoVacio && abierto)}
        role="combobox" aria-expanded={abierto} aria-controls={`${id}-lista`}
        onFocus={() => setAbierto(true)}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); elegir(resultados[0]) }
          if (e.key === 'Escape') setAbierto(false)
        }}
      />
      {abierto && (
        <ul className="buscador-lista" id={`${id}-lista`} role="listbox">
          {resultados.map((o) => (
            <li key={o.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)}>
                <span>{o.nombre}{o.codigo && <span className="suave chico"> · {o.codigo}</span>}</span>
                {o.detalle && <span className="suave chico">{o.detalle}</span>}
              </button>
            </li>
          ))}
          {!resultados.length && <li className="suave chico buscador-nada">No hay nada con «{texto}».</li>}
          {extra && (
            <li><button type="button" className="buscador-extra" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAbierto(false); extra.alElegir() }}>{extra.texto}</button></li>
          )}
          {textoVacio && (
            <li><button type="button" className="buscador-extra" onMouseDown={(e) => e.preventDefault()} onClick={() => setAbierto(false)}>Dejar «{textoVacio}»</button></li>
          )}
        </ul>
      )}
    </div>
  )
}
