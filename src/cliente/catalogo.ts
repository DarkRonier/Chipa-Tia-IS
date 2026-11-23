// Consultas de catálogo que usan muchas pantallas.
import { NOMBRE_ROL_GENERAL, sectorDeRol } from '../shared/permisos'
import { DEPOSITO, type Categoria, type Deposito, type Maquina, type Rol, type Sector, type SectorId } from '../shared/tipos'
import { useConsulta } from './consultas'

export function useSectores() {
  const c = useConsulta<Sector[]>('/sectores')
  const lista = c.datos ?? []
  const nombre = (id: SectorId | null | undefined) => lista.find((s) => s.id === id)?.nombre ?? id ?? ''
  return { ...c, lista, nombre }
}

/**
 * Depósitos que existen, en su orden: los de venta (Venta frente, Venta comedor) y los fríos. La materia prima no es un
 * depósito (no viene en la lista), pero `nombre()` la muestra como «Stock de materia prima» en el historial.
 * `nombre(id)` para mostrarlos; `venta` y `almacenes` para elegir.
 */
export const NOMBRE_STOCK_MP = 'Stock de materia prima'

export function useDepositos() {
  const c = useConsulta<Deposito[]>('/depositos')
  const lista = c.datos ?? []
  const nombre = (id: string) => lista.find((d) => d.id === id)?.nombre ?? (id === DEPOSITO.materiaPrima ? NOMBRE_STOCK_MP : id)
  return {
    ...c, lista, activos: lista, nombre,
    venta: lista.filter((d) => d.tipo === 'venta'),
    almacenes: lista.filter((d) => d.tipo === 'almacen'),
  }
}

/** Categorías de productos (Chipas y bocaditos, Chipa Sticks, Buffet, Panificados, Materia prima, Bebidas, Amandau, Otros). `nombre(id)` para mostrarlas. */
export function useCategorias() {
  const c = useConsulta<Categoria[]>('/categorias')
  const lista = c.datos ?? []
  const nombre = (id: string | null | undefined) => lista.find((x) => x.id === id)?.nombre ?? ''
  return { ...c, lista, nombre }
}

/** "Chipería", "Cocina y buffet"…, "Supervisor", "Cajero" o "Administrador". */
export function nombreRol(rol: Rol, nombreSector: (id: SectorId) => string): string {
  const sector = sectorDeRol(rol)
  return sector ? nombreSector(sector) : NOMBRE_ROL_GENERAL[rol as keyof typeof NOMBRE_ROL_GENERAL]
}

const grados = (n: number) => `${String(n).replace('.', ',').replace('-', '−')} °C`

/** "1 °C a 5 °C", "≤ −18 °C", "≥ 63 °C" o "sin control de temperatura". */
export function textoRango(m: Pick<Maquina, 'tempMin' | 'tempMax'>): string {
  if (m.tempMin !== null && m.tempMax !== null) return `${grados(m.tempMin)} a ${grados(m.tempMax)}`
  if (m.tempMax !== null) return `≤ ${grados(m.tempMax)}`
  if (m.tempMin !== null) return `≥ ${grados(m.tempMin)}`
  return 'sin control de temperatura'
}
