// Ayudas para consultar D1 con parámetros posicionales.
import { diaPY } from '../shared/hora'
import type { BaseD1, SentenciaD1, ValorSQL } from './entorno'

type Param = ValorSQL | boolean | undefined

const limpiar = (ps: Param[]): ValorSQL[] =>
  ps.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p))

export function sentencia(db: BaseD1, sql: string, ...params: Param[]): SentenciaD1 {
  const s = db.prepare(sql)
  return params.length ? s.bind(...limpiar(params)) : s
}

export async function todas<T>(db: BaseD1, sql: string, ...params: Param[]): Promise<T[]> {
  return (await sentencia(db, sql, ...params).all<T>()).results
}

export async function una<T>(db: BaseD1, sql: string, ...params: Param[]): Promise<T | null> {
  return sentencia(db, sql, ...params).first<T>()
}

export async function ejecutar(db: BaseD1, sql: string, ...params: Param[]) {
  return sentencia(db, sql, ...params).run()
}

export const nuevoId = () => crypto.randomUUID()

/** Momento actual: `fecha` ISO en UTC y `dia` en hora de Paraguay. */
export function ahora(): { fecha: string; dia: string } {
  const d = new Date()
  return { fecha: d.toISOString(), dia: diaPY(d) }
}

/** "?, ?, ?" para un IN (...) con n valores. */
export const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ')

export const aBool = (v: unknown) => v === 1 || v === true || v === '1'
