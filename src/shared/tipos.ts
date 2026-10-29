// Tipos compartidos entre la API (src/server) y las pantallas (src/pages).
// Todo lo que viaja por /api tiene la forma que se declara acá.

export type SectorId = 'chiperia' | 'chipitas' | 'panaderia' | 'cocina'
export type Rol = SectorId | 'admin'
export const SECTOR_IDS: SectorId[] = ['chiperia', 'chipitas', 'panaderia', 'cocina']
export const ROLES: Rol[] = [...SECTOR_IDS, 'admin']

export type Turno = 'dia' | 'noche'
export type TipoMovimiento = 'produccion' | 'stock_inicial' | 'salida_venta' | 'envio' | 'merma' | 'vencimiento' | 'ajuste'
export type TipoAjuste = 'merma' | 'vencimiento' | 'ajuste' | 'stock_inicial'
export type Marca = 'X' | 'XX' | '-'
export type EstadoMaquina = 'funciona' | 'con_fallas' | 'fuera_de_servicio'
export type Momento = 'inicio' | 'fin' | 'inicial' | 'intermedia' | 'otro'
export type TipoMaquina = 'heladera' | 'congelador' | 'exhibidora_fria' | 'exhibidora_caliente' | 'otra'
export type Periodo = 'diario' | 'semanal' | 'mensual'
/** Lo que acepta el resumen por correo: los períodos automáticos y 'hoy' (parcial, solo para la prueba manual). */
export type PeriodoResumen = Periodo | 'hoy'

export const NOMBRE_TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  produccion: 'Producción',
  stock_inicial: 'Stock inicial',
  salida_venta: 'Salida a venta',
  envio: 'Envío',
  merma: 'Merma',
  vencimiento: 'Vencimiento',
  ajuste: 'Ajuste',
}
export const NOMBRE_ESTADO: Record<EstadoMaquina, string> = {
  funciona: 'Funciona',
  con_fallas: 'Con fallas',
  fuera_de_servicio: 'Fuera de servicio',
}
export const NOMBRE_MOMENTO: Record<Momento, string> = {
  inicio: 'Inicio de jornada',
  fin: 'Fin de jornada',
  inicial: 'T° inicial (buffet)',
  intermedia: 'T° intermedia (buffet)',
  otro: 'Otro momento',
}
export const NOMBRE_TIPO_MAQUINA: Record<TipoMaquina, string> = {
  heladera: 'Heladera (refrigeración)',
  congelador: 'Freezer / congelador',
  exhibidora_fria: 'Exhibidora fría',
  exhibidora_caliente: 'Exhibidora caliente',
  otra: 'Otra (sin temperatura)',
}
export const NOMBRE_MARCA: Record<Marca, string> = { X: 'Diaria', XX: 'Profunda', '-': 'No se hizo' }

// ---------- Entidades ----------

export interface Sector {
  id: SectorId
  nombre: string
  conLotes: boolean
}

export interface Usuario {
  id: string
  nombre: string
  usuario: string
  rol: Rol
  activo: boolean
  debeCambiarClave: boolean
  creadoEn: string
}

export interface Producto {
  id: string
  sector: SectorId
  nombre: string
  unidad: string
  activo: boolean
}

export interface Maquina {
  id: string
  sector: SectorId
  numero: number
  nombre: string
  tipo: TipoMaquina
  tempMin: number | null
  tempMax: number | null
  activo: boolean
}

export interface TareaLimpieza {
  id: string
  areaId: string
  nombre: string
  pideNumero: boolean
  activo: boolean
}

export interface AreaLimpieza {
  id: string
  nombre: string
  codigo: string
  sectores: SectorId[]
  activo: boolean
  /** G08: cada cuántos días como máximo hay que limpiar el área (1 = todos los días); null = sin exigencia. */
  frecuenciaDias: number | null
  tareas: TareaLimpieza[]
}

/** Opciones habituales de frecuencia mínima de limpieza (G08). */
export const FRECUENCIAS_LIMPIEZA: { dias: number | null; nombre: string }[] = [
  { dias: null, nombre: 'Sin exigencia' },
  { dias: 1, nombre: 'Todos los días' },
  { dias: 2, nombre: 'Cada 2 días' },
  { dias: 7, nombre: 'Cada semana' },
  { dias: 15, nombre: 'Cada 15 días' },
  { dias: 30, nombre: 'Cada mes' },
]

export interface Sucursal {
  id: string
  nombre: string
  activo: boolean
}

