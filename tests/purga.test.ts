// Purga de la base para la entrega (Mati, 2026-11-23): scripts/purga-entrega.sql, que se corre a mano desde Actions.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cargarHistorialDemo } from '../src/demo/historial'
import { nuevaPrueba } from './ayuda'

const PURGA = readFileSync(new URL('../scripts/purga-entrega.sql', import.meta.url), 'utf8')

describe('purga para la entrega', () => {
  it('borra lo de prueba, deja los depósitos, sucursales, máquinas, limpieza y 50 productos pedidos', async () => {
    const p = await nuevaPrueba({ MODO_DEMO: '1' })
    await cargarHistorialDemo(p.d1)
    const admin = await p.entrar('admin')
    // Una limpieza propia, además de las dos semanas de historial de la demo.
    const tareas = await p.sql("SELECT id FROM tareas_limpieza WHERE area_id = 'sanitario' AND activo = 1")
    const chiperia = await p.entrar('chiperia')
    expect((await p.pedir(chiperia, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: tareas.map((t) => ({ tareaId: t.id, marca: 'X' })) })).status).toBe(200)
    const cuenta = async (tabla: string) => (await p.sql(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n as number
    expect(await cuenta('limpiezas')).toBeGreaterThan(0)
    expect(await cuenta('movimientos')).toBeGreaterThan(0)
    const usuarios = await cuenta('usuarios')
    const proveedores = await cuenta('proveedores')

    // Claves foráneas activas, como en D1: si el orden de los DELETE estuviera mal, falla acá.
    p.d1.db.exec('PRAGMA foreign_keys = ON')
    p.d1.exec(PURGA)
    expect(p.d1.db.exec('PRAGMA foreign_key_check')).toEqual([])

    for (const t of ['limpiezas', 'limpieza_marcas', 'lecturas', 'incidencias', 'movimientos', 'producciones', 'produccion_items',
      'lotes_chipa', 'lote_chipa_mp', 'lotes_mp', 'compras', 'compra_items', 'pagos_proveedor', 'ventas', 'venta_items',
      'venta_pagos', 'facturas', 'cajas', 'caja_movimientos', 'arqueos', 'ie_movimientos', 'auditoria']) {
      expect(await cuenta(t), t).toBe(0)
    }
    expect(await cuenta('usuarios')).toBe(usuarios)
    expect(await cuenta('proveedores')).toBe(proveedores)

    const deps = (await p.pedir(admin, 'GET', '/depositos')).body as { nombre: string; tipo: string; maquinaId: string | null }[]
    expect(deps.map((d) => d.nombre).sort()).toEqual(['Depósito frío 1', 'Depósito frío 2', 'Depósito frío 3', 'Venta al frente', 'Venta comedor'])
    const maq = await p.sql('SELECT d.nombre AS deposito, m.nombre AS maquina FROM depositos d LEFT JOIN maquinas m ON m.id = d.maquina_id WHERE d.tipo = ? ORDER BY d.orden', 'almacen')
    expect(maq.filter((d) => d.deposito.startsWith('Depósito frío'))).toEqual([
      { deposito: 'Depósito frío 1', maquina: 'Heladera' },
      { deposito: 'Depósito frío 2', maquina: 'Freezer' },
      { deposito: 'Depósito frío 3', maquina: null },
    ])
    expect((await p.sql('SELECT nombre FROM sucursales ORDER BY nombre')).map((s) => s.nombre)).toEqual(['Sucursal Encarnación', 'Sucursal Ruta'])

    // Limpieza: las 10 áreas y 132 tareas de las planillas.
    expect(await cuenta('areas_limpieza')).toBe(10)
    expect(await cuenta('tareas_limpieza')).toBe(132)

    // 50 productos distintos, al menos 2 por cada categoría activa; lo que se vende tiene precio.
    const prods = await p.sql('SELECT nombre, tipo, precio_venta, categoria_id FROM productos')
    expect(prods).toHaveLength(50)
    expect(new Set(prods.map((x) => x.nombre)).size).toBe(50)
    const porCat = await p.sql('SELECT c.nombre, COUNT(p.id) AS n FROM categorias c LEFT JOIN productos p ON p.categoria_id = c.id WHERE c.activo = 1 GROUP BY c.id')
    for (const c of porCat) expect(c.n, c.nombre).toBeGreaterThanOrEqual(2)
    expect(prods.filter((x) => x.tipo !== 'materia_prima' && x.precio_venta === null)).toEqual([])

    // El sistema sigue andando después de la purga.
    const caja = await p.entrar('cajero')
    expect((await p.pedir(caja, 'POST', '/caja/abrir', { fondoInicial: 50000 })).status).toBeLessThan(300)
  })
})
