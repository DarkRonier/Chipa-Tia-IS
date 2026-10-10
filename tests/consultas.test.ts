// T7: cantidad de consultas a D1 por pedido (Workers Free permite 50) con muchos registros.
import { describe, expect, it } from 'vitest'
import { todasPorTrozos } from '../src/server/db'
import type { BaseD1 } from '../src/server/entorno'
import { diaPY } from '../src/shared/hora'
import type { LoteChipa, Produccion } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const CHIPA = 'prod-chiperia-01'
const QUESU = 'prod-chiperia-03'
const EMPANADA = 'prod-cocina-10'

/** Hace que env.DB cuente cada `prepare` (una consulta a D1) y devuelve el contador. */
function contarConsultas(p: Prueba) {
  const real: BaseD1 = p.env.DB
  const cuenta = { n: 0 }
  p.env.DB = {
    prepare: (sql: string) => {
      cuenta.n++
      return real.prepare(sql)
    },
    batch: (s) => real.batch(s),
  } as BaseD1
  return cuenta
}

/** Inserta filas en bloque dentro de una transacción para que sea rápido. */
async function insertar(p: Prueba, filas: (() => Promise<unknown>)[]) {
  p.d1.db.run('BEGIN')
  try {
    for (const f of filas) await f()
    p.d1.db.run('COMMIT')
  } catch (e) {
    p.d1.db.run('ROLLBACK')
    throw e
  }
}

describe('todasPorTrozos', () => {
  it('una sola consulta con un único parámetro JSON, sea cual sea el largo de la lista', async () => {
    const p = await nuevaPrueba()
    const vistas: { sql: string; params: unknown[] }[] = []
    const db = {
      prepare: (sql: string) => {
        const s = p.d1.prepare(sql)
        return { ...s, bind: (...params: any[]) => (vistas.push({ sql, params }), s.bind(...params)) }
      },
    } as unknown as BaseD1
    const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`)
    await todasPorTrozos(db, ids, (m) => `SELECT value FROM json_each(?) WHERE value IN (${m})`)
    expect(vistas).toHaveLength(1)
    expect(vistas[0].params).toEqual([JSON.stringify(ids)])
    expect(vistas[0].sql).toContain('IN (SELECT value FROM json_each(?))')
  })

  it('lista vacía: devuelve [] sin consultar', async () => {
    const p = await nuevaPrueba()
    const cuenta = contarConsultas(p)
    expect(await todasPorTrozos(p.env.DB, [], (m) => `SELECT id FROM productos WHERE id IN (${m})`)).toEqual([])
    expect(cuenta.n).toBe(0)
  })

  it('sql.js trae json_each y compara bien los ids de texto', async () => {
    const p = await nuevaPrueba()
    const r = await todasPorTrozos<{ id: string }>(p.env.DB, [CHIPA, QUESU, 'no-existe'], (m) => `SELECT id FROM productos WHERE id IN (${m}) ORDER BY id`)
    expect(r.map((f) => f.id)).toEqual([CHIPA, QUESU])
  })
})

describe('consultas por pedido con muchos registros', () => {
  it('GET /producciones del administrador con 1000 registros usa menos de 15 consultas', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const dia = diaPY()
    await insertar(p, Array.from({ length: 1000 }, (_, i) => async () => {
      const id = `prod-masiva-${i}`
      await p.sql(`INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, 'cocina', 'usr-cocina', ?, ?, 'dia')`,
        id, `${dia}T${String(8 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, dia)
      await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, 1)', id, EMPANADA, i + 1)
    }))
    const cuenta = contarConsultas(p)
    const r = await p.pedir<Produccion[]>(admin, 'GET', '/producciones')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1000)
    expect(new Set(r.body.map((x) => x.id)).size).toBe(1000)
    expect(r.body.every((x) => x.items.length === 1 && x.items[0].productoId === EMPANADA)).toBe(true)
    expect(cuenta.n).toBeLessThan(15)
  })

  it('GET /lotes-chipa con 300 lotes usa menos de 15 consultas', async () => {
    const p = await nuevaPrueba()
    const chiperia = await p.entrar('chiperia')
    const hoy = diaPY()
    await p.sql(
      `INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
       VALUES ('mp-masivo', 'Almidón', 'Codipsa', '', ?, 10, 'kg', '2099-01-01', 0, 'usr-chiperia', ?)`,
      hoy, new Date().toISOString(),
    )
    await insertar(p, Array.from({ length: 300 }, (_, i) => async () => {
      const prod = `prod-lote-${i}`
      await p.sql(`INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, 'chiperia', 'usr-chiperia', ?, ?, 'dia')`, prod, `${hoy}T12:00:00.000Z`, hoy)
      await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, 5, 7)', prod, CHIPA)
      await p.sql('INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia) VALUES (?, ?, ?, ?, ?)', `lc-${i}`, `LOTE-${i}`, prod, i + 1, hoy)
      await p.sql('INSERT INTO lote_chipa_mp (lote_chipa_id, lote_mp_id) VALUES (?, ?)', `lc-${i}`, 'mp-masivo')
    }))
    const cuenta = contarConsultas(p)
    const r = await p.pedir<LoteChipa[]>(chiperia, 'GET', '/lotes-chipa')
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(300)
    expect(new Set(r.body.map((l) => l.codigo)).size).toBe(300)
    expect(r.body.every((l) => l.horno === 5 && l.congelador === 7 && l.lotesMP.length === 1)).toBe(true)
    expect(cuenta.n).toBeLessThan(15)
  })
})
