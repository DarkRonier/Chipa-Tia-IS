// Avisos que el sistema muestra solo (C08, E10, G08). Cada módulo calcula los suyos en el servidor;
// la pantalla de inicio de cada sector, el Resumen del administrador y el correo diario los juntan.
import type { SectorId } from './tipos'

export type TipoAlerta =
  | 'stock_minimo' // C08: el stock en frío de un producto bajó del mínimo configurado
  | 'lote_por_vencer' // E10: lote de materia prima que vence dentro de los próximos días
  | 'lote_vencido' // E10: lote de materia prima vencido y todavía con saldo
  | 'limpieza_atrasada' // G08: un área no se limpió con la frecuencia mínima exigida
  | 'incidencia_maquina' // falla o incidencia de una máquina reportada y todavía sin resolver
  | 'compra_por_vencer' // M10: compra con saldo que vence en los próximos días
  | 'compra_vencida' // M10: compra con saldo y el vencimiento ya pasado
  | 'caja_sin_cerrar' // M13: la caja quedó abierta desde un día anterior
  | 'gasto_fijo_pendiente' // M14: gasto fijo (o sueldo) del mes vencido y sin marcar como pagado

export interface Alerta {
  tipo: TipoAlerta
  /** Sector al que corresponde; null si es general. */
  sector: SectorId | null
  /** Frase lista para mostrar: «Empanadas de carne: quedan 3 en frío (mínimo 10).» */
  texto: string
  /** Ruta de la app donde se resuelve, por ejemplo «/stock» o «/lotes». */
  enlace: string
}
