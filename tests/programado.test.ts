// T6: las tareas automáticas se reparten en dos disparadores de Cloudflare para no pasar las 50 consultas
// a D1 por ejecución de Workers Free: resúmenes (0 9 * * *) y copia semanal + sesiones vencidas (30 9 * * 1).
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaseD1, BucketR2, Env, SentenciaD1 } from '../src/server/entorno'
import { CRON_COPIA, CRON_RESUMENES, tareasProgramadas } from '../src/server/programado'
import { sumarDias } from '../src/shared/hora'
import { nuevaPrueba, type Prueba } from './ayuda'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Límite de consultas a D1 por ejecución en Workers Free. */
const LIMITE = 50

/** Lunes 1 de junio de 2026, 09:00 UTC = 06:00 en Paraguay: el peor caso (diario + semanal + mensual + copia). */
const LUNES_DIA_1 = new Date('2026-06-01T09:00:00Z')
const MIERCOLES = new Date('2026-10-14T09:00:00Z')

/**
 * Envuelve la base y cuenta las consultas como D1: cada sentencia que se ejecuta (first, all o run) cuenta una,
 * y cada sentencia dentro de un batch cuenta una (el batch en sí no suma).
 */
function contarConsultas(env: Env) {
  const original = env.DB
  const internas = new WeakMap<SentenciaD1, SentenciaD1>()
  const cuenta = { n: 0 }
  const envolver = (s: SentenciaD1): SentenciaD1 => {
    const e: SentenciaD1 = {
      bind: (...v) => envolver(s.bind(...v)),
      first: (...a) => (cuenta.n++, s.first(...a)),
      all: (...a) => (cuenta.n++, s.all(...a)),
      run: () => (cuenta.n++, s.run()),
    }
    internas.set(e, s)
    return e
  }
  const DB: BaseD1 = {
    prepare: (sql) => envolver(original.prepare(sql)),
    batch: (ss) => {
      cuenta.n += ss.length
      return original.batch(ss.map((s) => internas.get(s) ?? s))
    },
  }
  return { env: { ...env, DB }, cuenta, desde: () => (cuenta.n = 0) }
}

/** R2 en memoria. */
function simularR2() {
  const guardados = new Map<string, Uint8Array>()
  const r2: BucketR2 = {
    async put(clave, datos) {
      guardados.set(clave, datos as Uint8Array)
    },
    async get(clave) {
      const g = guardados.get(clave)
      return g ? { arrayBuffer: async () => g.slice().buffer } : null
    },
    async delete(clave) {
      guardados.delete(clave)
    },
  }
  return { r2, guardados }
}

/** Resend simulado: devuelve los asuntos de los correos que se mandaron. */
function simularResend() {
  const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ id: 'correo-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', f)
  const asuntos = () => f.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).subject as string)
  return { f, asuntos }
}

const iso = (dia: string, hora = 10) => new Date(Date.parse(`${dia}T00:00:00-03:00`) + hora * 3_600_000).toISOString()

let n = 0

