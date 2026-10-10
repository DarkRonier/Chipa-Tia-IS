// Interfaces mínimas de lo que la API usa de Cloudflare. Así el mismo código corre en el Worker
// (D1 y R2 reales), en el navegador para la demo (SQLite en WebAssembly) y en las pruebas.
import type { Rol, SectorId } from '../shared/tipos'

export type ValorSQL = string | number | null

export interface ResultadoD1<T = Record<string, unknown>> {
  results: T[]
  success: boolean
  meta: { changes?: number; last_row_id?: number } & Record<string, unknown>
}

export interface SentenciaD1 {
  bind(...valores: ValorSQL[]): SentenciaD1
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<ResultadoD1<T>>
  run(): Promise<ResultadoD1>
}

export interface BaseD1 {
  prepare(sql: string): SentenciaD1
  /** Ejecuta todas las sentencias en una transacción: si una falla, no queda ninguna. */
  batch(sentencias: SentenciaD1[]): Promise<ResultadoD1[]>
}

export interface ObjetoR2 {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

export interface BucketR2 {
  put(clave: string, datos: ArrayBuffer | Uint8Array | string, opciones?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(clave: string): Promise<ObjetoR2 | null>
  delete(clave: string): Promise<void>
}

export interface Env {
  DB: BaseD1
  /** Fotos y copias semanales. Si falta (demo, pruebas) se guardan en la tabla `archivos`. */
  ARCHIVOS?: BucketR2
  /** Clave de Resend para los correos de reportes (H04). */
  RESEND_API_KEY?: string
  /** Remitente verificado en Resend, por ejemplo "Chipa Tía <reportes@chipatia.com>". */
  CORREO_REMITENTE?: string
  /** Modo demo: sin correos reales; el resumen se devuelve como vista previa. */
  MODO_DEMO?: string
}

export interface UsuarioSesion {
  id: string
  nombre: string
  usuario: string
  rol: Rol
  /** El sector propio del operador; null para el administrador. */
  sector: SectorId | null
  debeCambiarClave: boolean
}

export interface Entorno {
  Bindings: Env
  Variables: { usuario: UsuarioSesion }
}
