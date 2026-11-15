// Tipos compartidos entre la API (src/server) y las pantallas (src/pages).
// Todo lo que viaja por /api tiene la forma que se declara acá.

export type SectorId = 'chiperia' | 'chipitas' | 'panaderia' | 'cocina'
export type Rol = SectorId | 'supervisor' | 'cajero' | 'admin'
export const SECTOR_IDS: SectorId[] = ['chiperia', 'chipitas', 'panaderia', 'cocina']
/** En este orden se listan en Usuarios: los sectores, supervisor, cajero y al final el administrador. */
export const ROLES: Rol[] = [...SECTOR_IDS, 'supervisor', 'cajero', 'admin']

export type Turno = 'dia' | 'noche'
export type TipoMovimiento =
  | 'produccion' | 'stock_inicial' | 'salida_venta' | 'envio' | 'merma' | 'vencimiento' | 'ajuste' | 'reasignacion'
  /** Lo comprado a un proveedor suma al stock (M10). Al anular la compra se descuenta con el mismo tipo. */
  | 'compra'
  /** Lo vendido en caja descuenta el stock (M11), solo en los productos marcados para eso. */
  | 'venta'
/** C05: para qué se guardó lo que está en frío: reponer la venta del propio sector o enviarlo a sucursales. */
export type Finalidad = 'reposicion' | 'distribucion'
export const FINALIDADES: Finalidad[] = ['reposicion', 'distribucion']
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
  reasignacion: 'Cambio de finalidad',
  compra: 'Compra',
  venta: 'Venta',
}
export const NOMBRE_FINALIDAD: Record<Finalidad, string> = {
  reposicion: 'Reponer venta',
  distribucion: 'Sucursales',
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

/** Falla o incidencia de una máquina que reporta el supervisor o el administrador. */
export type TipoIncidencia = 'falla' | 'incidencia'
export const NOMBRE_TIPO_INCIDENCIA: Record<TipoIncidencia, string> = {
  falla: 'Falla',
  incidencia: 'Incidencia',
}

export interface Incidencia {
  id: string
  maquinaId: string
  maquinaNombre: string
  maquinaNumero: number
  sector: SectorId
  tipo: TipoIncidencia
  descripcion: string
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
  /** null mientras sigue abierta. */
  resueltaEn: string | null
  resueltaPor: string | null
  resueltaPorNombre: string | null
  resolucion: string | null
}

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
  /** C08: con menos que esto en frío (sumando finalidades y lotes) el sistema avisa. null = sin aviso. */
  stockMinimo: number | null
  /**
   * Stock obligatorio: el stock nunca puede quedar negativo y frena las salidas que no alcanzan (por ejemplo, la chipa).
   * Sin stock obligatorio (por ejemplo, cocido o harina) puede quedar sin cargar o en negativo y nunca frena nada.
   */
  stockObligatorio: boolean
  /** Categoría para compras (M10); null = sin categoría (solo la compran el administrador y el supervisor). */
  categoriaId: string | null
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
  /** Para qué se guardó lo guardado. */
  finalidad: Finalidad
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
  finalidad: Finalidad
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
  /** Del total, lo guardado para reponer la venta y lo guardado para sucursales. */
  reposicion: number
  distribucion: number
  /** Stock mínimo configurado (C08); null si no tiene. */
  minimo: number | null
  /** El producto tiene stock obligatorio (no puede quedar negativo). */
  obligatorio: boolean
  /** Hay al menos un movimiento cargado. Sin stock obligatorio y sin movimientos, el stock está «sin cargar». */
  conMovimientos: boolean
  lotes: { lote: string; cantidad: number; reposicion: number; distribucion: number }[]
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
  stock: { sector: SectorId; productoId: string; productoNombre: string; total: number; reposicion: number; distribucion: number }[]
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
  items: { productoId: string; cocinado: number; guardado: number; finalidad?: Finalidad }[]
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
  /** De cuál de los dos stocks suma o resta. Si falta, reposición. */
  finalidad?: Finalidad
  motivo: string
}