export interface LoteMP {
  id: string
  insumo: string
  proveedor: string
  numeroLote: string
  fechaIngreso: string
  cantidad: number
  unidad: string
  vencimiento: string
  bloqueado: boolean
  /** Lo que las amasadas ya usaron de este lote (E03), en su misma unidad. Los usos sin cantidad (anteriores) no cuentan. */
  consumido: number
  /** Lo que queda: cantidad menos consumido, nunca negativo. */
  saldo: number
  /** Sin saldo: se usó todo. Sigue visible en el historial pero no se puede elegir. */
  agotado: boolean
  /** Vencido, bloqueado o agotado: no se puede elegir para producir (E07). */
  disponible: boolean
  descripcion: string
  creadoEn: string
}

/** Un lote de materia prima usado por un lote de chipa; `cantidad` es null en los registros anteriores a E03 ("sin dato"). */
export interface UsoLoteMP {
  id: string
  descripcion: string
  cantidad: number | null
  unidad: string
}

/** Con cuántos días de anticipación se avisa que un lote de materia prima está por vencer (E10). */
export const DIAS_AVISO_VENCIMIENTO = 7

const formatoCantidadMP = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 })

/** "12,5 kg". */
export const cantidadConUnidad = (n: number, unidad: string) => `${formatoCantidadMP.format(n)} ${unidad}`

/** "Harina · Molinos del Sur · lote H-1 (7,5 kg)"; los registros anteriores a E03 no tienen cantidad. */
export const textoUsoMP = (u: UsoLoteMP) => (u.cantidad === null ? u.descripcion : `${u.descripcion} (${cantidadConUnidad(u.cantidad, u.unidad)})`)

export interface LoteChipa {
  id: string
  codigo: string
  produccionId: string | null
  amasada: number
  dia: string
  horno: number
  congelador: number
  /** Lo que queda en el congelador de este lote. */
  stock: number
  lotesMP: UsoLoteMP[]
}

export interface ProduccionItem {
  productoId: string
  productoNombre: string
  cocinado: number
  guardado: number
}

export interface Produccion {
  id: string
  sector: SectorId
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
  turno: Turno
  items: ProduccionItem[]
  lote: LoteChipa | null
  corregidoPor: string | null
  corregidoPorNombre: string | null
  corregidoEn: string | null
}

export interface Movimiento {
  id: string
  sector: SectorId
  productoId: string
  productoNombre: string
  lote: string | null
  tipo: TipoMovimiento
  cantidad: number
  motivo: string | null
  sucursalId: string | null
  sucursalNombre: string | null
  envioId: string | null
  produccionId: string | null
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
}

export interface StockFila {
  productoId: string
  productoNombre: string
  activo: boolean
  total: number
  lotes: { lote: string; cantidad: number }[]
}

export interface Lectura {
  id: string
  maquinaId: string
  maquinaNombre: string
  maquinaNumero: number
  sector: SectorId
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
  momento: Momento
  estado: EstadoMaquina
  temperatura: number | null
  fueraDeRango: boolean
  observacion: string
  mantenimiento: string | null
  mantenimientoPor: string | null
  tieneFoto: boolean
}

export interface MarcaLimpieza {
  tareaId: string
  tareaNombre: string
  marca: Marca
  numero: string | null
}

export interface Limpieza {
  id: string
  areaId: string
  areaNombre: string
  sector: SectorId
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
  comentario: string
  marcas: MarcaLimpieza[]
  controladoPor: string | null
  controladoPorNombre: string | null
  controladoEn: string | null
  /** G06: hay foto guardada; los bytes se piden aparte (`GET /limpiezas/:id/foto`). */
  tieneFoto: boolean
}

export interface Auditoria {
  id: string
  tabla: string
  registroId: string
  accion: string
  usuarioId: string
  usuarioNombre: string
  fecha: string
  antes: string | null
  despues: string | null
}

export interface Copia {
  clave: string
  fecha: string
  dia: string
  bytes: number
  origen: 'automatica' | 'manual'
}

export interface Configuracion {
  /** Correo que recibe los resúmenes (H04). */
  correoReportes: string
  /** Dirección pública del sistema, para el enlace del correo. */
  urlPublica: string
}

// ---------- Reporte (H01–H03) ----------

/** Las cuatro medidas por día y sector de GET /reportes/serie (las mismas definiciones que el reporte). */
export interface MedidasSerie {
  cocinado: number
  guardado: number
  enviado: number
  /** Unidades sacadas del frío para la venta (salida_venta). */
  vendido: number
}
export type MedidaSerie = keyof MedidasSerie

/** Un día de la serie, con todos los sectores (en cero si no hubo nada). */
export interface DiaSerie {
  dia: string
  sectores: Record<SectorId, MedidasSerie>
}

