// Historial: unidades cocinadas por día, una línea por sector. Detalle de todos los sectores al tocar,
// pasar el puntero o recorrer con las flechas; la misma información está en la tabla de abajo.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { SECTOR_IDS, type SectorId, type SerieReporte } from '../../shared/tipos'
import { ClaveSector, colorSector, Forma, useAncho } from './comunes'
import { diaConSemana, diaMes, escalaY, num, pasoRotulos } from './datos'

const MARGEN = { arriba: 10, derecha: 16, abajo: 26 }

export default function Historial({ serie, dias, nombre }: {
  serie: SerieReporte
  dias: number
  nombre: (s: SectorId) => string
}) {
  const caja = useRef<HTMLDivElement>(null)
  const ancho = useAncho(caja)
  const [indice, setIndice] = useState<number | null>(null)
  const [anuncio, setAnuncio] = useState('')
  const datos = serie.dias.slice(-dias)
  const n = datos.length
  const alto = ancho < 520 ? 230 : 280

  // Al cambiar el rango el día elegido ya no corresponde.
  useEffect(() => setIndice(null), [dias])
  // Un toque fuera del gráfico cierra el detalle (en el celular no hay «salir del puntero»).
  useEffect(() => {
    if (indice === null) return
    const fuera = (e: globalThis.PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setIndice(null)
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [indice])

  const maximo = Math.max(0, ...datos.flatMap((d) => SECTOR_IDS.map((s) => d.sectores[s].cocinado)))
  const { tope, ticks } = escalaY(maximo)
  const izquierda = num(tope).length * 6.8 + 14
  const anchoPlot = Math.max(10, ancho - izquierda - MARGEN.derecha)
  const altoPlot = alto - MARGEN.arriba - MARGEN.abajo
  const paso = n > 1 ? anchoPlot / (n - 1) : 0
  const x = (i: number) => izquierda + (n > 1 ? i * paso : anchoPlot / 2)
  const y = (v: number) => MARGEN.arriba + altoPlot * (1 - v / tope)
  const cada = pasoRotulos(Math.max(paso, 1))

  const totales = Object.fromEntries(SECTOR_IDS.map((s) => [s, datos.reduce((a, d) => a + d.sectores[s].cocinado, 0)])) as Record<SectorId, number>
  const totalDia = (i: number) => SECTOR_IDS.reduce((a, s) => a + datos[i].sectores[s].cocinado, 0)
  let mejor = 0
  for (let i = 1; i < n; i++) if (totalDia(i) > totalDia(mejor)) mejor = i
  const resumen =
    `Unidades cocinadas por día del ${diaMes(datos[0].dia)} al ${diaMes(datos[n - 1].dia)}. ` +
    SECTOR_IDS.map((s) => `${nombre(s)}: ${num(totales[s])}`).join('; ') + '. ' +
    (totalDia(mejor) > 0 ? `El día con más producción fue el ${diaConSemana(datos[mejor].dia)}, con ${num(totalDia(mejor))} en total.` : 'No hay producción cargada en estos días.')

  // El área sensible empieza 8 px antes del primer día; de ahí sale la posición dentro del trazado.
  const desdePuntero = (e: PointerEvent<SVGRectElement>) => {
    const dentro = e.clientX - e.currentTarget.getBoundingClientRect().left - 8
    setIndice(Math.max(0, Math.min(n - 1, paso ? Math.round(dentro / paso) : 0)))
  }
  const teclado = (e: KeyboardEvent) => {
    const actual = indice ?? n
    let i: number | null = null
    if (e.key === 'ArrowLeft') i = Math.max(0, actual - 1)
    else if (e.key === 'ArrowRight') i = Math.min(n - 1, indice === null ? n - 1 : indice + 1)
    else if (e.key === 'Home') i = 0
    else if (e.key === 'End') i = n - 1
    else if (e.key === 'Escape') {
      setIndice(null)
      return
    } else return
    e.preventDefault()
    setIndice(i)
    setAnuncio(`${diaConSemana(datos[i].dia)}: ${SECTOR_IDS.map((s) => `${nombre(s)} ${num(datos[i].sectores[s].cocinado)}`).join(', ')}`)
  }

  const aDerecha = indice !== null && x(indice) > ancho * 0.55
  return (
    <div className="graf-tarjeta">
      <ul className="graf-leyenda" aria-label="Sectores">
        {SECTOR_IDS.map((s) => (
          <li key={s}><ClaveSector sector={s} linea /><span>{nombre(s)}</span><span className="graf-dato">{num(totales[s])}</span></li>
        ))}
      </ul>
      <div
        ref={caja} className="graf-lienzo" tabIndex={0} role="group"
        aria-label="Detalle por día. Con las flechas izquierda y derecha recorrés los días."
        onKeyDown={teclado}
      >
        <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={resumen}>
          <g className="graf-eje" aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'graf-cero' : 'graf-linea-eje'} x1={izquierda} x2={izquierda + anchoPlot} y1={y(t)} y2={y(t)} />
                <text x={izquierda - 8} y={y(t) + 4} textAnchor="end">{num(t)}</text>
              </g>
            ))}
            {datos.map((d, i) => ((n - 1 - i) % cada === 0 ? (
              <text key={d.dia} x={x(i)} y={alto - 7} textAnchor="middle">{diaMes(d.dia)}</text>
            ) : null))}
          </g>
          {indice !== null && <line className="graf-guia" x1={x(indice)} x2={x(indice)} y1={MARGEN.arriba} y2={MARGEN.arriba + altoPlot} aria-hidden="true" />}
          <g fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
            {SECTOR_IDS.map((s) => (
              <polyline key={s} stroke={colorSector(s)} points={datos.map((d, i) => `${x(i)},${y(d.sectores[s].cocinado)}`).join(' ')} />
            ))}
          </g>
          <g aria-hidden="true">
            {SECTOR_IDS.map((s) => {
              const i = indice ?? n - 1
              return <Forma key={s} sector={s} x={x(i)} y={y(datos[i].sectores[s].cocinado)} />
            })}
          </g>
          <rect
            x={izquierda - 8} y={0} width={anchoPlot + 16} height={alto - MARGEN.abajo + 8} fill="transparent"
            onPointerDown={desdePuntero} onPointerMove={desdePuntero}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setIndice(null)}
          />
        </svg>
        {indice !== null && (
          <div className="graf-detalle" aria-hidden="true" style={aDerecha ? { right: ancho - x(indice) + 12 } : { left: x(indice) + 12 }}>
            <strong>{diaConSemana(datos[indice].dia)}</strong>
            <ul>
              {SECTOR_IDS.map((s) => (
                <li key={s}><ClaveSector sector={s} linea /><span>{nombre(s)}</span><b>{num(datos[indice].sectores[s].cocinado)}</b></li>
              ))}
              <li className="graf-total"><span /><span>Total</span><b>{num(totalDia(indice))}</b></li>
            </ul>
          </div>
        )}
        <div className="graf-solo-voz" role="status">{anuncio}</div>
      </div>
      <details className="graf-tabla">
        <summary>Ver los números en una tabla</summary>
        <div className="graf-tabla-corre">
          <table className="tabla" aria-label="Unidades cocinadas por día y sector">
            <thead>
              <tr><th>Día</th>{SECTOR_IDS.map((s) => <th key={s} className="num">{nombre(s)}</th>)}<th className="num">Total</th></tr>
            </thead>
            <tbody>
              {[...datos].reverse().map((d, k) => (
                <tr key={d.dia}>
                  <td className="rep-nowrap">{diaConSemana(d.dia)}</td>
                  {SECTOR_IDS.map((s) => <td key={s} className="num">{num(d.sectores[s].cocinado)}</td>)}
                  <td className="num"><strong>{num(totalDia(n - 1 - k))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
