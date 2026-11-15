// Avisos automáticos (C08, E10, G08 e incidencias de máquinas) juntos: arriba del inicio de cada sector y en el Resumen
// del administrador y del supervisor.
import { Link } from 'react-router-dom'
import { useConsulta } from '../cliente/consultas'
import type { Alerta, TipoAlerta } from '../shared/alertas'
import type { SectorId } from '../shared/tipos'

const TITULO: Record<TipoAlerta, string> = {
  stock_minimo: 'Stock bajo',
  lote_por_vencer: 'Por vencer',
  lote_vencido: 'Vencido',
  limpieza_atrasada: 'Limpieza atrasada',
  incidencia_maquina: 'Máquina',
  compra_por_vencer: 'Pago por vencer',
  compra_vencida: 'Pago vencido',
  caja_sin_cerrar: 'Caja',
  gasto_fijo_pendiente: 'Gasto fijo',
}

/** Pantalla donde se resuelve cada aviso: la del sector o, para el administrador y el supervisor, la suya. */
function destino(a: Alerta, admin: boolean): string {
  if (a.tipo === 'compra_por_vencer' || a.tipo === 'compra_vencida') return '/compras?ver=pendientes'
  if (a.tipo === 'caja_sin_cerrar' || a.tipo === 'gasto_fijo_pendiente') return a.enlace
  if (!admin) return `/sector${a.enlace}`
  // La máquina puede ser de otro sector que el elegido arriba: el enlace lo lleva para cambiarlo.
  if (a.tipo === 'incidencia_maquina') return `/sector${a.enlace}${a.sector ? `&sector=${a.sector}` : ''}`
  if (a.tipo === 'stock_minimo') return '/admin/stock'
  if (a.tipo === 'limpieza_atrasada') return '/admin/controles'
  return `/sector${a.enlace}`
}

/** Con `sector` muestra solo los de ese sector; el administrador, sin sector, ve todos con el nombre del sector. */
export default function Avisos({ sector, nombreSector, tipos }: { sector?: SectorId; nombreSector?: (s: SectorId) => string; tipos?: Alerta['tipo'][] }) {
  const admin = sector === undefined
  const alertas = useConsulta<Alerta[]>('/alertas', admin ? {} : { sector })
  const lista = (alertas.datos ?? []).filter((a) => !tipos || tipos.includes(a.tipo))
  if (!lista.length) return null
  return (
    <section className="avisos" aria-label="Avisos">
      {lista.map((a) => (
        <Link key={`${a.tipo}-${a.texto}`} to={destino(a, admin)} className={`aviso-item ${a.tipo === 'lote_vencido' || a.tipo === 'incidencia_maquina' || a.tipo === 'compra_vencida' ? 'grave' : ''}`}>
          <strong>{TITULO[a.tipo]}{admin && a.sector && nombreSector ? ` · ${nombreSector(a.sector)}` : ''}</strong>
          <span>{a.texto}</span>
        </Link>
      ))}
    </section>
  )
}
