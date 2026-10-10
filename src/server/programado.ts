// Tareas automáticas del Worker (cron de Cloudflare `0 9 * * *`, hora UTC = 06:00 en Paraguay):
// resumen por correo diario siempre, semanal los lunes y mensual el día 1 (H04), y la copia semanal
// de toda la base los lunes (I05). Nunca lanza: si algo falla, lo anota en el log y sigue con lo demás.
import { diaDeSemana, diaPY } from '../shared/hora'
import type { Periodo } from '../shared/tipos'
import { enviarResumen } from './correo'
import type { Env } from './entorno'
import { hacerCopia } from './rutas/datos'

export interface ResultadoProgramado {
  /** Día de Paraguay en que corrió. */
  dia: string
  hechas: string[]
  errores: string[]
}

export async function tareasProgramadas(env: Env, cuando: Date): Promise<ResultadoProgramado> {
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
  const hoy = res.dia
  const periodos: Periodo[] = ['diario']
  if (diaDeSemana(hoy) === 0) periodos.push('semanal')
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
  if (diaDeSemana(hoy) === 0) {
    await intentar('copia semanal', async () => (await hacerCopia(env, 'automatica')).clave)
  }
  return res
}
