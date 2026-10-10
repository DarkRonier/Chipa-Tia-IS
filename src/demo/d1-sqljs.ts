// Imita la API de Cloudflare D1 sobre SQLite compilado a WebAssembly (sql.js).
// Se usa en la demo de GitHub Pages (en el navegador) y en las pruebas automáticas (Node).
import type { Database, SqlValue } from 'sql.js'
import type { BaseD1, ResultadoD1, SentenciaD1, ValorSQL } from '../server/entorno'

class Sentencia implements SentenciaD1 {
  constructor(
    private d1: D1SqlJs,
    private sql: string,
    private valores: ValorSQL[] = [],
  ) {}

  bind(...valores: ValorSQL[]): SentenciaD1 {
    // D1 rechaza undefined; se replica para que los errores aparezcan también en la demo y las pruebas.
    if (valores.some((v) => v === undefined)) throw new Error('D1_TYPE_ERROR: undefined no es un valor válido')
    return new Sentencia(this.d1, this.sql, valores)
  }

  /** Corre la sentencia sin avisar de la escritura (lo hace quien llama). */
  ejecutar<T>(): ResultadoD1<T> {
    const st = this.d1.db.prepare(this.sql)
    try {
      st.bind(this.valores as SqlValue[])
      const results: T[] = []
      while (st.step()) results.push(st.getAsObject() as T)
      return { results, success: true, meta: { changes: this.d1.db.getRowsModified() } }
    } finally {
      st.free()
    }
  }

  async first<T>(): Promise<T | null> {
    return this.ejecutar<T>().results[0] ?? null
  }

  async all<T>(): Promise<ResultadoD1<T>> {
    return this.ejecutar<T>()
  }

  async run(): Promise<ResultadoD1> {
    const r = this.ejecutar()
    this.d1.alEscribir?.()
    return r as ResultadoD1
  }
}

export class D1SqlJs implements BaseD1 {
  /** Se llama después de cada escritura confirmada (la demo la usa para guardar la base). */
  alEscribir?: () => void

  constructor(readonly db: Database) {
    db.run('PRAGMA foreign_keys = ON')
  }

  prepare(sql: string): SentenciaD1 {
    return new Sentencia(this, sql)
  }

  async batch(sentencias: SentenciaD1[]): Promise<ResultadoD1[]> {
    this.db.run('SAVEPOINT lote')
    let res: ResultadoD1[]
    try {
      res = sentencias.map((s) => {
        if (!(s instanceof Sentencia)) throw new Error('Sentencia ajena en batch')
        return s.ejecutar()
      })
    } catch (e) {
      this.db.run('ROLLBACK TO lote')
      this.db.run('RELEASE lote')
      throw e
    }
    this.db.run('RELEASE lote')
    this.alEscribir?.()
    return res
  }

  /** Copia de la base como bytes. sql.js cierra y reabre la base al exportar: se repone el PRAGMA. */
  exportar(): Uint8Array {
    const bytes = this.db.export()
    this.db.run('PRAGMA foreign_keys = ON')
    return bytes
  }

  /** Ejecuta un script SQL completo (migraciones). */
  exec(sql: string) {
    this.db.exec(sql)
  }
}
