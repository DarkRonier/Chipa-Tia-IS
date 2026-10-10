// La demo de GitHub Pages arranca con dos semanas de historial cargado por la API.
import { describe, expect, it } from 'vitest'
import { cargarHistorialDemo } from '../src/demo/historial'
import { nuevaPrueba } from './ayuda'

describe('historial de la demo', () => {
  it('carga dos semanas de datos de los cuatro sectores sin errores', async () => {
    const p = await nuevaPrueba({ MODO_DEMO: '1' })
    await cargarHistorialDemo(p.d1)
    const cuenta = async (tabla: string) => (await p.sql(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n as number
    expect(await cuenta('producciones')).toBeGreaterThan(50)
    expect(await cuenta('lotes_chipa')).toBeGreaterThan(20)
    expect(await cuenta('lecturas')).toBeGreaterThan(100)
    expect(await cuenta('limpiezas')).toBeGreaterThan(50)
    expect(await cuenta('sesiones')).toBe(0)
    // Los registros quedan repartidos en 14 días y los lotes llevan el código de su día.
    const dias = await p.sql('SELECT COUNT(DISTINCT dia) AS n FROM producciones')
    expect(dias[0].n).toBeGreaterThanOrEqual(13)
    const lotes = await p.sql('SELECT codigo, dia, amasada FROM lotes_chipa')
    for (const l of lotes) expect(l.codigo).toBe(`CH-${l.dia.slice(2).replaceAll('-', '')}-${l.amasada}`)
    // Ningún stock queda negativo y hay temperaturas fuera de rango para mostrar.
    const negativos = await p.sql('SELECT sector, producto_id, lote, SUM(cantidad) AS s FROM movimientos GROUP BY 1, 2, 3 HAVING s < 0')
    expect(negativos).toEqual([])
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas WHERE fuera_de_rango = 1'))[0].n).toBeGreaterThan(0)
    // Se puede seguir usando: el admin entra y ve el reporte de la semana.
    const t = await p.entrar('admin')
    expect((await p.pedir(t, 'GET', '/stock?sector=cocina')).status).toBe(200)
  }, 60_000)
})
