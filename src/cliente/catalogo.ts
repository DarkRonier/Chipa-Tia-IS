// Consultas de catálogo que usan muchas pantallas.
import { NOMBRE_ROL_GENERAL, sectorDeRol } from '../shared/permisos'
import type { Deposito, Maquina, Rol, Sector, SectorId } from '../shared/tipos'
import { useConsulta } from './consultas'

export function useSectores() {
  const c = useConsulta<Sector[]>('/sectores')
  const lista = c.datos ?? []
  const nombre = (id: SectorId | null | undefined) => lista.find((s) => s.id === id)?.nombre ?? id ?? ''
  return { ...c, lista, nombre }
}

/** Depósitos (todos, también los desactivados: el stock viejo puede seguir ahí). `nombre(id)` para mostrarlos. */
export function useDepositos() {
  const c = useConsulta<Deposito[]>('/depositos', { todos: true })
  const lista = c.datos ?? []
  const nombre = (id: string) => lista.find((d) => d.id === id)?.nombre ?? id
  return { ...c, lista, activos: lista.filter((d) => d.activo), nombre }
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
