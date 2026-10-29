// Avisos automáticos (C08, E10, G08) juntos: arriba del inicio de cada sector y en el Resumen del administrador.
import { Link } from 'react-router-dom'
import { useConsulta } from '../cliente/consultas'
import type { Alerta, TipoAlerta } from '../shared/alertas'
import type { SectorId } from '../shared/tipos'

const TITULO: Record<TipoAlerta, string> = {
  stock_minimo: 'Stock bajo',
  lote_por_vencer: 'Por vencer',
  lote_vencido: 'Vencido',
  limpieza_atrasada: 'Limpieza atrasada',
}

/** Pantalla donde se resuelve cada aviso: la del sector o, para el administrador, la suya. */
function destino(a: Alerta, admin: boolean): string {
  if (!admin) return `/sector${a.enlace}`
  if (a.tipo === 'stock_minimo') return '/admin/stock'
  if (a.tipo === 'limpieza_atrasada') return '/admin/controles'
  return `/sector${a.enlace}`
}

/** Con `sector` muestra solo los de ese sector; el administrador, sin sector, ve todos con el nombre del sector. */
export default function Avisos({ sector, nombreSector }: { sector?: SectorId; nombreSector?: (s: SectorId) => string }) {
  const admin = sector === undefined
  const alertas = useConsulta<Alerta[]>('/alertas', admin ? {} : { sector })
  if (!alertas.datos?.length) return null
  return (
    <section className="avisos" aria-label="Avisos">
      {alertas.datos.map((a) => (
        <Link key={`${a.tipo}-${a.texto}`} to={destino(a, admin)} className={`aviso-item ${a.tipo === 'lote_vencido' ? 'grave' : ''}`}>
          <strong>{TITULO[a.tipo]}{admin && a.sector && nombreSector ? ` · ${nombreSector(a.sector)}` : ''}</strong>
          <span>{a.texto}</span>
        </Link>
      ))}
    </section>
  )
}
