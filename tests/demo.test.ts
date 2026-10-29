// La demo guarda su base en el navegador: al reabrirla tiene que recibir las migraciones nuevas.
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { crearBaseDemo } from '../src/demo/base'

const MIGRACIONES = import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

describe('base de la demo', () => {
  it('una base guardada antes de contar migraciones recibe las que le faltan al reabrirse', async () => {
    const SQL = await initSqlJs()
    const vieja = new SQL.Database()
    for (const nombre of Object.keys(MIGRACIONES).sort().slice(0, 4)) vieja.exec(MIGRACIONES[nombre])
    const d1 = await crearBaseDemo(SQL, vieja.export())
    const columnas = d1.db.exec('PRAGMA table_info(usuarios)')[0].values.map((c) => c[1])
    expect(columnas).toContain('borrado_en')
    // Reabrirla otra vez no repite nada.
    const otra = await crearBaseDemo(SQL, d1.exportar())
    expect(Number(otra.db.exec('PRAGMA user_version')[0].values[0][0])).toBe(Object.keys(MIGRACIONES).length)
  })
})
