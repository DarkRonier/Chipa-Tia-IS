// Consultas de catálogo que usan muchas pantallas.
import type { Maquina, Rol, Sector, SectorId } from '../shared/tipos'
import { useConsulta } from './consultas'

export function useSectores() {
  const c = useConsulta<Sector[]>('/sectores')
  const lista = c.datos ?? []
  const nombre = (id: SectorId | null | undefined) => lista.find((s) => s.id === id)?.nombre ?? id ?? ''
  return { ...c, lista, nombre }
}

/** "Chipería", "Cocina y buffet"… o "Administrador". */
export function nombreRol(rol: Rol, nombreSector: (id: SectorId) => string): string {
  return rol === 'admin' ? 'Administrador' : nombreSector(rol)
}

const grados = (n: number) => `${String(n).replace('.', ',').replace('-', '−')} °C`

/** "1 °C a 5 °C", "≤ −18 °C", "≥ 63 °C" o "sin control de temperatura". */
export function textoRango(m: Pick<Maquina, 'tempMin' | 'tempMax'>): string {
  if (m.tempMin !== null && m.tempMax !== null) return `${grados(m.tempMin)} a ${grados(m.tempMax)}`
  if (m.tempMax !== null) return `≤ ${grados(m.tempMax)}`
  if (m.tempMin !== null) return `≥ ${grados(m.tempMin)}`
  return 'sin control de temperatura'
}
