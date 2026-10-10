// Cuentas de los gráficos del Resumen: períodos a comparar, sumas de la serie, variación y escala de los ejes.
// Todo en días de Paraguay (AAAA-MM-DD) con las funciones de src/shared/hora.ts.
import { diaDeSemana, inicioDeMes, inicioDeSemana, sumarDias } from '../../shared/hora'
import { SECTOR_IDS, type MedidaSerie, type SectorId, type SerieReporte } from '../../shared/tipos'

export const num = (n: number) => n.toLocaleString('es-PY')

const ABREVIADOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

/** "05/10" a partir de AAAA-MM-DD. */
export const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
/** "lun 05/10". */
export const diaConSemana = (dia: string) => `${ABREVIADOS[diaDeSemana(dia)]} ${diaMes(dia)}`
/** "05/10 al 10/10", o solo "05/10" si es un día. */
export const rangoTexto = (r: Rango) => (r.desde === r.hasta ? diaMes(r.desde) : `${diaMes(r.desde)} al ${diaMes(r.hasta)}`)

export interface Rango { desde: string; hasta: string }
export type Comparacion = 'semana' | 'mes'

/**
 * Período de hoy y el mismo tramo del anterior: semana = de lunes a hoy contra el lunes a ese mismo día de la
 * semana pasada; mes = del 1 a hoy contra el 1 al mismo número del mes pasado (si el mes pasado fue más corto,
 * hasta su último día).
 */
export function periodosComparados(tipo: Comparacion, hoy: string): { actual: Rango; previo: Rango } {
  if (tipo === 'semana') {
    const lunes = inicioDeSemana(hoy)
    const pasado = sumarDias(lunes, -7)
    return { actual: { desde: lunes, hasta: hoy }, previo: { desde: pasado, hasta: sumarDias(pasado, diaDeSemana(hoy)) } }
  }
  const primero = inicioDeMes(hoy)
  const finPasado = sumarDias(primero, -1)
  const primeroPasado = inicioDeMes(finPasado)
  const dias = Math.min(Number(hoy.slice(8, 10)), Number(finPasado.slice(8, 10)))
  return { actual: { desde: primero, hasta: hoy }, previo: { desde: primeroPasado, hasta: sumarDias(primeroPasado, dias - 1) } }
}

/** Suma de una medida de un sector (o de todos) en un rango de días. */
export function sumaSerie(serie: SerieReporte, medida: MedidaSerie, r: Rango, sector?: SectorId): number {
  let total = 0
  for (const d of serie.dias) {
    if (d.dia < r.desde || d.dia > r.hasta) continue
    for (const s of sector ? [sector] : SECTOR_IDS) total += d.sectores[s][medida]
  }
  return total
}

export interface Variacion {
  /** Texto con signo y flecha: "▲ +12 %", "▼ −8 %", "= 0 %", "▲ nuevo". */
  texto: string
  sentido: 'sube' | 'baja' | 'igual'
  /** Lo mismo dicho en palabras, para lectores de pantalla. */
  voz: string
}

export function variacion(actual: number, previo: number): Variacion {
  if (actual === previo) return { texto: '= 0 %', sentido: 'igual', voz: 'sin cambios' }
  if (previo === 0) return { texto: '▲ nuevo', sentido: 'sube', voz: 'sube, antes no había nada' }
  const pct = ((actual - previo) / previo) * 100
  const abs = Math.abs(pct)
  const cifra = (abs < 10 ? Math.round(abs * 10) / 10 : Math.round(abs)).toLocaleString('es-PY')
  return pct > 0
    ? { texto: `▲ +${cifra} %`, sentido: 'sube', voz: `sube ${cifra} por ciento` }
    : { texto: `▼ −${cifra} %`, sentido: 'baja', voz: `baja ${cifra} por ciento` }
}

/** Tope redondo del eje (1, 2, 2,5, 5 × potencia de diez) y sus marcas, siempre desde 0. */
export function escalaY(maximo: number, marcas = 4): { tope: number; ticks: number[] } {
  if (maximo <= 0) return { tope: marcas, ticks: Array.from({ length: marcas + 1 }, (_, i) => i) }
  const crudo = maximo / marcas
  const pot = 10 ** Math.floor(Math.log10(crudo))
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= crudo) ?? 10 * pot
  const n = Math.ceil(maximo / paso)
  return { tope: n * paso, ticks: Array.from({ length: n + 1 }, (_, i) => i * paso) }
}

/** Cada cuántos días poner un rótulo del eje X para que no se pisen (se cuentan desde el último día). */
export const pasoRotulos = (pxPorDia: number, pxRotulo = 46) => Math.max(1, Math.ceil(pxRotulo / pxPorDia))
