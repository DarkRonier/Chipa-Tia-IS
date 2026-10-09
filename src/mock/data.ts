// Datos de ejemplo para el prototipo. Los nombres de productos de Cocina, las
// variedades de chipa, las áreas de limpieza y los rangos de temperatura salen
// de las planillas en papel; lo marcado como "ejemplo" se confirma en el relevamiento.

export type SectorId = 'chiperia' | 'chipitas' | 'panaderia' | 'cocina'
export type Rol = SectorId | 'admin'

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
}

export interface Producto {
  id: string
  sector: SectorId
  nombre: string
  activo: boolean
}

export type TipoMaquina = 'heladera' | 'congelador' | 'exhibidora_fria' | 'exhibidora_caliente' | 'otra'

export interface Maquina {
  id: string
  sector: SectorId
  numero: number
  nombre: string
  tipo: TipoMaquina
  tempMin: number | null
  tempMax: number | null
}

export interface AreaLimpieza {
  id: string
  nombre: string
  codigo: string
  sectores: SectorId[]
  items: { id: string; nombre: string; pideNumero?: boolean }[]
}

export interface Sucursal {
  id: string
  nombre: string
}

export interface LoteMP {
  id: string
  insumo: 'Queso' | 'Almidón'
  proveedor: string
  fechaLote: string
  vencimiento: string
  cantidadKg: number
  bloqueado: boolean
}

export const SECTORES: Sector[] = [
  { id: 'chiperia', nombre: 'Chipería', conLotes: true },
  { id: 'chipitas', nombre: 'Chipitas', conLotes: false },
  { id: 'panaderia', nombre: 'Panadería', conLotes: false },
  { id: 'cocina', nombre: 'Cocina y buffet', conLotes: false },
]

export const USUARIOS: Usuario[] = [
  { id: 'u1', nombre: 'Encargado Chipería', usuario: 'chiperia', rol: 'chiperia', activo: true },
  { id: 'u2', nombre: 'Encargado Chipitas', usuario: 'chipitas', rol: 'chipitas', activo: true },
  { id: 'u3', nombre: 'Encargado Panadería', usuario: 'panaderia', rol: 'panaderia', activo: true },
  { id: 'u4', nombre: 'Encargado Cocina', usuario: 'cocina', rol: 'cocina', activo: true },
  { id: 'u6', nombre: 'Administración', usuario: 'admin', rol: 'admin', activo: true },
]

const p = (sector: SectorId, nombres: string[]): Producto[] =>
  nombres.map((nombre, i) => ({ id: `${sector}-${i + 1}`, sector, nombre, activo: true }))

export const PRODUCTOS: Producto[] = [
  ...p('chiperia', [
    'Chipa tradicional', "Chipa so'o", 'Chipa quesú', 'Chipa cheddar', 'Chipa pollo',
    'Chipa JyQ', 'Chipa dulce', 'Chipa pepperoni', 'Argolla chica', 'Argolla grande', 'Chipa mestizo',
  ]),
  ...p('cocina', [
    'Asadito (brochet de pollo)', 'Cocido con leche', 'Cocido negro', 'Croquete de carne',
    'Croquete de huevo', 'Croquete de salchicha', 'Empanada al horno (carne)', 'Empanada al horno (pollo)',
    'Empanada al horno (JyQ)', 'Empanada frita (carne)', 'Empanada frita (pollo)', 'Empanada frita (JyQ)',
    'Empanada frita (choclo)', 'Marinera de carne', 'Marinera de pollo', 'Mbeju', 'Pollo muslo (frito)',
    'Sándwich de verdura', 'Sándwich de JyQ', 'Sándwich de milanesa', 'Sándwich de pollo', 'Sopa', 'Fugaza',
    'Menú buffet: plato del día (ejemplo)', 'Menú buffet: guarnición (ejemplo)',
  ]),
  ...p('chipitas', ['Chipitas 100 g (ejemplo)', 'Chipitas 250 g (ejemplo)', 'Chipitas 500 g (ejemplo)']),
  ...p('panaderia', ['Pan felipe (ejemplo)', 'Pan de leche (ejemplo)', 'Galleta (ejemplo)']),
]

