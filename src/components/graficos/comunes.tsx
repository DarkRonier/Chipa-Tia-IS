// Piezas que comparten los gráficos del Resumen: medida del lienzo, marca por sector, leyenda y selector.
import { useEffect, useState, type RefObject } from 'react'
import { SECTOR_IDS, type SectorId } from '../../shared/tipos'

export const colorSector = (s: SectorId) => `var(--serie-${s})`
/** Cada sector tiene también su forma, para no depender solo del color. */
const FORMAS: Record<SectorId, number> = Object.fromEntries(SECTOR_IDS.map((s, i) => [s, i])) as Record<SectorId, number>

/** Ancho en píxeles del elemento, siguiendo los cambios de tamaño. */
export function useAncho(ref: RefObject<HTMLElement | null>, inicial = 340): number {
  const [ancho, setAncho] = useState(inicial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setAncho(Math.max(240, Math.floor(el.getBoundingClientRect().width)))
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return ancho
}

/** Marca de un sector (círculo, cuadrado, rombo o triángulo) de radio r, con un anillo del color de la superficie. */
export function Forma({ sector, x, y, r = 4.5, anillo = true }: { sector: SectorId; x: number; y: number; r?: number; anillo?: boolean }) {
  const f = FORMAS[sector]
  const k = f === 2 ? r * 1.3 : f === 3 ? r * 1.2 : r
  const puntos =
    f === 2 ? `${x},${y - k} ${x + k},${y} ${x},${y + k} ${x - k},${y}`
      : f === 3 ? `${x},${y - k} ${x + k},${y + k * 0.8} ${x - k},${y + k * 0.8}` : ''
  const props = { fill: colorSector(sector), stroke: anillo ? 'var(--superficie)' : 'none', strokeWidth: anillo ? 2 : 0, strokeLinejoin: 'round' as const }
  if (f === 0) return <circle cx={x} cy={y} r={r} {...props} />
  if (f === 1) return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} {...props} />
  return <polygon points={puntos} {...props} />
}

/** Llave de leyenda: tramo de línea con la marca del sector (o solo la marca, para barras). */
export function ClaveSector({ sector, linea = false }: { sector: SectorId; linea?: boolean }) {
  return (
    <svg className="graf-clave" width={linea ? 26 : 14} height="14" viewBox={linea ? '0 0 26 14' : '0 0 14 14'} aria-hidden="true">
      {linea && <line x1="0" y1="7" x2="26" y2="7" stroke={colorSector(sector)} strokeWidth="2" strokeLinecap="round" />}
      <Forma sector={sector} x={linea ? 13 : 7} y={7} r={4.5} anillo={linea} />
    </svg>
  )
}

/** Botones de una sola opción, con el estilo segmentado de la app. */
export function Selector<T extends string | number>({ etiqueta, valor, opciones, onCambio }: {
  etiqueta: string
  valor: T
  opciones: [T, string][]
  onCambio: (v: T) => void
}) {
  return (
    <div className="segmentado chico" role="group" aria-label={etiqueta}>
      {opciones.map(([v, texto]) => (
        <button key={String(v)} type="button" className={v === valor ? 'activo' : ''} aria-pressed={v === valor} onClick={() => onCambio(v)}>
          {texto}
        </button>
      ))}
    </div>
  )
}