/** Pasa `cantidad` de un producto (y lote) de la finalidad `desde` a la otra. */
export interface PedidoReasignacion {
  sector?: SectorId
  productoId: string
  lote?: string | null
  cantidad: number
  desde: Finalidad
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

export interface PedidoIncidencia {
  maquinaId: string
  tipo: TipoIncidencia
  descripcion: string
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

// ---------- Compras, proveedores y pagos (M10) ----------

/** Medios de pago (pagos a proveedores, ventas y caja). */
export type MedioPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'qr' | 'cheque'
export const MEDIOS_PAGO: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque']
export const NOMBRE_MEDIO_PAGO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  qr: 'QR / billetera',
  cheque: 'Cheque',
}

export interface Categoria {
  id: string
  nombre: string
  activo: boolean
  /** Sectores que pueden cargar compras de los productos de esta categoría. */
  sectores: SectorId[]
}

export interface Proveedor {
  id: string
  nombre: string
  ruc: string
  telefono: string
  notas: string
  activo: boolean
  /** Lo que se le debe (compras sin anular menos pagos sin anular). Solo para quien marca pagos; si no, null. */
  saldo: number | null
}

/** pendiente = no se pagó nada; parcial = se pagó una parte; pagada = saldo 0; anulada = no cuenta. */
export type EstadoCompra = 'pendiente' | 'parcial' | 'pagada' | 'anulada'
export const NOMBRE_ESTADO_COMPRA: Record<EstadoCompra, string> = {
  pendiente: 'Pendiente',
  parcial: 'Pago parcial',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

export interface CompraItem {
  id: string
  /** null = renglón de texto libre (flete, servicio…), que no toca el stock. */
  productoId: string | null
  productoNombre: string | null
  /** Sector del producto: ahí suma el stock. */
  sector: SectorId | null
  detalle: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  lote: string | null
}

export interface PagoProveedor {
  id: string
  compraId: string
  proveedorId: string
  proveedorNombre: string
  comprobante: string
  /** Fecha del pago (AAAA-MM-DD). */
  diaPago: string
  importe: number
  medio: MedioPago
  nota: string
  usuarioId: string
  usuarioNombre: string
  fecha: string
  anulado: boolean
  motivoAnulacion: string | null
}

export interface Compra {
  id: string
  proveedorId: string
  proveedorNombre: string
  /** Sector que la cargó; null si la cargó el administrador o el supervisor. */
  sector: SectorId | null
  comprobante: string
  /** Fecha del comprobante (AAAA-MM-DD). */
  diaCompra: string
  vencimiento: string | null
  total: number
  pagado: number
  saldo: number
  estado: EstadoCompra
  /** Pendiente o parcial con el vencimiento ya pasado. */
  vencida: boolean
  nota: string
  usuarioId: string
  usuarioNombre: string
  fecha: string
  anuladaEn: string | null
  anuladaPorNombre: string | null
  motivoAnulacion: string | null
  items: CompraItem[]
  /** Solo en el detalle (GET /compras/:id) y para quien puede ver pagos. */
  pagos?: PagoProveedor[]
}

export interface PedidoCompraItem {
  productoId?: string | null
  detalle?: string | null
  cantidad: number
  precioUnitario: number
  lote?: string | null
}

export interface PedidoCompra {
  proveedorId: string
  comprobante?: string
  diaCompra?: string
  vencimiento?: string | null
  nota?: string
  items: PedidoCompraItem[]
  /** Solo administrador y supervisor: pago en el momento (al contado o una entrega). */
  pago?: { importe: number; medio: MedioPago } | null
}

/** Producto que el usuario puede comprar, con el nombre de su sector y categoría. */
export interface ProductoCompra {
  id: string
  nombre: string
  unidad: string
  sector: SectorId
  sectorNombre: string
  conLotes: boolean
  categoriaId: string | null
  categoriaNombre: string | null
}

/** Cuenta corriente de un proveedor: compras y pagos en orden, con el saldo después de cada uno. */
export interface CuentaProveedor {
  proveedor: Proveedor
  totalComprado: number
  totalPagado: number
  saldo: number
  movimientos: {
    tipo: 'compra' | 'pago'
    id: string
    compraId: string
    dia: string
    fecha: string
    comprobante: string
    detalle: string
    /** Compra: suma; pago: resta (en positivo). */
    importe: number
    saldo: number
  }[]
}

export interface ReporteCompras {
  desde: string
  hasta: string
  /** Compras del período (por fecha del comprobante), sin las anuladas. */
  cantidadCompras: number
  totalComprado: number
  /** Pagos hechos en el período (por fecha de pago), de cualquier compra. */
  totalPagado: number
  /** Lo que queda por pagar de las compras del período. */
  pendientePeriodo: number
  /** Lo que se debe hoy a todos los proveedores (todas las fechas). */
  deudaTotal: number
  /** Deuda vencida hoy. */
  deudaVencida: number
  porProveedor: { proveedorId: string; proveedorNombre: string; comprado: number; pagado: number; saldo: number }[]
  porCategoria: { categoriaId: string | null; categoriaNombre: string; importe: number }[]
  porMedio: { medio: MedioPago; importe: number }[]
  pagos: PagoProveedor[]
  /** Compras con saldo y vencimiento hasta 7 días desde hoy (o ya vencidas), la más urgente primero. */
  porVencer: Compra[]
}