export const MAQUINAS: Maquina[] = [
  { id: 'm1', sector: 'cocina', numero: 1, nombre: 'Heladera inox', tipo: 'heladera', tempMin: 1, tempMax: 5 },
  { id: 'm2', sector: 'cocina', numero: 2, nombre: 'Freezer 1', tipo: 'congelador', tempMin: null, tempMax: -18 },
  { id: 'm3', sector: 'cocina', numero: 3, nombre: 'Freezer 2', tipo: 'congelador', tempMin: null, tempMax: -18 },
  { id: 'm4', sector: 'cocina', numero: 4, nombre: 'Abatidor', tipo: 'congelador', tempMin: null, tempMax: -18 },
  { id: 'm5', sector: 'cocina', numero: 5, nombre: 'Horno', tipo: 'otra', tempMin: null, tempMax: null },
  { id: 'm6', sector: 'chiperia', numero: 1, nombre: 'Freezer horizontal', tipo: 'congelador', tempMin: null, tempMax: -18 },
  { id: 'm7', sector: 'chiperia', numero: 2, nombre: 'Abatidor', tipo: 'congelador', tempMin: null, tempMax: -18 },
  { id: 'm8', sector: 'chiperia', numero: 3, nombre: 'Amasadora', tipo: 'otra', tempMin: null, tempMax: null },
  { id: 'm9', sector: 'cocina', numero: 6, nombre: 'Buffet: exhibidora fría', tipo: 'exhibidora_fria', tempMin: 1, tempMax: 10 },
  { id: 'm10', sector: 'cocina', numero: 7, nombre: 'Buffet: bufetera caliente', tipo: 'exhibidora_caliente', tempMin: 63, tempMax: null },
  { id: 'm11', sector: 'chipitas', numero: 1, nombre: 'Máquina de chipitas', tipo: 'otra', tempMin: null, tempMax: null },
  { id: 'm12', sector: 'panaderia', numero: 1, nombre: 'Fermentadora', tipo: 'otra', tempMin: null, tempMax: null },
]

export const TIPOS_MAQUINA: Record<TipoMaquina, string> = {
  heladera: 'Heladera (refrigeración)',
  congelador: 'Freezer / congelador',
  exhibidora_fria: 'Exhibidora fría',
  exhibidora_caliente: 'Exhibidora caliente',
  otra: 'Otra (sin temperatura)',
}

const items = (prefijo: string, nombres: string[], conNumero: string[] = []) =>
  nombres.map((nombre, i) => ({ id: `${prefijo}-${i + 1}`, nombre, pideNumero: conNumero.includes(nombre) || undefined }))

