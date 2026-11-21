// Categorías de productos nuevas (Mati, 2026-11-21, migración 0017).
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import type { Categoria, Producto } from '../src/shared/tipos'
import { nuevaPrueba } from './ayuda'

const MIGRACIONES = import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

const LAS_OCHO = ['Chipas y bocaditos', 'Chipa Sticks', 'Buffet', 'Panificados', 'Materia prima', 'Bebidas', 'Amandau', 'Otros']

describe('las 8 categorías', () => {
  it('quedan en este orden y cada producto del catálogo en la suya', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cats = (await p.pedir<Categoria[]>(admin, 'GET', '/categorias')).body
    expect(cats.map((c) => c.nombre)).toEqual(LAS_OCHO)
    const prods = (await p.pedir<Producto[]>(admin, 'GET', '/productos')).body
    const de = (nombre: string) => cats.find((c) => c.id === prods.find((x) => x.nombre === nombre)!.categoriaId)!.nombre
    expect(de('Chipa so\'o')).toBe('Chipas y bocaditos')
    expect(de('Empanada frita (carne)')).toBe('Chipas y bocaditos')
    expect(de('Sándwich de pollo')).toBe('Chipas y bocaditos')
    expect(de('Chipitas 250 g')).toBe('Chipa Sticks')
    expect(de('Menú buffet: plato del día')).toBe('Buffet')
    expect(de('Pan felipe')).toBe('Panificados')
    expect(de('Cocido negro')).toBe('Bebidas')
    // «Minutas» (0018): subcategoría de Chipas y bocaditos para lo que se hace al momento.
    const sub = (nombre: string) => prods.find((x) => x.nombre === nombre)!.subcategoria
    for (const n of ['Hamburguesa', 'Sándwich de milanesa', 'Sándwich de pollo', 'Sándwich de JyQ', 'Sándwich de verdura', 'Pollo muslo (frito)']) {
      expect(de(n)).toBe('Chipas y bocaditos')
      expect(sub(n)).toBe('Minutas')
    }
    expect(sub('Empanada frita (carne)')).toBe('')
    expect(prods.some((x) => x.categoriaId === null)).toBe(false)
  })

  it('un producto nuevo de materia prima va solo a «Materia prima»; los demás, a «Otros»', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const aceite = await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Aceite', unidad: 'L', tipo: 'materia_prima' })
    expect(aceite.body.categoriaId).toBe('cat-materia-prima')
    const vaso = await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Vaso descartable', tipo: 'reventa' })
    expect(vaso.body.categoriaId).toBe('cat-otros')
    // Si se elige una, se respeta.
    const leche = await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Leche', tipo: 'materia_prima', categoriaId: 'cat-bebidas' })
    expect(leche.body.categoriaId).toBe('cat-bebidas')
  })
})

describe('migración a las categorías nuevas (0017)', () => {
  it('reasigna los productos de una base con las categorías de antes y traslada lo que compra cada sector', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const nombres = Object.keys(MIGRACIONES).sort()
    const i = nombres.findIndex((n) => n.includes('0017_'))
    for (const n of nombres.slice(0, i)) db.exec(MIGRACIONES[n])
    db.exec(`
      INSERT INTO categorias (id, nombre, activo, orden) VALUES ('cat-propia', 'Combos', 1, 5);
      INSERT INTO productos (id, sector, nombre, unidad, activo, orden, tipo, categoria_id) VALUES
        ('x-queso', 'chiperia', 'Queso Paraguay', 'kg', 1, 50, 'materia_prima', 'cat-otros'),
        ('x-gaseosa', 'cocina', 'Gaseosa 500 ml', 'unidades', 1, 50, 'reventa', 'cat-otros'),
        ('x-vino', 'cocina', 'Vino tinto', 'unidades', 1, 51, 'reventa', 'cat-bebidas'),
        ('x-helado', 'cocina', 'Paleta de frutilla', 'unidades', 1, 52, 'reventa', 'cat-heladeria'),
        ('x-postre', 'cocina', 'Postre de la casa', 'unidades', 1, 53, 'elaborado', 'cat-otros'),
        ('x-vela', 'cocina', 'Vela de cumpleaños', 'unidades', 1, 54, 'reventa', 'cat-otros'),
        ('x-combo', 'cocina', 'Combo chipa y cocido', 'unidades', 1, 55, 'elaborado', 'cat-propia');
      INSERT INTO categorias_sectores (categoria_id, sector) VALUES
        ('cat-otros', 'chiperia'), ('cat-otros', 'panaderia'), ('cat-bebidas', 'cocina'), ('cat-heladeria', 'cocina');
    `)
    db.exec(MIGRACIONES[nombres[i]])
    const cat = (id: string) => db.exec(`SELECT c.nombre FROM productos p JOIN categorias c ON c.id = p.categoria_id WHERE p.id = '${id}'`)[0].values[0][0]
    expect(cat('x-queso')).toBe('Materia prima')
    expect(cat('x-gaseosa')).toBe('Bebidas')
    expect(cat('x-vino')).toBe('Bebidas')
    expect(cat('x-helado')).toBe('Amandau')
    expect(cat('x-postre')).toBe('Buffet')
    expect(cat('x-vela')).toBe('Otros')
    expect(cat('x-combo')).toBe('Combos')
    expect(cat('prod-chipitas-01')).toBe('Chipa Sticks')
    expect(cat('prod-chiperia-01')).toBe('Chipas y bocaditos')
    expect(cat('prod-panaderia-02')).toBe('Panificados')
    const habilitadas = db.exec(`SELECT c.nombre, x.sector FROM categorias_sectores x JOIN categorias c ON c.id = x.categoria_id ORDER BY c.nombre, x.sector`)[0].values
    expect(habilitadas).toEqual([
      ['Amandau', 'cocina'], ['Bebidas', 'cocina'], ['Materia prima', 'chiperia'], ['Materia prima', 'panaderia'],
      ['Otros', 'chiperia'], ['Otros', 'panaderia'],
    ])
    const viejas = db.exec(`SELECT COUNT(*) FROM categorias WHERE nombre IN ('Chipería', 'Chipitas', 'Heladería')`)[0].values[0][0]
    expect(viejas).toBe(0)
  })
})

describe('migraciones compatibles con D1', () => {
  // D1 (Cloudflare) corta con «too many terms in compound SELECT» si una sentencia une más de 5 SELECT; sql.js no.
  it('ninguna sentencia une más de 5 SELECT con UNION', () => {
    for (const [nombre, texto] of Object.entries(MIGRACIONES)) {
      const sinComentarios = texto.replace(/--.*$/gm, '')
      for (const sentencia of sinComentarios.split(';')) {
        const unidos = (sentencia.match(/\bUNION\b/gi) ?? []).length + 1
        expect(unidos, `${nombre}: ${sentencia.trim().slice(0, 80)}`).toBeLessThanOrEqual(5)
      }
    }
  })
})
