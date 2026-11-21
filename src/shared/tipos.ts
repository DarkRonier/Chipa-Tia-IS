// Tipos compartidos entre la API (src/server) y las pantallas (src/pages).
// Todo lo que viaja por /api tiene la forma que se declara acá.

export type SectorId = 'chiperia' | 'chipitas' | 'panaderia' | 'cocina'
export type Rol = SectorId | 'supervisor' | 'cajero' | 'caja_comedor' | 'admin'
export const SECTOR_IDS: SectorId[] = ['chiperia', 'chipitas', 'panaderia', 'cocina']
/** En este orden se listan en Usuarios: los sectores, supervisor, cajero, caja comedor y al final el administrador. */
export const ROLES: Rol[] = [...SECTOR_IDS, 'supervisor', 'cajero', 'caja_comedor', 'admin']

/** Cada caja del local: la del frente (cajero) y la del comedor (Caja Comedor). Como mucho una abierta de cada una. */
export type PuntoCaja = 'frente' | 'comedor'
export const PUNTOS_CAJA: PuntoCaja[] = ['frente', 'comedor']
export const NOMBRE_PUNTO_CAJA: Record<PuntoCaja, string> = { frente: 'Caja del frente', comedor: 'Caja del comedor' }

export type Turno = 'dia' | 'noche'
export type TipoMovimiento =
  | 'produccion' | 'stock_inicial' | 'envio' | 'merma' | 'vencimiento' | 'ajuste'
  /** «Sacar para la venta»: pasa de un almacén (Frío) a un depósito de venta. Un par: sale de uno y entra en el otro. */
  | 'salida_venta'
  /** Pasa de un depósito a otro. Un par: sale de uno y entra en el otro. */
  | 'transferencia'
  /** Lo comprado a un proveedor suma al stock (M10). Al anular la compra se descuenta con el mismo tipo. */
  | 'compra'
  /** Lo vendido en caja descuenta de Venta frente (M11). Al anular la venta vuelve con el mismo tipo. */
  | 'venta'

/**
 * Depósitos fijos. `venta` es «Venta frente» (la caja del cajero descuenta de acá) y `comedor` «Venta comedor». `frio`
 * es el primer almacén en frío (el super-administrador crea y borra otros) y `materia_prima` el de lo comprado para
 * producir. Las sucursales no son un depósito: solo se registra lo que se les envía.
 */
export const DEPOSITO = { venta: 'venta', comedor: 'comedor', frio: 'frio', materiaPrima: 'materia_prima' } as const

/**
 * Tipo de depósito (Mati, 2026-11-21): venta directa (Venta frente, Venta comedor) o depósito frío ('almacen' en la
 * base: cámaras, freezers, Materia prima…). Las sucursales son el tercer tipo, pero no tienen stock: viven en su tabla.
 */
export type TipoDeposito = 'venta' | 'almacen'
export const NOMBRE_TIPO_DEPOSITO: Record<TipoDeposito | 'sucursal', string> = {
  venta: 'Venta directa',
  almacen: 'Depósito frío',
  sucursal: 'Sucursal',
}

/** Última medición de la máquina vinculada a un depósito frío. */
export interface MedicionDeposito {
  fecha: string
  temperatura: number | null
  estado: EstadoMaquina
  fueraDeRango: boolean
  usuarioNombre: string
}

export interface Deposito {
  id: string
  nombre: string
  descripcion: string
  /** Venta frente, Venta comedor y Materia prima: se renombran pero no se borran. */
  sistema: boolean
  activo: boolean
  tipo: TipoDeposito
  /** Depósito frío: máquina vinculada (opcional), con su rango y su última medición. */
  maquina: { id: string; nombre: string; tempMin: number | null; tempMax: number | null; ultima: MedicionDeposito | null } | null
  /** Venta directa: categorías de producto que admite. Vacío en los fríos (admiten cualquiera). */
  categorias: string[]
}
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
  transferencia: 'Transferencia',
  compra: 'Compra',
  venta: 'Venta',
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
  /** Solo en /auth/yo: hasta cuándo está activo el modo super-administrador en esta sesión (null si no lo está). */
  superHasta?: string | null
}

