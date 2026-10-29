// E10: alertas de lotes de materia prima vencidos o por vencer. Las calcula el servidor para que las usen la pantalla
// de Lotes (GET /lotes/alertas), el inicio de Chipería, el Resumen del administrador y el correo diario.
import type { Alerta } from '../shared/alertas'
import { diaPY, sumarDias } from '../shared/hora'
import { DIAS_AVISO_VENCIMIENTO, type LoteMP } from '../shared/tipos'
import { leerLotesMP } from './consultas'
import type { BaseD1 } from './entorno'

// La constante vive en shared/tipos para que la pantalla use el mismo plazo.
export { DIAS_AVISO_VENCIMIENTO }

/** Días enteros de `desde` a `hasta` (AAAA-MM-DD). */
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

/** "02/11" a partir de AAAA-MM-DD. */
const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/** "Harina, lote 123 (Molinos SA)" o, sin número de lote, "Harina (Molinos SA), ingreso 01/10". */
function nombreCorto(l: LoteMP): string {
  return l.numeroLote
    ? `${l.insumo}, lote ${l.numeroLote} (${l.proveedor})`
    : `${l.insumo} (${l.proveedor}), ingreso ${diaMes(l.fechaIngreso)}`
}

function cuandoVence(dias: number): string {
  if (dias === 0) return 'hoy'
  return dias === 1 ? 'mañana' : `en ${dias} días`
}

/**
 * Lotes de materia prima vencidos que todavía tienen saldo y no están bloqueados («lote_vencido»), y los que vencen
 * dentro de DIAS_AVISO_VENCIMIENTO días («lote_por_vencer»). Primero los vencidos; después, el que vence antes.
 */
export async function alertasLotes(db: BaseD1): Promise<Alerta[]> {
  const hoy = diaPY()
  const lotes = await leerLotesMP(db, { venceHasta: sumarDias(hoy, DIAS_AVISO_VENCIMIENTO) })
  return lotes
    .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.insumo.localeCompare(b.insumo))
    .map<Alerta>((l) => {
      if (l.vencimiento < hoy) {
        const hace = diasEntre(l.vencimiento, hoy)
        return {
          tipo: 'lote_vencido',
          sector: 'chiperia',
          texto: `${nombreCorto(l)}: venció el ${diaMes(l.vencimiento)} (hace ${hace === 1 ? '1 día' : `${hace} días`}).`,
          enlace: '/lotes',
        }
      }
      return {
        tipo: 'lote_por_vencer',
        sector: 'chiperia',
        texto: `${nombreCorto(l)}: vence el ${diaMes(l.vencimiento)} (${cuandoVence(diasEntre(hoy, l.vencimiento))}).`,
        enlace: '/lotes',
      }
    })
}
