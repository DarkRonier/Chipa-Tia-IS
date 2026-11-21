// Ayudas de stock que usan varias pantallas. Lo que hay en cada depósito se ve en la pantalla Depósitos
// (src/pages/Depositos.tsx).
import { useConsulta } from '../../cliente/consultas'
import type { Deposito, SectorId, StockFila } from '../../shared/tipos'

/** Stock de los productos de un sector, por depósito. */
export const useStock = (sector: SectorId) => useConsulta<StockFila[]>('/stock', { sector })

/** Lo que hay en un depósito (o en todos, con ''). */
export const enDeposito = (f: { total?: number; cantidad?: number; porDeposito: Record<string, number> }, deposito: string) =>
  deposito ? (f.porDeposito[deposito] ?? 0) : (f.total ?? f.cantidad ?? 0)

/** «Venta frente: 3 · Frío: 8», en el orden de los depósitos y sin los que están en 0. */
export function repartoStock(porDeposito: Record<string, number>, depositos: Deposito[]) {
  const ids = [...depositos.map((d) => d.id), ...Object.keys(porDeposito).filter((id) => !depositos.some((d) => d.id === id))]
  return ids
    .filter((id) => (porDeposito[id] ?? 0) !== 0)
    .map((id) => `${depositos.find((d) => d.id === id)?.nombre ?? id}: ${porDeposito[id]}`)
    .join(' · ')
}
