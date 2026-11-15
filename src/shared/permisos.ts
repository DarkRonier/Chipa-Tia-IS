// Qué puede hacer cada rol. La API (src/server/sesion.ts → `requiere`) y las pantallas (menú, rutas y botones)
// usan esta misma tabla, así un permiso se cambia en un solo lugar.
//
// Roles (Mati, 2026-11-14):
// - Administrador: todo, incluido lo del cajero.
// - Supervisor: «admin liviano». Ve producción, stock, máquinas, limpieza, lotes, trazabilidad y reportes de
//   producción de todos los sectores. Reporta fallas o incidencias de máquinas (no carga estado ni temperatura) y
//   da el visto bueno de la limpieza. No carga producción ni mueve stock. Gestiona proveedores, registra compras de
//   cualquier categoría, marca pagos y ve los reportes simples de compras y pagos.
// - Cajero: caja, ventas y facturas (llegan en la etapa 3; por ahora solo entra a su inicio).
// - Sectores (Chipería, Chipitas, Panadería, Cocina/Buffet): cargan y ven lo de su sector. Lotes y trazabilidad
//   son solo de Chipería. Cargan compras solo de productos de su sector en las categorías que el administrador les
//   habilitó; no marcan pagos.
import type { Rol, SectorId } from './tipos'
import { SECTOR_IDS } from './tipos'

export type Permiso =
  // Producción
  | 'produccion.ver'
  | 'produccion.cargar'
  | 'produccion.corregir'
  // Stock en frío
  | 'stock.ver'
  /** Salidas a venta, envíos a sucursales y cambios de finalidad. */
  | 'stock.mover'
  /** Mermas, vencimientos, ajustes y stock inicial. */
  | 'stock.ajustar'
  // Máquinas
  | 'maquinas.ver'
  /** Lecturas: estado, temperatura, mantenimiento y foto. */
  | 'maquinas.lectura'
  /** Reportar fallas o incidencias de una máquina y marcarlas como resueltas. */
  | 'maquinas.incidencia'
  // Limpieza
  | 'limpieza.ver'
  | 'limpieza.cargar'
  /** Visto bueno («Controlado por») de una planilla de limpieza. */
  | 'limpieza.controlar'
  // Lotes de Chipería
  | 'lotes.ver'
  | 'lotes.cargar'
  | 'lotes.bloquear'
  | 'trazabilidad.ver'
  // Reportes
  /** Reportes de producción y control, con Excel. */
  | 'reportes.ver'
  /** Configurar y probar el resumen por correo. */
  | 'reportes.correo'
  // Administración
  | 'catalogos.editar'
  | 'usuarios.gestionar'
  | 'datos.gestionar'
  // Compras y proveedores (M10)
  /** Cargar compras. Los sectores, solo de productos de su sector en categorías habilitadas para ellos. */
  | 'compras.registrar'
  /** Marcar compras como pagadas (pagos parciales o totales), anular compras y pagos, ver saldos. */
  | 'compras.pagar'
  /** Alta y edición de proveedores. */
  | 'proveedores.gestionar'
  /** Reportes simples de compras y pagos a proveedores. */
  | 'reportes.compras'
  // Etapa 3: caja, ventas y facturas.
  | 'caja.operar'
  | 'ventas.registrar'
  | 'facturas.generar'
  /** En ingresos y egresos, solo los egresos por pagos a proveedores. */
  | 'ie.egresos_proveedores'
  /** Ingresos y egresos completos, gastos fijos y sueldos. */
  | 'ie.completo'
  /** Reportes detallados: cajas, ingresos y egresos, sueldos. */
  | 'reportes.detallados'

export const PERMISOS: readonly Permiso[] = [
  'produccion.ver', 'produccion.cargar', 'produccion.corregir',
  'stock.ver', 'stock.mover', 'stock.ajustar',
  'maquinas.ver', 'maquinas.lectura', 'maquinas.incidencia',
  'limpieza.ver', 'limpieza.cargar', 'limpieza.controlar',
  'lotes.ver', 'lotes.cargar', 'lotes.bloquear', 'trazabilidad.ver',
  'reportes.ver', 'reportes.correo',
  'catalogos.editar', 'usuarios.gestionar', 'datos.gestionar',
  'compras.registrar', 'compras.pagar', 'proveedores.gestionar', 'reportes.compras',
  'caja.operar', 'ventas.registrar', 'facturas.generar',
  'ie.egresos_proveedores', 'ie.completo', 'reportes.detallados',
]

/** Lo que hace cualquier sector en lo suyo. */
const DE_SECTOR: Permiso[] = [
  'produccion.ver', 'produccion.cargar',
  'stock.ver', 'stock.mover',
  'maquinas.ver', 'maquinas.lectura',
  'limpieza.ver', 'limpieza.cargar',
  'compras.registrar',
]

const TABLA: Record<Rol, readonly Permiso[]> = {
  admin: PERMISOS,
  supervisor: [
    'produccion.ver',
    'stock.ver',
    'maquinas.ver', 'maquinas.incidencia',
    'limpieza.ver', 'limpieza.controlar',
    'lotes.ver', 'trazabilidad.ver',
    'reportes.ver',
    'compras.registrar', 'compras.pagar', 'proveedores.gestionar', 'reportes.compras', 'ie.egresos_proveedores',
  ],
  cajero: ['caja.operar', 'ventas.registrar', 'facturas.generar'],
  chiperia: [...DE_SECTOR, 'lotes.ver', 'lotes.cargar', 'trazabilidad.ver'],
  chipitas: DE_SECTOR,
  panaderia: DE_SECTOR,
  cocina: DE_SECTOR,
}

export function puede(rol: Rol, permiso: Permiso): boolean {
  return TABLA[rol]?.includes(permiso) ?? false
}

export function permisosDe(rol: Rol): readonly Permiso[] {
  return TABLA[rol] ?? []
}

/** Sector propio de un rol de sector; null para administrador, supervisor y cajero (no están atados a un sector). */
export function sectorDeRol(rol: Rol): SectorId | null {
  return (SECTOR_IDS as string[]).includes(rol) ? (rol as SectorId) : null
}

/** Roles que miran todos los sectores y eligen cuál ver arriba. */
export const veTodosLosSectores = (rol: Rol) => rol === 'admin' || rol === 'supervisor'

export const NOMBRE_ROL_GENERAL: Record<Exclude<Rol, SectorId>, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  cajero: 'Cajero',
}

/** Pantalla de inicio de cada rol. */
export function inicioDe(rol: Rol): string {
  if (rol === 'admin' || rol === 'supervisor') return '/admin'
  if (rol === 'cajero') return '/caja'
  return '/sector'
}
