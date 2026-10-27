// Comparación: por sector, el tramo actual (esta semana o este mes hasta hoy) contra el mismo tramo del
// anterior, en barras agrupadas con la variación en % (signo y flecha, además del color).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SECTOR_IDS, type MedidaSerie, type SectorId, type SerieReporte } from '../../shared/tipos'
import { ClaveSector, colorSector, useAncho } from './comunes'
import { num, periodosComparados, rangoTexto, sumaSerie, variacion, type Comparacion as Tipo } from './datos'

export const MEDIDAS: [MedidaSerie, string][] = [['cocinado', 'Cocinado'], ['guardado', 'Guardado'], ['enviado', 'Enviado'], ['vendido', 'Vendido']]
const TEXTO_MEDIDA: Record<MedidaSerie, string> = {
  cocinado: 'cocinadas', guardado: 'guardadas en frío', enviado: 'enviadas a sucursales', vendido: 'sacadas a la venta',
}

const FILA = 66
const ALTO_BARRA = 14
const RESERVA = 62 // lugar para el número que va al final de la barra

const conSigno = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`

/** Barra horizontal de largo w con la punta redondeada (4 px) y el arranque recto. */
function trazoBarra(x: number, y: number, w: number, h: number) {
  if (w <= 0) return ''
  const r = Math.min(4, w, h / 2)
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
}

export default function Comparacion({ serie, hoy, tipo, medida, nombre }: {
  serie: SerieReporte
  hoy: string
  tipo: Tipo
  medida: MedidaSerie
  nombre: (s: SectorId) => string
}) {
  const caja = useRef<HTMLDivElement>(null)
  const ancho = useAncho(caja)
  const [fila, setFila] = useState<number | null>(null)
  useEffect(() => setFila(null), [tipo, medida])
  useEffect(() => {
    if (fila === null) return
    const fuera = (e: globalThis.PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setFila(null)
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [fila])

  const { actual, previo } = periodosComparados(tipo, hoy)
  const nombreActual = tipo === 'semana' ? 'Esta semana' : 'Este mes'
  const nombrePrevio = tipo === 'semana' ? 'Semana pasada' : 'Mes pasado'
  const filas = SECTOR_IDS.map((s) => {
    const a = sumaSerie(serie, medida, actual, s)
    const p = sumaSerie(serie, medida, previo, s)
    return { sector: s, a, p, v: variacion(a, p) }
  })
  const totalA = filas.reduce((t, f) => t + f.a, 0)
  const totalP = filas.reduce((t, f) => t + f.p, 0)
  const vTotal = variacion(totalA, totalP)

  const maximo = Math.max(0, ...filas.flatMap((f) => [f.a, f.p]))
  const largo = Math.max(10, ancho - RESERVA)
  const w = (v: number) => (maximo > 0 ? Math.max(v > 0 ? 3 : 0, (v / maximo) * largo) : 0)
  const alto = FILA * filas.length

  const resumen =
    `Unidades ${TEXTO_MEDIDA[medida]}: ${nombreActual.toLowerCase()} (${rangoTexto(actual)}) contra ${nombrePrevio.toLowerCase()} (${rangoTexto(previo)}). ` +
    `Todos los sectores: ${num(totalA)} contra ${num(totalP)}, ${vTotal.voz}. ` +
    filas.map((f) => `${nombre(f.sector)}: ${num(f.a)} contra ${num(f.p)}, ${f.v.voz}`).join('; ') + '.'

  const teclado = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setFila(fila === null ? 0 : Math.min(filas.length - 1, fila + 1))
    else if (e.key === 'ArrowUp') setFila(fila === null ? filas.length - 1 : Math.max(0, fila - 1))
    else if (e.key === 'Escape') setFila(null)
    else return
    e.preventDefault()
  }
  const clase = (s: string) => `graf-${s}`
  const sel = fila === null ? null : filas[fila]
  const colocar = fila !== null && fila >= 2 ? { bottom: alto - fila * FILA - 4 } : { top: (fila ?? 0) * FILA + FILA - 6 }

  return (
    <div className="graf-tarjeta">
      <ul className="graf-leyenda" aria-label="Períodos">
        <li>
          <svg className="graf-clave" width="46" height="14" viewBox="0 0 46 14" aria-hidden="true">
            {SECTOR_IDS.map((s, i) => <rect key={s} x={i * 12} y="1" width="10" height="12" rx="2" fill={colorSector(s)} />)}
          </svg>
          <span>{nombreActual} ({rangoTexto(actual)})</span>
        </li>
        <li>
          <svg className="graf-clave" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" fill="var(--graf-previo)" /></svg>
          <span>{nombrePrevio} ({rangoTexto(previo)})</span>
        </li>
      </ul>
      <div className="graf-total-fila">
        <span>Todos los sectores</span>
        <span><strong>{num(totalA)}</strong> <span className="suave">contra {num(totalP)}</span></span>
        <span className={clase(vTotal.sentido === 'sube' ? 'sube' : vTotal.sentido === 'baja' ? 'baja' : 'igual')}>{vTotal.texto}</span>
      </div>
      <div
        ref={caja} className="graf-lienzo" tabIndex={0} role="group"
        aria-label="Detalle por sector. Con las flechas arriba y abajo recorrés los sectores."
        onKeyDown={teclado}
      >
        <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={resumen}>
          {filas.map((f, i) => {
            const y0 = i * FILA
            return (
              <g key={f.sector} className={`graf-fila${fila === i ? ' activa' : ''}`} onPointerDown={() => setFila(i)} onPointerEnter={(e) => e.pointerType === 'mouse' && setFila(i)} onPointerLeave={(e) => e.pointerType === 'mouse' && setFila(null)}>
                <rect className="graf-fila-hover" x={-4} y={y0 + 2} width={ancho + 8} height={FILA - 6} rx={8} />
                <text className="graf-svg-texto graf-nombre" x={0} y={y0 + 18}>{nombre(f.sector)}</text>
                <text className={`graf-svg-texto ${clase(f.v.sentido === 'sube' ? 'sube' : f.v.sentido === 'baja' ? 'baja' : 'igual')}`} x={ancho} y={y0 + 18} textAnchor="end">{f.v.texto}</text>
                <path d={trazoBarra(0, y0 + 26, w(f.a), ALTO_BARRA)} fill={colorSector(f.sector)} />
                <text className="graf-svg-texto graf-fuerte" x={w(f.a) + 6} y={y0 + 26 + ALTO_BARRA - 2}>{num(f.a)}</text>
                <path d={trazoBarra(0, y0 + 26 + ALTO_BARRA + 3, w(f.p), ALTO_BARRA)} fill="var(--graf-previo)" />
                <text className="graf-svg-texto" x={w(f.p) + 6} y={y0 + 26 + ALTO_BARRA * 2 + 1}>{num(f.p)}</text>
                <line className="graf-cero" x1={0} x2={0} y1={y0 + 24} y2={y0 + 26 + ALTO_BARRA * 2 + 5} />
              </g>
            )
          })}
        </svg>
        {sel && (
          <div className="graf-detalle" aria-hidden="true" style={{ left: 0, ...colocar }}>
            <strong>{nombre(sel.sector)}</strong>
            <ul>
              <li><ClaveSector sector={sel.sector} /><span>{nombreActual} · {rangoTexto(actual)}</span><b>{num(sel.a)}</b></li>
              <li><svg className="graf-clave" width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="2" fill="var(--graf-previo)" /></svg><span>{nombrePrevio} · {rangoTexto(previo)}</span><b>{num(sel.p)}</b></li>
              <li className="graf-total"><span /><span>Diferencia</span><b className={clase(sel.v.sentido === 'sube' ? 'sube' : sel.v.sentido === 'baja' ? 'baja' : 'igual')}>{conSigno(sel.a - sel.p)} · {sel.v.texto}</b></li>
            </ul>
          </div>
        )}
      </div>
      <details className="graf-tabla">
        <summary>Ver los números en una tabla</summary>
        <div className="graf-tabla-corre">
          <table className="tabla" aria-label={`Unidades ${TEXTO_MEDIDA[medida]} por sector, ${nombreActual.toLowerCase()} contra ${nombrePrevio.toLowerCase()}`}>
            <thead>
              <tr><th>Sector</th><th className="num">{nombreActual}</th><th className="num">{nombrePrevio}</th><th className="num">Variación</th></tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.sector}><td>{nombre(f.sector)}</td><td className="num">{num(f.a)}</td><td className="num">{num(f.p)}</td><td className="num">{f.v.texto}</td></tr>
              ))}
              <tr className="rep-total"><td>Todos</td><td className="num">{num(totalA)}</td><td className="num">{num(totalP)}</td><td className="num">{vTotal.texto}</td></tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
