// Fechas en hora de Paraguay (I04). Se guardan en UTC y se muestran y agrupan en America/Asuncion.
import type { Periodo } from './tipos'

export const ZONA = 'America/Asuncion'

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
const formatoFechaHora = new Intl.DateTimeFormat('es-PY', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const formatoHoraNum = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hour12: false })

/** Día calendario en Paraguay, AAAA-MM-DD. */
export function diaPY(fecha: string | Date = new Date()): string {
  return formatoDia.format(typeof fecha === 'string' ? new Date(fecha) : fecha)
}

/** "09/10/2026 19:57" en hora de Paraguay. */
export function fechaHoraPY(iso: string): string {
  return formatoFechaHora.format(new Date(iso)).replace(',', '')
}

/** "09/10/2026" a partir de AAAA-MM-DD. */
export function diaLegible(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

export function horaPY(fecha: Date = new Date()): number {
  return Number(formatoHoraNum.format(fecha)) % 24
}

export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = lunes … 6 = domingo. */
export function diaDeSemana(dia: string): number {
  return (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7
}

export function inicioDeSemana(dia: string): string {
  return sumarDias(dia, -diaDeSemana(dia))
}

export function inicioDeMes(dia: string): string {
  return `${dia.slice(0, 8)}01`
}

/** Turno que corresponde a la hora actual: día de 5 a 15 h, noche el resto. */
export function turnoActual(fecha: Date = new Date()): 'dia' | 'noche' {
  const h = horaPY(fecha)
  return h >= 5 && h < 15 ? 'dia' : 'noche'
}

/**
 * Período que cubre cada resumen automático (H04), visto desde `hoy`:
 * diario = ayer; semanal (lunes) = la semana anterior de lunes a domingo; mensual (día 1) = el mes anterior.
 */
export function rangoResumen(periodo: Periodo, hoy: string): { desde: string; hasta: string } {
  if (periodo === 'diario') {
    const ayer = sumarDias(hoy, -1)
    return { desde: ayer, hasta: ayer }
  }
  if (periodo === 'semanal') {
    const lunes = inicioDeSemana(hoy)
    return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) }
  }
  const finMesAnterior = sumarDias(inicioDeMes(hoy), -1)
  return { desde: inicioDeMes(finMesAnterior), hasta: finMesAnterior }
}

export function esDiaValido(dia: unknown): dia is string {
  return typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) && !Number.isNaN(Date.parse(`${dia}T00:00:00Z`))
}
