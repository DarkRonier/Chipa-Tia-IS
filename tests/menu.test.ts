// Barra lateral: qué opciones ve cada rol. El menú nunca ofrece una pantalla que la ruta no deja abrir (App.tsx).
import { describe, expect, it } from 'vitest'
import { menuDe } from '../src/cliente/menu'
import { inicioDe, puede, type Permiso } from '../src/shared/permisos'
import { ROLES, type Rol } from '../src/shared/tipos'

/** Permisos que pide cada ruta en App.tsx. */
const RUTAS: Record<string, Permiso[][]> = {
  '/sector': [['produccion.cargar']],
  '/sector/produccion': [['produccion.cargar']],
  '/sector/stock': [['stock.mover']],
  '/sector/salida': [['stock.mover']],
  '/sector/envio': [['stock.mover']],
  '/sector/historial': [['stock.ver']],
  '/sector/maquinas': [['maquinas.ver']],
  '/sector/limpieza': [['limpieza.cargar']],
  '/sector/lotes': [['lotes.ver']],
  '/trazabilidad': [['trazabilidad.ver']],
  '/admin': [['reportes.ver']],
  '/admin/usuarios': [['usuarios.gestionar']],
  '/admin/productos': [['catalogos.editar']],
  '/admin/catalogos': [['catalogos.editar']],
  '/admin/mantenimiento': [['catalogos.editar']],
  '/admin/stock': [['stock.ver']],
  '/admin/registros': [['produccion.ver']],
  '/admin/controles': [['limpieza.ver']],
  '/admin/historial': [['stock.ver']],
  '/admin/reportes': [['reportes.ver']],
  '/admin/datos': [['datos.gestionar']],
  '/compras': [['compras.registrar']],
  '/proveedores': [['proveedores.gestionar']],
  '/caja': [['caja.operar']],
  // Alcanza con cualquiera de los dos.
  '/finanzas': [['ie.completo'], ['ie.egresos_proveedores']],
}

const SECTORES = [
  { id: 'chiperia', nombre: 'Chipería' }, { id: 'chipitas', nombre: 'Chipitas' },
  { id: 'panaderia', nombre: 'Panadería' }, { id: 'cocina', nombre: 'Cocina y buffet' },
] as const
const sinQuery = (a: string) => a.split('?')[0]
const rutas = (rol: Rol, conLotes = true) => [...new Set(menuDe(rol, conLotes, [...SECTORES]).flatMap((g) => g.opciones.map((o) => sinQuery(o.a))))]
const textos = (rol: Rol, conLotes = true) => menuDe(rol, conLotes, [...SECTORES]).flatMap((g) => g.opciones.map((o) => o.texto))

describe('menú lateral', () => {
  it('cada rol ve solo pantallas que puede abrir, sin repetidas y con su inicio', () => {
    for (const rol of ROLES) {
      const lista = rutas(rol)
      const sinSectores = menuDe(rol, true, [...SECTORES]).flatMap((g) => g.opciones.filter((o) => !o.sector).map((o) => o.a))
      expect(lista.length).toBeGreaterThan(0)
      expect(new Set(sinSectores).size).toBe(sinSectores.length)
      expect(lista).toContain(inicioDe(rol))
      for (const a of lista) {
        const opciones = RUTAS[a]
        expect(opciones, `${a} no está en la tabla de rutas`).toBeDefined()
        expect(opciones.some((ps) => ps.every((p) => puede(rol, p))), `${rol} no puede abrir ${a}`).toBe(true)
      }
      for (const g of menuDe(rol, true)) expect(g.opciones.length).toBeGreaterThan(0)
    }
  })

  it('el administrador ve todo: gestión, finanzas completas y la vista del sector', () => {
    const t = textos('admin')
    for (const x of ['Resumen', 'Producción', 'Stock', 'Caja', 'Compras', 'Proveedores', 'Finanzas', 'Reportes', 'Productos', 'Catálogos', 'Mantenimiento', 'Usuarios', 'Datos']) {
      expect(t).toContain(x)
    }
  })

  it('Administración va primero, con el Resumen adentro como primera opción', () => {
    for (const rol of ['admin', 'supervisor'] as const) {
      const [primero] = menuDe(rol, true, [...SECTORES])
      expect(primero.titulo).toBe('Administración')
      expect(primero.opciones[0].texto).toBe('Resumen')
    }
    expect(menuDe('admin', true, [...SECTORES]).map((g) => g.titulo)).not.toContain('General')
  })

  it('el administrador tiene una entrada por cada sector, que lleva a su vista; ya no hay «Vista del sector»', () => {
    const grupo = menuDe('admin', true, [...SECTORES]).find((g) => g.titulo === 'Sectores')!
    expect(grupo.opciones.map((o) => [o.texto, o.a, o.sector])).toEqual(SECTORES.map((s) => [s.nombre, '/sector', s.id]))
    expect(textos('admin')).not.toContain('Vista del sector')
  })

  it('Productos, Catálogos y Mantenimiento son pantallas separadas, cada una con su acceso', () => {
    const opciones = menuDe('admin', true, [...SECTORES]).flatMap((g) => g.opciones)
    const a = (texto: string) => opciones.find((o) => o.texto === texto)?.a
    expect(a('Productos')).toBe('/admin/productos')
    expect(a('Catálogos')).toBe('/admin/catalogos')
    expect(a('Mantenimiento')).toBe('/admin/mantenimiento')
  })

  it('el supervisor no ve gestión ni caja; de ingresos y egresos solo «Egresos»', () => {
    const t = textos('supervisor')
    expect(t).toContain('Egresos')
    expect(t).toContain('Compras')
    for (const x of ['Finanzas', 'Caja', 'Usuarios', 'Catálogos', 'Mantenimiento', 'Productos', 'Datos', 'Chipería']) expect(t).not.toContain(x)
  })

  it('el cajero ve solo la caja', () => {
    expect(rutas('cajero')).toEqual(['/caja'])
  })

  it('un sector ve sus tareas; lotes y trazabilidad solo en Chipería', () => {
    expect(rutas('chiperia', true)).toEqual(expect.arrayContaining(['/sector/lotes', '/trazabilidad', '/compras']))
    for (const s of ['chipitas', 'panaderia', 'cocina'] as const) {
      const lista = rutas(s, false)
      expect(lista).not.toContain('/sector/lotes')
      expect(lista).not.toContain('/trazabilidad')
      expect(lista).toContain('/sector/produccion')
      expect(lista).not.toContain('/admin')
    }
  })
})
