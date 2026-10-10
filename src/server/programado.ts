// Tareas automáticas del Worker, en dos disparadores de Cloudflare (Workers Free permite 50 consultas a D1
// por ejecución, y juntas pasaban de ese límite un lunes que cae día 1):
//  - CRON_RESUMENES `0 9 * * *` (09:00 UTC = 06:00 en Paraguay): resumen por correo diario siempre,
//    semanal los lunes y mensual el día 1 (H04).
//  - CRON_COPIA `30 9 * * 1` (los lunes, 06:30 en Paraguay): copia semanal de toda la base (I05) y borrado
//    de las sesiones vencidas.
// Sin disparador (las pruebas) hace todo junto. Un disparador desconocido no hace nada y queda anotado.
// Nunca lanza: si algo falla, lo anota en el log y sigue con lo demás.
import { diaDeSemana, diaPY } from '../shared/hora'
import type { Periodo } from '../shared/tipos'
import { enviarResumen } from './correo'
import { ejecutar } from './db'
import type { Env } from './entorno'
import { hacerCopia } from './rutas/datos'

/** Resúmenes por correo: todos los días a las 09:00 UTC (06:00 en Paraguay). */
export const CRON_RESUMENES = '0 9 * * *'
/** Copia semanal y limpieza de sesiones: los lunes a las 09:30 UTC (06:30 en Paraguay). */
export const CRON_COPIA = '30 9 * * 1'

export interface ResultadoProgramado {
  /** Día de Paraguay en que corrió. */
  dia: string
  hechas: string[]
  errores: string[]
}

/**
 * `cron` es la expresión del disparador que se activó (`evento.cron` del Worker); sin ella se hace todo.
 */
export async function tareasProgramadas(env: Env, cuando: Date, cron?: string): Promise<ResultadoProgramado> {
  const res: ResultadoProgramado = { dia: '', hechas: [], errores: [] }
  const intentar = async (nombre: string, f: () => Promise<string | void>) => {
    try {
      const detalle = await f()
      res.hechas.push(detalle ? `${nombre}: ${detalle}` : nombre)
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      res.errores.push(`${nombre}: ${mensaje}`)
      console.error(`Tarea programada «${nombre}» falló:`, e)
    }
  }
  try {
    res.dia = diaPY(cuando)
  } catch (e) {
    res.errores.push('fecha inválida')
    console.error('Tareas programadas: fecha inválida', cuando, e)
    return res
  }
  const disparador = cron?.trim()
  if (disparador !== undefined && disparador !== CRON_RESUMENES && disparador !== CRON_COPIA) {
    res.errores.push(`disparador desconocido: ${disparador}`)
    console.warn(`Tareas programadas: el disparador «${disparador}» no es conocido; no se hizo nada.`)
    return res
  }
  const hoy = res.dia
  const lunes = diaDeSemana(hoy) === 0

  if (disparador === undefined || disparador === CRON_RESUMENES) {
    const periodos: Periodo[] = ['diario']
    if (lunes) periodos.push('semanal')
    if (hoy.endsWith('-01')) periodos.push('mensual')
    for (const periodo of periodos) {
      await intentar(`resumen ${periodo}`, async () => {
        const r = await enviarResumen(env, periodo, hoy)
        if (!r.enviado) {
          console.warn(`Resumen ${periodo} no enviado: ${r.motivo}`)
          return `no enviado (${r.motivo})`
        }
        return `enviado a ${r.destino}`
      })
    }
  }

  // Con el disparador de la copia, el propio cron ya es de los lunes; sin disparador se hace solo los lunes.
  if (disparador === CRON_COPIA || (disparador === undefined && lunes)) {
    // La copia y la limpieza van en un solo paso: si falla una, la otra se hace igual y se anota el primer error.
    await intentar('copia semanal', async () => {
      let clave = ''
      let fallo: unknown = null
      try {
        clave = (await hacerCopia(env, 'automatica')).clave
      } catch (e) {
        fallo = e
      }
      try {
        const r = await ejecutar(env.DB, 'DELETE FROM sesiones WHERE vence_en < ?', cuando.toISOString())
        res.hechas.push(`sesiones vencidas borradas: ${r.meta?.changes ?? 0}`)
      } catch (e) {
        fallo ??= e
      }
      if (fallo) throw fallo
      return clave
    })
  }
  return res
}