/** Producción y movimientos de un día para un sector, cargados directo en la base. */
async function cargarDia(p: Prueba, sector: string, dia: string, productos: string[]) {
  const pid = `prod-prog-${++n}`
  await p.sql('INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, ?, ?, ?, ?, ?)', pid, sector, `usr-${sector}`, iso(dia), dia, 'dia')
  for (const producto of productos) {
    await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, ?)', pid, producto, 40, 20)
    for (const [tipo, cantidad, sucursal] of [['produccion', 20, null], ['envio', -8, 'suc-centro'], ['merma', -1, null]] as const) {
      await p.sql(
        `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
        `mov-prog-${++n}`, sector, producto, tipo, cantidad, sucursal, tipo === 'produccion' ? pid : null, `usr-${sector}`, iso(dia, 11), dia,
      )
    }
  }
}

/** Datos de los cuatro sectores en los 40 días anteriores a `hoy`, que cubren el diario, la semana y el mes. */
async function cargarSectores(p: Prueba, hoy: string) {
  const porSector: [string, string[]][] = [
    ['cocina', ['prod-cocina-10', 'prod-cocina-14', 'prod-cocina-24', 'prod-cocina-04']],
    ['chiperia', ['prod-chiperia-01']],
    ['chipitas', ['prod-chipitas-01']],
    ['panaderia', ['prod-panaderia-01']],
  ]
  for (let i = 1; i <= 40; i++) {
    for (const [sector, productos] of porSector) await cargarDia(p, sector, sumarDias(hoy, -i), productos)
  }
  await p.sql(`INSERT INTO lecturas (id, maquina_id, usuario_id, fecha, dia, momento, estado, temperatura, fuera_de_rango, observacion)
               SELECT 'lec-prog-' || id, id, 'usr-cocina', ?, ?, 'inicio', 'funciona', 12, 1, '' FROM maquinas LIMIT 3`, iso(sumarDias(hoy, -1)), sumarDias(hoy, -1))
}

async function preparar(opciones: { r2?: BucketR2 } = {}) {
  const resend = simularResend()
  const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>', ARCHIVOS: opciones.r2 })
  await p.sql("INSERT INTO configuracion (clave, valor) VALUES ('correoReportes', 'admin@chipatia.com'), ('urlPublica', 'https://chipatia.com')")
  await cargarSectores(p, '2026-06-01')
  // Sesiones: dos vigentes (las de entrar, que vencen dentro de 30 días) y dos vencidas antes del disparador.
  const vigente = await p.entrar('admin')
  await p.entrar('cocina')
  await p.sql("INSERT INTO sesiones (token_hash, usuario_id, creada_en, vence_en) VALUES ('hash-vencida-1', 'usr-admin', '2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z')")
  await p.sql("INSERT INTO sesiones (token_hash, usuario_id, creada_en, vence_en) VALUES ('hash-vencida-2', 'usr-cocina', '2026-05-01T00:00:00.000Z', '2026-05-31T23:59:59.000Z')")
  // Vence después del disparador (2026-06-01T09:00Z): se conserva.
  await p.sql("INSERT INTO sesiones (token_hash, usuario_id, creada_en, vence_en) VALUES ('hash-vigente', 'usr-admin', '2026-05-20T00:00:00.000Z', '2026-06-01T09:00:01.000Z')")
  return { p, resend, vigente }
}

const hashes = async (p: Prueba) => (await p.sql('SELECT token_hash FROM sesiones')).map((s) => s.token_hash as string)

describe('disparadores (T6)', () => {
  it('wrangler.jsonc tiene los dos disparadores y coinciden con las constantes', () => {
    expect(CRON_RESUMENES).toBe('0 9 * * *')
    expect(CRON_COPIA).toBe('30 9 * * 1')
    const texto = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(texto)![1]) as string[]
    expect(crons).toEqual([CRON_RESUMENES, CRON_COPIA])
  })

  it('el disparador de resúmenes un lunes día 1 manda diario, semanal y mensual en menos de 50 consultas, sin copia ni limpieza', async () => {
    const { p, resend } = await preparar()
    const { env, cuenta } = contarConsultas(p.env)
    const r = await tareasProgramadas(env, LUNES_DIA_1, CRON_RESUMENES)
    expect(r.errores).toEqual([])
    expect(resend.asuntos()).toEqual([
      'Chipa Tía · Resumen diario del 31/05/2026',
      'Chipa Tía · Resumen semanal del 25/05 al 31/05/2026',
      'Chipa Tía · Resumen mensual de mayo de 2026',
    ].map((a) => `${a} · 3 temperaturas fuera de rango`))
    expect(r.hechas).toEqual([
      'resumen diario: enviado a admin@chipatia.com',
      'resumen semanal: enviado a admin@chipatia.com',
      'resumen mensual: enviado a admin@chipatia.com',
    ])
    expect(cuenta.n).toBeGreaterThan(0)
    expect(cuenta.n).toBeLessThan(LIMITE)
    // El diario no hace la copia ni borra sesiones.
    expect(await p.sql('SELECT * FROM copias')).toEqual([])
    expect(await p.sql('SELECT * FROM archivos')).toEqual([])
    expect(await hashes(p)).toContain('hash-vencida-1')
    expect(await hashes(p)).toContain('hash-vencida-2')
  })

  it('el disparador de la copia un lunes día 1 hace la copia en R2 y borra las sesiones vencidas, en menos de 50 consultas y sin correos', async () => {
    const { r2, guardados } = simularR2()
    const { p, resend, vigente } = await preparar({ r2 })
    const { env, cuenta } = contarConsultas(p.env)
    const r = await tareasProgramadas(env, LUNES_DIA_1, CRON_COPIA)
    expect(r.errores).toEqual([])
    expect(resend.f).not.toHaveBeenCalled()
    expect(cuenta.n).toBeGreaterThan(0)
    expect(cuenta.n).toBeLessThan(LIMITE)

    const copias = await p.sql('SELECT clave, origen FROM copias')
    expect(copias).toHaveLength(1)
    expect(copias[0]).toMatchObject({ origen: 'automatica' })
    expect([...guardados.keys()]).toEqual([copias[0].clave])
    expect(r.hechas).toContain(`copia semanal: ${copias[0].clave}`)
    expect(r.hechas).toContain('sesiones vencidas borradas: 2')

    // Las vencidas se borran; las vigentes se conservan y siguen sirviendo para entrar.
    const quedan = await hashes(p)
    expect(quedan).not.toContain('hash-vencida-1')
    expect(quedan).not.toContain('hash-vencida-2')
    expect(quedan).toContain('hash-vigente')
    expect(quedan).toHaveLength(3)
    expect((await p.pedir(vigente, 'GET', '/config')).status).toBe(200)
  })

  it('sin disparador hace todo (como antes); un día común, solo el diario', async () => {
    const { p, resend } = await preparar()
    const { env, cuenta } = contarConsultas(p.env)
    const r = await tareasProgramadas(env, LUNES_DIA_1)
    expect(r.errores).toEqual([])
    expect(resend.asuntos()).toHaveLength(3)
    expect(await p.sql('SELECT origen FROM copias')).toEqual([{ origen: 'automatica' }])
    expect(await hashes(p)).not.toContain('hash-vencida-1')
    // (Todo junto son unas 59 consultas, más que el límite: por eso se separó.)
    expect(cuenta.n).toBeGreaterThan(0)

    const otro = await preparar()
    const comun = await tareasProgramadas(otro.p.env, MIERCOLES)
    expect(comun.hechas).toEqual(['resumen diario: enviado a admin@chipatia.com'])
    expect(await otro.p.sql('SELECT * FROM copias')).toEqual([])
    expect(await hashes(otro.p)).toContain('hash-vencida-1')
  })

  it('el disparador de resúmenes un día común manda solo el diario', async () => {
    const { p, resend } = await preparar()
    const r = await tareasProgramadas(p.env, MIERCOLES, CRON_RESUMENES)
    expect(r.errores).toEqual([])
    expect(resend.asuntos()).toEqual(['Chipa Tía · Resumen diario del 13/10/2026'])
    expect(await p.sql('SELECT * FROM copias')).toEqual([])
  })

  it('un disparador desconocido no hace nada, no consulta la base y queda anotado', async () => {
    const { p, resend } = await preparar()
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { env, cuenta } = contarConsultas(p.env)
    const r = await tareasProgramadas(env, LUNES_DIA_1, '*/5 * * * *')
    expect(r.hechas).toEqual([])
    expect(r.errores).toEqual(['disparador desconocido: */5 * * * *'])
    expect(aviso).toHaveBeenCalled()
    expect(cuenta.n).toBe(0)
    expect(resend.f).not.toHaveBeenCalled()
    expect(await p.sql('SELECT * FROM copias')).toEqual([])
    expect(await hashes(p)).toContain('hash-vencida-1')
  })

  it('si falla la copia igual borra las sesiones vencidas, y si falla la base lo anota sin lanzar', async () => {
    const { p } = await preparar()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r2 = { put: async () => { throw new Error('R2 caído') }, get: async () => null, delete: async () => undefined }
    const r = await tareasProgramadas({ ...p.env, ARCHIVOS: r2 }, LUNES_DIA_1, CRON_COPIA)
    expect(r.errores).toEqual(['copia semanal: R2 caído'])
    expect(await hashes(p)).not.toContain('hash-vencida-1')
    expect(await hashes(p)).toContain('hash-vigente')

    const rota = { ...p.env, DB: { prepare: () => { throw new Error('D1 caída') }, batch: async () => { throw new Error('D1 caída') } } }
    const r3 = await tareasProgramadas(rota, LUNES_DIA_1, CRON_COPIA)
    expect(r3.errores).toEqual(['copia semanal: D1 caída'])
  })
})