/** GET /reportes/serie: un elemento por cada día del rango, también los días sin datos. */
export interface SerieReporte {
  desde: string
  hasta: string
  dias: DiaSerie[]
}

export interface Reporte {
  desde: string
  hasta: string
  generadoEn: string
  produccion: {
    sector: SectorId
    productoId: string
    productoNombre: string
    cocinado: number
    guardado: number
  }[]
  stock: { sector: SectorId; productoId: string; productoNombre: string; total: number }[]
  envios: { sucursalId: string; sucursalNombre: string; productoNombre: string; sector: SectorId; cantidad: number }[]
  salidas: { sector: SectorId; tipo: TipoMovimiento; cantidad: number }[]
  lotesChipa: LoteChipa[]
  temperaturasFueraDeRango: Lectura[]
  maquinasConFallas: Lectura[]
  limpiezas: {
    sector: SectorId
    areaNombre: string
    cantidad: number
    sinControlar: number
    tareasNoHechas: number
  }[]
  totales: {
    cargasProduccion: number
    unidadesCocinadas: number
    unidadesGuardadas: number
    unidadesEnviadas: number
    temperaturasFueraDeRango: number
    limpiezas: number
    limpiezasSinControlar: number
  }
}

// ---------- Trazabilidad (E05, E06) ----------

/** Hacia adelante: un lote de materia prima → lotes de chipa → sucursales. */
export interface TrazabilidadMP {
  loteMP: LoteMP
  lotesChipa: LoteChipa[]
  /** Movimientos de envío de esos lotes de chipa. */
  envios: Movimiento[]
}

/** Un lote de chipa: de qué materia prima salió y adónde fue. */
export interface TrazabilidadLote {
  lote: LoteChipa
  produccion: Produccion | null
  envios: Movimiento[]
  /** Salidas a venta, mermas, vencimientos y ajustes del lote. */
  otrosMovimientos: Movimiento[]
}

/** Hacia atrás: qué recibió una sucursal y de qué lotes de materia prima. */
export interface TrazabilidadSucursal {
  sucursal: Sucursal
  envios: Movimiento[]
  lotesChipa: LoteChipa[]
  lotesMP: LoteMP[]
}

export interface RespuestaEnvio {
  envioId: string
  movimientos: Movimiento[]
}

/** Exportación completa (I02): cada tabla como lista de filas, sin contraseñas ni sesiones. */
export interface Exportacion {
  generadoEn: string
  tablas: Record<string, Record<string, string | number | null>[]>
}

export interface ResumenCorreo {
  enviado: boolean
  destino: string
  asunto: string
  html: string
  motivo?: string
}

// ---------- Cuerpos de pedidos ----------

export interface PedidoLogin { usuario: string; clave: string }
export interface RespuestaLogin { token: string; usuario: Usuario }

export interface PedidoProduccion {
  /** Solo el administrador lo indica; un operador carga siempre en su sector. */
  sector?: SectorId
  turno: Turno
  items: { productoId: string; cocinado: number; guardado: number }[]
  /** Chipería: lotes de materia prima usados y cuánto de cada uno, en la unidad del lote (E02, E03). */
  lotesMP?: { id: string; cantidad: number }[]
}

export interface PedidoSalida { sector?: SectorId; productoId: string; lote?: string | null; cantidad: number }

export interface PedidoEnvio {
  sector?: SectorId
  sucursalId: string
  items: { productoId: string; lote?: string | null; cantidad: number }[]
}

export interface PedidoAjuste {
  sector: SectorId
  productoId: string
  lote?: string | null
  tipo: TipoAjuste
  /** Positivo. Merma y vencimiento restan, stock inicial suma, el ajuste usa `sentido`. */
  cantidad: number
  sentido?: 1 | -1
  motivo: string
}

export interface PedidoLectura {
  maquinaId: string
  momento: Momento
  estado: EstadoMaquina
  temperatura: number | null
  observacion?: string
  mantenimiento?: string | null
  mantenimientoPor?: string | null
  /** Imagen ya achicada en el navegador, como data URL JPEG. */
  foto?: string | null
}

export interface PedidoLimpieza {
  areaId: string
  /** Solo el administrador lo indica cuando el área la cargan varios sectores. */
  sector?: SectorId
  marcas: { tareaId: string; marca: Marca; numero?: string | null }[]
  comentario?: string
  /** Imagen ya achicada en el navegador, como data URL JPEG. */
  foto?: string | null
}

export interface ErrorRespuesta { error: { codigo: string; mensaje: string } }