export const AREAS_LIMPIEZA: AreaLimpieza[] = [
  {
    id: 'chiperia', nombre: 'Chipería', codigo: 'RE-09.04', sectores: ['chiperia'],
    items: items('chi', ['Pared', 'Techo', 'Ventanas', 'Extractor', 'Puerta', 'Batidora', 'Hornos', 'Carro de enfriamiento',
      'Abatidor', 'Freezer horizontal', 'Amasadora', 'Utensilios de trabajo', 'Pileta de lavado', 'Mesada de trabajo', 'Piso', 'Basureros']),
  },
  {
    id: 'chipitas', nombre: 'Chipitas: producción', codigo: 'RE-09.05', sectores: ['chipitas'],
    items: items('cht', ['Techo', 'Pared', 'Puerta', 'Horno', 'Amasadora', 'Refinadora', 'Máquina de chipitas',
      'Utensilios de trabajo', 'Bandejas', 'Carro de enfriamiento', 'Mesada de trabajo', 'Piso', 'Basureros']),
  },
  {
    id: 'chipitas-dep', nombre: 'Chipitas: depósitos', codigo: 'RE-09.05', sectores: ['chipitas'],
    items: items('chd', ['Depósito MP: techo', 'Depósito MP: pared', 'Depósito MP: piso', 'Depósito MP: pallets',
      'Producto terminado: techo', 'Producto terminado: pared', 'Producto terminado: piso', 'Producto terminado: pallets']),
  },
  {
    id: 'panaderia', nombre: 'Panadería', codigo: 'RE-09.06', sectores: ['panaderia'],
    items: items('pan', ['Techo', 'Pared', 'Piso', 'Puerta', 'Mesada de trabajo', 'Utensilios de trabajo', 'Horno',
      'Amasadora', 'Refinadora', 'Fermentadora', 'Estantes', 'Contenedores de materia prima', 'Basurero']),
  },
  {
    id: 'cocina', nombre: 'Cocina', codigo: 'RE-09.03', sectores: ['cocina'],
    items: items('coc', ['Techo', 'Pared', 'Azulejos', 'Mampara y ventanales', 'Ventiladores', 'Extractores', 'Puerta', 'Piso',
      'Campana de extracción', 'Cocina industrial 6 hornallas', 'Cocina industrial 4 hornallas', 'Molino', 'Sierra de carne',
      'Cortador de verduras', 'Heladera inox', 'Freezer', 'Horno', 'Freidoras', 'Mesadas de trabajo', 'Utensilios de trabajo',
      'Estante de utensilios', 'Estante de materia prima', 'Pileta de lavado con mesada', 'Recipientes y contenedores',
      'Abatidor', 'Máquina de agua caliente', 'Basureros'], ['Freezer', 'Horno', 'Freidoras']),
  },
  {
    id: 'buffet', nombre: 'Buffet', codigo: 'RE-09.07', sectores: ['cocina'],
    items: items('buf', ['Pared', 'Techo', 'Ventanas', 'Bufeteras', 'Balanza', 'Mesas', 'Cubierto del servicio', 'Piso', 'Basurero']),
  },
  {
    id: 'lavadero', nombre: 'Lavadero de utensilios', codigo: 'RE-09.08', sectores: ['cocina'],
    items: items('lav', ['Piso', 'Pared', 'Techo', 'Puerta', 'Pileta de lavado', 'Estantes', 'Porta utensilios para escurrir',
      'Utensilios varios', 'Basurero con tapa', 'Pasillo logístico'], ['Pileta de lavado']),
  },
  {
    id: 'sanitario', nombre: 'Sanitario', codigo: 'RE-09.09', sectores: ['cocina'],
    items: items('san', ['Piso', 'Pared', 'Techo', 'Lavamanos', 'Inodoro', 'Ventana', 'Puerta', 'Basurero']),
  },
  {
    id: 'deposito-mp', nombre: 'Depósito de materia prima', codigo: 'RE-09.02', sectores: ['chiperia'],
    items: items('dmp', ['Techo', 'Puerta', 'Pared', 'Pallets', 'Estantes', 'Piso']),
  },
  {
    id: 'camaras', nombre: 'Antecámara y cámaras', codigo: 'RE-09.0x', sectores: ['cocina'],
    items: items('cam', ['Antecámara: techo', 'Antecámara: cortina PVC', 'Antecámara: pared', 'Antecámara: estantes',
      'Antecámara: recipientes', 'Antecámara: pallets', 'Antecámara: piso', 'Cámara cárnicos: techo', 'Cámara cárnicos: puerta',
      'Cámara cárnicos: pared', 'Cámara cárnicos: evaporador', 'Cámara cárnicos: estantes', 'Cámara cárnicos: ganchos',
      'Cámara cárnicos: pallets', 'Cámara cárnicos: piso', 'Cámara en proceso: techo', 'Cámara en proceso: puerta',
      'Cámara en proceso: pared', 'Cámara en proceso: evaporador', 'Cámara en proceso: estantes', 'Cámara en proceso: pallets',
      'Cámara en proceso: piso']),
  },
]

export const SUCURSALES: Sucursal[] = [
  { id: 's1', nombre: 'Sucursal 1 (ejemplo)' },
  { id: 's2', nombre: 'Sucursal 2 (ejemplo)' },
  { id: 's3', nombre: 'Sucursal 3 (ejemplo)' },
]

export const LOTES_MP: LoteMP[] = [
  { id: 'mp1', insumo: 'Queso', proveedor: 'Tatiana', fechaLote: '2026-10-02', vencimiento: '2026-10-20', cantidadKg: 40, bloqueado: false },
  { id: 'mp2', insumo: 'Almidón', proveedor: 'Codipsa', fechaLote: '2026-06-12', vencimiento: '2027-06-12', cantidadKg: 200, bloqueado: false },
  { id: 'mp3', insumo: 'Queso', proveedor: 'Tatiana', fechaLote: '2026-09-25', vencimiento: '2026-10-08', cantidadKg: 5, bloqueado: false },
]