export interface Producto {
  id: string
  sector: SectorId
  nombre: string
  unidad: string
  activo: boolean
  /** Categoría (Chipas y bocaditos, Chipa Sticks, Buffet, Panificados, Materia prima, Bebidas, Amandau, Otros). También decide qué sectores la compran (M10). */
  categoriaId: string | null
  /** Subcategoría, texto libre (ej.: Gaseosas). */
  subcategoria: string
  /** Sin stock: solo se registran sus ventas (el buffet por kilo). */
  sinStock: boolean
  /** Precio de venta en caja (M11), en guaraníes; null = no se vende en caja. */
  precioVenta: number | null
  /** IVA de la factura: 10, 5 o 0 (exenta). */
  iva: Iva
  /** Código del producto (opcional), para buscarlo. */
  codigo: string
  /** Elaborado (se produce), materia prima o venta directa (reventa). Solo los dos últimos se compran. */
  tipo: TipoProducto
}

/** Elaborado: se produce (chipa, sopa). Materia prima: se compra para producir (queso, harina). Reventa: se compra y se vende así (gaseosa). */
export type TipoProducto = 'elaborado' | 'materia_prima' | 'reventa'
export const TIPOS_PRODUCTO: TipoProducto[] = ['elaborado', 'materia_prima', 'reventa']
/** Categoría «Materia prima»: la que se propone a un producto nuevo de tipo materia prima. */
export const CATEGORIA_MATERIA_PRIMA = 'cat-materia-prima'
export const NOMBRE_TIPO_PRODUCTO: Record<TipoProducto, string> = {
  elaborado: 'Elaborado (se produce)',
  materia_prima: 'Materia prima (se compra)',
  reventa: 'Venta directa (se compra y se vende)',
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
  /** Producto de materia prima (si entró con una compra): lo que usan las amasadas sale del depósito Materia prima. */
  productoId: string | null
  /** Compra con la que entró; null si se cargó a mano en «Materia prima y lotes». */
  compraId: string | null
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
  /** Lo que queda guardado de este lote (en los almacenes; no cuenta lo que está en venta). */
  stock: number
  lotesMP: UsoLoteMP[]
}

export interface ProduccionItem {
  productoId: string
  productoNombre: string
  cocinado: number
  guardado: number
  /** Depósito al que fue lo guardado. */
  depositoId: string
}

export interface Produccion {
  id: string
  sector: SectorId
  usuarioId: string
  usuarioNombre: string
  fecha: string
  dia: string
  turno: Turno
  /** Depósito de venta al que fue lo del horno. */
  depositoVentaId: string
  items: ProduccionItem[]
  lote: LoteChipa | null
  /** Materia prima que salió del depósito Materia prima con esta producción. */
  materiaPrima: { productoId: string; productoNombre: string; cantidad: number; unidad: string }[]
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
  depositoId: string
  depositoNombre: string
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
  /** Sector que lo produce (y que lo puede mover). */
  sector: SectorId
  categoriaId: string | null
  subcategoria: string
  unidad: string
  activo: boolean
  total: number
  /** Del total, cuánto hay en cada depósito (id → cantidad). Los depósitos sin nada no aparecen. */
  porDeposito: Record<string, number>
  lotes: { lote: string; cantidad: number; porDeposito: Record<string, number> }[]
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
  stock: { sector: SectorId; productoId: string; productoNombre: string; total: number; porDeposito: Record<string, number> }[]
  /** Los depósitos, en orden, para nombrar las columnas del stock. */
  depositos: Deposito[]
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
  /** A qué depósito de venta va lo del horno (Venta frente por defecto). */
  depositoVentaId?: string
  items: { productoId: string; cocinado: number; guardado: number; depositoId?: string }[]
  /** Chipería: lotes de materia prima usados y cuánto de cada uno, en la unidad del lote (E02, E03). */
  lotesMP?: { id: string; cantidad: number }[]
  /** Los otros sectores: materia prima usada (de su sector), que sale del depósito Materia prima. Opcional. */
  materiaPrima?: { productoId: string; cantidad: number }[]
}

/** «Sacar para la venta»: pasa `cantidad` de `desde` (por defecto, Frío) a `hacia` (por defecto, Venta frente). */
export interface PedidoSalida { sector?: SectorId; productoId: string; lote?: string | null; cantidad: number; desde?: string; hacia?: string }

/** Lo vendido de un producto en un depósito de venta, en un período. */
export interface VendidoFila { productoId: string; productoNombre: string; depositoId: string; cantidad: number }

