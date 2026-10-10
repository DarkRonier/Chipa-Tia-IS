// Consultas de catálogo que usan muchas pantallas.
import type { Sector, SectorId } from '../shared/tipos'
import { useConsulta } from './consultas'

export function useSectores() {
  const c = useConsulta<Sector[]>('/sectores')
  const lista = c.datos ?? []
  const nombre = (id: SectorId | null | undefined) => lista.find((s) => s.id === id)?.nombre ?? id ?? ''
  return { ...c, lista, nombre }
}
