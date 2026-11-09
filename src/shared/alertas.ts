// Avisos que el sistema muestra solo (C08, E10, G08). Cada módulo calcula los suyos en el servidor;
// la pantalla de inicio de cada sector, el Resumen del administrador y el correo diario los juntan.
import type { SectorId } from './tipos'

export type TipoAlerta =
  | 'stock_minimo' // C08: el stock en frío de un producto bajó del mínimo configurado
  | 'lote_por_vencer' // E10: lote de materia prima que vence dentro de los próximos días
  | 'lote_vencido' // E10: lote de materia prima vencido y todavía con saldo
  | 'limpieza_atrasada' // G08: un área no se limpió con la frecuencia mínima exigida

export interface Alerta {
  tipo: TipoAlerta
  /** Sector al que corresponde; null si es general. */
  sector: SectorId | null
  /** Frase lista para mostrar: «Empanadas de carne: quedan 3 en frío (mínimo 10).» */
  texto: string
  /** Ruta de la app donde se resuelve, por ejemplo «/stock» o «/lotes». */
  enlace: string
}