/** Lo enviado a una sucursal de un producto (las sucursales no tienen stock en el sistema). */
export interface EnvioResumen {
  sucursalId: string
  sucursalNombre: string
  productoId: string
  productoNombre: string
  cantidad: number
  /** En cuántos envíos. */
  envios: number
  /** Día del último envío. */
  ultimo: string
}

export interface PedidoEnvio {
  sector?: SectorId
  sucursalId: string
  /** De qué depósito sale (el primer almacén por defecto). */
  desde?: string
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
  /** Depósito del que suma o resta. Si falta, Frío. */
  depositoId?: string
  motivo: string
}

/** Pasa `cantidad` de un producto (y lote) del depósito `desde` al depósito `hacia`. */
export interface PedidoTransferencia {
  sector?: SectorId
  productoId: string
  lote?: string | null
  cantidad: number
  desde: string
  hacia: string
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

export type Iva = 0 | 5 | 10
export const IVAS: Iva[] = [10, 5, 0]
export const NOMBRE_IVA: Record<Iva, string> = { 10: 'IVA 10 %', 5: 'IVA 5 %', 0: 'Exenta' }

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

/**
 * Una parte de un pago (pago híbrido): una factura o una venta se paga con varias partes de distintos medios.
 * Ejemplo: 1.300.000 en cheque del Banco Regional + 145.000 en cheque del Continental + 115.000 en efectivo.
 */
export interface PartePago {
  medio: MedioPago
  importe: number
  /** Banco del cheque (obligatorio en cheque) o de la transferencia (opcional). Vacío en los demás medios. */
  banco: string
  /** Número del cheque (opcional). Vacío en los demás medios. */
  chequeNumero: string
}

/** Medios que llevan banco: el cheque (obligatorio) y la transferencia (opcional). */
export const MEDIO_CON_BANCO: Record<MedioPago, boolean> = { efectivo: false, transferencia: true, tarjeta: false, qr: false, cheque: true }

/** Bancos de Paraguay que se sugieren al cargar un cheque o una transferencia (se puede escribir otro). */
export const BANCOS_SUGERIDOS = [
  // Sin Regional (se fusionó con Sudameris en 2023), Río (con Continental en 2025) ni Visión (hoy ueno).
  'Banco Continental', 'Itaú', 'Sudameris', 'Banco Nacional de Fomento', 'ueno bank', 'Banco Basa', 'Banco Familiar',
  'Banco Atlas', 'Interfisa Banco', 'Zeta Banco', 'Banco do Brasil', 'Banco de la Nación Argentina', 'Citibank', 'Bancop',
]

/** Texto corto de una parte: «Cheque Banco Regional N° 1234». */
export function describirParte(p: Pick<PartePago, 'medio' | 'banco' | 'chequeNumero'>): string {
  return [NOMBRE_MEDIO_PAGO[p.medio], p.banco, p.chequeNumero && `N° ${p.chequeNumero}`].filter(Boolean).join(' ')
}

export interface Categoria {
  id: string
  nombre: string
  activo: boolean
  /** Sectores que pueden cargar compras de los productos de esta categoría. */
  sectores: SectorId[]
  /** «Otros», la de los productos que no entran en ninguna: no se desactiva. */
  sistema: boolean
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
  /** Materia prima de Chipería: vencimiento del lote de materia prima que creó este renglón. */
  vencimiento: string | null
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
  /** Banco del cheque o de la transferencia ('' si no corresponde). */
  banco: string
  chequeNumero: string
  /** Las partes que se cargaron juntas (un pago híbrido) comparten este valor. */
  registro: string
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
  /** Obligatorio en la materia prima de Chipería (`ProductoCompra.loteMP`): crea su lote de materia prima. */
  vencimiento?: string | null
}

export interface PedidoCompra {
  /** Vacío = proveedor «Sin nombre» (proveedores locales que no dan nombre ni factura). */
  proveedorId?: string | null
  comprobante?: string
  diaCompra?: string
  vencimiento?: string | null
  nota?: string
  items: PedidoCompraItem[]
}

/** Producto que el usuario puede comprar, con el nombre de su sector y categoría. */
export interface ProductoCompra {
  id: string
  nombre: string
  unidad: string
  codigo: string
  sector: SectorId
  sectorNombre: string
  conLotes: boolean
  /** Materia prima de un sector con lotes: al comprarla se crea su lote de materia prima, con vencimiento obligatorio. */
  loteMP: boolean
  tipo: TipoProducto
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

// ---------- Caja (M13) ----------

/** Totales por medio de pago dentro de una caja. */
export interface TotalesMedio {
  medio: MedioPago
  ventas: number
  ingresos: number
  retiros: number
  /** Fondo inicial (solo efectivo) + ventas + ingresos − retiros. */
  esperado: number
}

export interface MovimientoCaja {
  id: string
  tipo: 'ingreso' | 'retiro'
  medio: MedioPago
  importe: number
  concepto: string
  /** manual = cargado en la caja; ie = gasto o ingreso de Ingresos y egresos; proveedor = pago a un proveedor. */
  origen: 'manual' | 'ie' | 'proveedor'
  usuarioNombre: string
  fecha: string
  anulado: boolean
}

export interface Arqueo {
  id: string
  usuarioNombre: string
  fecha: string
  esperado: number
  contado: number
  /** contado − esperado: positivo sobra, negativo falta. */
  diferencia: number
  nota: string
  esCierre: boolean
}

export interface Caja {
  id: string
  /** Frente o comedor. */
  punto: PuntoCaja
  abierta: boolean
  abiertaPorNombre: string
  abiertaEn: string
  dia: string
  fondoInicial: number
  cerradaPorNombre: string | null
  cerradaEn: string | null
  cantidadVentas: number
  totalVentas: number
  totales: TotalesMedio[]
  /** Efectivo que debería haber en la caja ahora (o al cerrar). */
  esperadoEfectivo: number
  contadoEfectivo: number | null
  diferencia: number | null
  notaCierre: string
  /** Solo en el detalle. */
  movimientos?: MovimientoCaja[]
  arqueos?: Arqueo[]
}

// ---------- Ventas (M11) y factura (M12) ----------

export interface ProductoVenta {
  id: string
  nombre: string
  sector: SectorId
  sectorNombre: string
  precio: number
  iva: Iva
  /** Lo que hay en Venta frente, o en Materia prima si es materia prima (puede ser negativo si se vendió sin cargarlo). */
  stock: number
  /** Sin stock (el buffet): solo se registra la venta. */
  sinStock: boolean
}

export interface VentaItem {
  productoId: string
  nombre: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  iva: Iva
  /** Código del producto (columna COD de la factura); vacío si no tiene. */
  codigo: string
}

export interface Factura {
  id: string
  /** "001-001-0000123" */
  numeroCompleto: string
  prefijo: string
  numero: number
  timbrado: string
  fecha: string
  impresiones: number
  anulada: boolean
}

export interface Venta {
  id: string
  numero: number
  cajaId: string
  clienteNombre: string
  clienteRuc: string
  clienteDireccion: string
  subtotal: number
  descuento: number
  total: number
  /** Medio principal (la parte más grande); el detalle está en `pagos`. */
  medio: MedioPago
  /** Cómo se cobró, parte por parte (una sola si se pagó con un solo medio). */
  pagos: PartePago[]
  /** Efectivo que entregó el cliente (para el vuelto de la parte en efectivo). */
  recibido: number | null
  vuelto: number | null
  usuarioNombre: string
  fecha: string
  dia: string
  anulada: boolean
  anuladaEn: string | null
  motivoAnulacion: string | null
  items: VentaItem[]
  factura: Factura | null
}

export interface PedidoVenta {
  items: { productoId: string; cantidad: number }[]
  /** Descuento en guaraníes sobre el total. */
  descuento?: number
  /** Un solo medio por el total (forma corta) … */
  medio?: MedioPago
  /** … o varias partes que suman el total (pago híbrido). */
  pagos?: { medio: MedioPago; importe: number; banco?: string; chequeNumero?: string }[]
  recibido?: number | null
  clienteNombre?: string
  clienteRuc?: string
  clienteDireccion?: string
}

/** Posición de un dato en la hoja preimpresa, en milímetros desde la esquina de arriba a la izquierda. */
export interface PosicionFactura { x: number; y: number }

/**
 * Formato de la factura preimpresa (M12): numeración y dónde va cada dato sobre la hoja de la imprenta. Los márgenes
 * corren todo junto para calibrar con la impresora. La hoja trae original y duplicado: el duplicado repite todo, corrido
 * `duplicado` mm (normalmente solo hacia abajo).
 */
export interface ConfigFactura {
  /** Versión del formato: 3 = hoja de Chipa Tía (A4, original y duplicado, medida de la foto enderezada). */
  version: number
  timbrado: string
  /** "001-002": establecimiento y punto de expedición. */
  prefijo: string
  /** Número con el que sigue la numeración (si es más alto que la última factura del sistema). */
  numeroInicial: number
  /** Último número del talonario autorizado (0 = sin límite). */
  numeroFinal: number
  /** Fin de vigencia del timbrado, AAAA-MM-DD ('' = sin control). */
  venceTimbrado: string
  anchoHoja: number
  altoHoja: number
  margenIzquierdo: number
  margenSuperior: number
  tamanoLetra: number
  /** Dónde empieza el duplicado respecto del original (x a la derecha, y hacia abajo). */
  duplicado: PosicionFactura
  fecha: PosicionFactura
  /** La X de «Contado» (las ventas de la caja son al contado). */
  contado: PosicionFactura
  cliente: PosicionFactura
  ruc: PosicionFactura
  direccion: PosicionFactura
  /** Primer renglón del detalle; los siguientes bajan `altoRenglon`. */
  detalle: PosicionFactura
  altoRenglon: number
  maxRenglones: number
  /** Columnas del detalle (x en mm): código e inicio de la descripción a la izquierda; las demás, su borde derecho. */
  columnaCodigo: number
  columnaCantidad: number
  columnaDescripcion: number
  columnaPrecio: number
  columnaExentas: number
  columna5: number
  columna10: number
  /** Fila «Valor parcial» (solo cuenta y), total (x = borde derecho), total en letras y liquidación del IVA. */
  subtotales: PosicionFactura
  total: PosicionFactura
  totalLetras: PosicionFactura
  iva5: PosicionFactura
  iva10: PosicionFactura
  totalIva: PosicionFactura
}

// ---------- Ingresos y egresos (M14) ----------

export interface GastoFijo {
  id: string
  nombre: string
  categoria: string
  importe: number
  diaDelMes: number
  esSueldo: boolean
  activo: boolean
}

/** Estado de un gasto fijo en un mes: si ya se pagó y con qué movimiento. */
export interface GastoFijoMes extends GastoFijo {
  periodo: string
  pagado: boolean
  movimientoId: string | null
  importePagado: number | null
  vence: string
}

export type OrigenIE = 'manual' | 'gasto_fijo' | 'venta' | 'proveedor'

export interface MovimientoIE {
  id: string
  tipo: 'ingreso' | 'egreso'
  dia: string
  concepto: string
  categoria: string
  importe: number
  medio: MedioPago | null
  /** Ventas y pagos a proveedores entran solos (no se cargan a mano). */
  origen: OrigenIE
  usuarioNombre: string | null
  anulado: boolean
  /** Solo en los manuales y gastos fijos. */
  desdeCaja: boolean
}

export interface ResumenIE {
  desde: string
  hasta: string
  /** El supervisor solo ve los egresos por pagos a proveedores. */
  soloProveedores: boolean
  ingresos: number
  egresos: number
  resultado: number
  porCategoria: { tipo: 'ingreso' | 'egreso'; categoria: string; importe: number }[]
  porMedio: { medio: MedioPago; ingresos: number; egresos: number }[]
  movimientos: MovimientoIE[]
}

export interface ReporteDetallado {
  desde: string
  hasta: string
  ventas: {
    cantidad: number
    bruto: number
    descuentos: number
    total: number
    anuladas: number
    ticketPromedio: number
    porMedio: { medio: MedioPago; cantidad: number; importe: number }[]
    porDia: { dia: string; cantidad: number; importe: number }[]
    porProducto: { productoId: string; nombre: string; cantidad: number; importe: number }[]
    facturas: number
  }
  cajas: Caja[]
  diferenciasCaja: number
  ie: Omit<ResumenIE, 'movimientos' | 'soloProveedores' | 'desde' | 'hasta'>
  sueldos: { pagados: number; pendientes: number; detalle: GastoFijoMes[] }
  gastosFijos: { pagados: number; pendientes: number }
  compras: { total: number; pagado: number; deudaTotal: number }
}
