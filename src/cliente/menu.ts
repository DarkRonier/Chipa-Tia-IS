// Qué opciones muestra la barra lateral para cada rol, agrupadas. Sale de la misma tabla de permisos que las rutas
// (src/shared/permisos.ts), así el menú nunca ofrece una pantalla que el rol no puede abrir.
import type { NombreIcono } from '../components/Iconos'
import { puede as puedeRol, sectorDeRol, veTodosLosSectores } from '../shared/permisos'
import type { Rol } from '../shared/tipos'

export type OpcionMenu = {
  a: string
  texto: string
  icono: NombreIcono
  /** Solo se marca en la ruta exacta (no en las de abajo). */
  exacta?: boolean
  /** «Vista del sector» no se marca en Lotes ni Máquinas, que tienen su propia opción. */
  noEn?: string[]
}

export type GrupoMenu = { titulo: string; opciones: OpcionMenu[] }

/** Grupos del menú de un rol, sin los grupos vacíos. `conLotes`: el sector que se mira trabaja con lotes (Chipería). */
export function menuDe(rol: Rol, conLotes: boolean): GrupoMenu[] {
  const p = (permiso: Parameters<typeof puedeRol>[1]) => puedeRol(rol, permiso)
  const grupos: GrupoMenu[] = []
  const agregar = (titulo: string, opciones: (OpcionMenu | false)[]) => {
    const visibles = opciones.filter((o): o is OpcionMenu => Boolean(o))
    if (visibles.length) grupos.push({ titulo, opciones: visibles })
  }

  if (veTodosLosSectores(rol)) {
    // Administrador y supervisor: todo lo de todos los sectores, más la gestión.
    agregar('General', [p('reportes.ver') && { a: '/admin', texto: 'Resumen', icono: 'resumen', exacta: true }])
    agregar('Producción', [
      p('produccion.ver') && { a: '/admin/registros', texto: 'Producción', icono: 'produccion' },
      p('stock.ver') && { a: '/admin/stock', texto: 'Stock', icono: 'stock' },
      p('stock.ver') && { a: '/admin/historial', texto: 'Salidas', icono: 'historial' },
      p('maquinas.ver') && { a: '/sector/maquinas', texto: 'Máquinas', icono: 'maquinas' },
      p('limpieza.ver') && { a: '/admin/controles', texto: 'Limpieza y temperatura', icono: 'limpieza' },
      p('lotes.ver') && { a: '/sector/lotes', texto: 'Lotes', icono: 'lotes' },
      p('trazabilidad.ver') && { a: '/trazabilidad', texto: 'Trazabilidad', icono: 'trazabilidad' },
      p('produccion.cargar') && {
        a: '/sector', texto: 'Vista del sector', icono: 'inicio', noEn: ['/sector/lotes', '/sector/maquinas'],
      },
    ])
    agregar('Ventas y compras', [
      p('caja.operar') && { a: '/caja', texto: 'Caja', icono: 'caja' },
      p('compras.pagar') && { a: '/compras', texto: 'Compras', icono: 'compras' },
      p('proveedores.gestionar') && { a: '/proveedores', texto: 'Proveedores', icono: 'proveedores' },
      p('ie.completo')
        ? { a: '/finanzas', texto: 'Finanzas', icono: 'dinero' }
        : p('ie.egresos_proveedores') && { a: '/finanzas', texto: 'Egresos', icono: 'dinero' },
    ])
    agregar('Administración', [
      p('reportes.ver') && { a: '/admin/reportes', texto: 'Reportes', icono: 'reportes' },
      p('catalogos.editar') && { a: '/admin/catalogos', texto: 'Catálogos', icono: 'catalogos' },
      p('usuarios.gestionar') && { a: '/admin/usuarios', texto: 'Usuarios', icono: 'usuarios' },
      p('datos.gestionar') && { a: '/admin/datos', texto: 'Datos', icono: 'datos' },
    ])
    return grupos
  }

  if (sectorDeRol(rol)) {
    // Un sector: las mismas tareas que los botones de su inicio.
    agregar('Mi sector', [
      { a: '/sector', texto: 'Inicio', icono: 'inicio', exacta: true },
      p('produccion.cargar') && { a: '/sector/produccion', texto: 'Registrar producción', icono: 'produccion' },
      p('stock.mover') && { a: '/sector/stock', texto: 'Stock en frío', icono: 'stock' },
      p('stock.mover') && { a: '/sector/salida', texto: 'Sacar para la venta', icono: 'venta' },
      p('stock.mover') && { a: '/sector/envio', texto: 'Envío a sucursal', icono: 'envio' },
      p('stock.ver') && { a: '/sector/historial', texto: 'Historial de salidas', icono: 'historial' },
    ])
    agregar('Control', [
      p('maquinas.ver') && { a: '/sector/maquinas', texto: 'Máquinas y temperatura', icono: 'maquinas' },
      p('limpieza.cargar') && { a: '/sector/limpieza', texto: 'Limpieza', icono: 'limpieza' },
      conLotes && p('lotes.ver') && { a: '/sector/lotes', texto: 'Materia prima y lotes', icono: 'lotes' },
      conLotes && p('trazabilidad.ver') && { a: '/trazabilidad', texto: 'Trazabilidad', icono: 'trazabilidad' },
    ])
    agregar('Compras', [p('compras.registrar') && { a: '/compras', texto: 'Compras', icono: 'compras' }])
    return grupos
  }

  // Cajero.
  agregar('Ventas', [p('caja.operar') && { a: '/caja', texto: 'Caja', icono: 'caja' }])
  return grupos
}
