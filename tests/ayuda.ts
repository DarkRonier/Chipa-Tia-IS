// Ayudas para probar la API completa contra una base SQLite nueva por prueba.
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { crearBaseDemo, CLAVE_DEMO } from '../src/demo/base'
import type { D1SqlJs } from '../src/demo/d1-sqljs'
import { crearApp } from '../src/server/app'
import type { Env } from '../src/server/entorno'

// JPEG mínimo de 1×1 px (válido) como data URL.
export const JPEG_1PX =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBtFFFeWeyf/9k='

let SQL: Promise<SqlJsStatic> | null = null

export interface Respuesta<T = any> {
  status: number
  body: T
}

export interface Prueba {
  d1: D1SqlJs
  env: Env
  /** Pedido a la API. `token` null = sin sesión. */
  pedir<T = any>(token: string | null, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta<T>>
  /** Entra con un usuario de la demo (contraseña 1234) y devuelve el token. */
  entrar(usuario: string, clave?: string): Promise<string>
  /** Consulta directa a la base. */
  sql<T = any>(consulta: string, ...params: (string | number | null)[]): Promise<T[]>
}

/**
 * Base nueva con catálogo de las planillas, usuarios de la demo (chiperia, chipitas, panaderia,
 * cocina, admin; contraseña 1234) y sucursales suc-centro, suc-ruta1, suc-encarnacion. Sin historial.
 */
export async function nuevaPrueba(env: Partial<Env> = {}): Promise<Prueba> {
  SQL ??= initSqlJs()
  const d1 = await crearBaseDemo(await SQL)
  const app = crearApp()
  const entorno: Env = { DB: d1, ...env }
  const pedir = async (token: string | null, metodo: string, ruta: string, cuerpo?: unknown) => {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json'
    const r = await app.fetch(
      new Request(`http://prueba/api${ruta}`, {
        method: metodo,
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      }),
      entorno,
    )
    const texto = await r.text()
    let body: any = texto
    try {
      body = JSON.parse(texto)
    } catch {
      // respuesta no JSON
    }
    return { status: r.status, body }
  }
  return {
    d1,
    env: entorno,
    pedir,
    async entrar(usuario, clave = CLAVE_DEMO) {
      const r = await pedir(null, 'POST', '/auth/login', { usuario, clave })
      if (r.status !== 200) throw new Error(`No se pudo entrar como ${usuario}: ${JSON.stringify(r.body)}`)
      return r.body.token as string
    },
    async sql(consulta, ...params) {
      return (await d1.prepare(consulta).bind(...params).all()).results as any[]
    },
  }
}
