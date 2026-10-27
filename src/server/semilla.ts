// Datos iniciales. El catálogo sale de las planillas en papel de Chipa Tía (productos de Cocina,
// variedades de chipa, áreas y tareas de limpieza, equipos fríos y sus rangos).
// Los productos de Chipitas, Panadería y algunos de Cocina se ajustan después del relevamiento; el administrador los edita sin programar.
// Este archivo no importa valores de otros módulos para poder ejecutarse con Node directamente:
// scripts/generar-catalogo.ts arma con él la migración 0002 (`npm run catalogo`).
import type { SectorId, TipoMaquina } from '../shared/tipos'

export type Sentencia = [sql: string, params: (string | number | null)[]]

const SECTORES: [SectorId, string, number][] = [
  ['chiperia', 'Chipería', 1],
  ['chipitas', 'Chipitas', 0],
  ['panaderia', 'Panadería', 0],
  ['cocina', 'Cocina y buffet', 0],
]

const PRODUCTOS: Record<SectorId, string[]> = {
  chiperia: [
    'Chipa tradicional', "Chipa so'o", 'Chipa quesú', 'Chipa cheddar', 'Chipa pollo', 'Chipa JyQ',
    'Chipa dulce', 'Chipa pepperoni', 'Argolla chica', 'Argolla grande', 'Chipa mestizo',
  ],
  cocina: [
    'Asadito (brochet de pollo)', 'Cocido con leche', 'Cocido negro', 'Croquete de carne', 'Croquete de huevo',
    'Croquete de salchicha', 'Empanada al horno (carne)', 'Empanada al horno (pollo)', 'Empanada al horno (JyQ)',
    'Empanada frita (carne)', 'Empanada frita (pollo)', 'Empanada frita (JyQ)', 'Empanada frita (choclo)',
    'Marinera de carne', 'Marinera de pollo', 'Mbeju', 'Pollo muslo (frito)', 'Sándwich de verdura',
    'Sándwich de JyQ', 'Sándwich de milanesa', 'Sándwich de pollo', 'Sopa', 'Fugaza', 'Hamburguesa',
    'Menú buffet: plato del día', 'Menú buffet: guarnición',
  ],
  chipitas: ['Chipitas 100 g', 'Chipitas 250 g', 'Chipitas 500 g'],
  panaderia: ['Pan felipe', 'Pan de leche', 'Galleta'],
}

const MAQUINAS: [SectorId, number, string, TipoMaquina, number | null, number | null][] = [
  ['cocina', 1, 'Heladera inox', 'heladera', 1, 5],
  ['cocina', 2, 'Freezer 1', 'congelador', null, -18],
  ['cocina', 3, 'Freezer 2', 'congelador', null, -18],
  ['cocina', 4, 'Abatidor', 'congelador', null, -18],
  ['cocina', 5, 'Horno', 'otra', null, null],
  ['cocina', 6, 'Buffet: exhibidora fría', 'exhibidora_fria', 1, 10],
  ['cocina', 7, 'Buffet: bufetera caliente', 'exhibidora_caliente', 63, null],
  ['chiperia', 1, 'Freezer horizontal', 'congelador', null, -18],
  ['chiperia', 2, 'Abatidor', 'congelador', null, -18],
  ['chiperia', 3, 'Hornos', 'otra', null, null],
  ['chiperia', 4, 'Amasadora', 'otra', null, null],
  ['chipitas', 1, 'Máquina de chipitas', 'otra', null, null],
  ['chipitas', 2, 'Horno', 'otra', null, null],
  ['panaderia', 1, 'Horno', 'otra', null, null],
  ['panaderia', 2, 'Fermentadora', 'otra', null, null],
]

// [id, nombre, código de planilla, sectores, tareas (* = pide N° de equipo)]
const AREAS: [string, string, string, SectorId[], string[]][] = [
  ['chiperia', 'Chipería', 'RE-09.04', ['chiperia'], [
    'Pared', 'Techo', 'Ventanas', 'Extractor', 'Puerta', 'Batidora', 'Hornos', 'Carro de enfriamiento', 'Abatidor',
    'Freezer horizontal', 'Amasadora', 'Utensilios de trabajo', 'Pileta de lavado', 'Mesada de trabajo', 'Piso', 'Basureros',
  ]],
  ['chipitas', 'Chipitas: producción', 'RE-09.05', ['chipitas'], [
    'Techo', 'Pared', 'Puerta', 'Horno', 'Amasadora', 'Refinadora', 'Máquina de chipitas', 'Utensilios de trabajo',
    'Bandejas', 'Carro de enfriamiento', 'Mesada de trabajo', 'Piso', 'Basureros',
  ]],
  ['chipitas-depositos', 'Chipitas: depósitos', 'RE-09.05', ['chipitas'], [
    'Depósito MP: techo', 'Depósito MP: pared', 'Depósito MP: piso', 'Depósito MP: pallets',
    'Producto terminado: techo', 'Producto terminado: pared', 'Producto terminado: piso', 'Producto terminado: pallets',
  ]],
  ['panaderia', 'Panadería', 'RE-09.06', ['panaderia'], [
    'Techo', 'Pared', 'Piso', 'Puerta', 'Mesada de trabajo', 'Utensilios de trabajo', 'Horno', 'Amasadora', 'Refinadora',
    'Fermentadora', 'Estantes', 'Contenedores de materia prima', 'Basurero',
  ]],
  ['cocina', 'Cocina', 'RE-09.03', ['cocina'], [
    'Techo', 'Pared', 'Azulejos', 'Mampara y ventanales', 'Ventiladores', 'Extractores', 'Puerta', 'Piso',
    'Campana de extracción', 'Cocina industrial 6 hornallas', 'Cocina industrial 4 hornallas', 'Molino', 'Sierra de carne',
    'Cortador de verduras', 'Heladera inox', '*Freezer', '*Horno', '*Freidoras', 'Mesadas de trabajo', 'Utensilios de trabajo',
    'Estante de utensilios', 'Estante de materia prima', 'Pileta de lavado con mesada', 'Recipientes y contenedores',
    'Abatidor', 'Máquina de agua caliente', 'Basureros',
  ]],
  ['buffet', 'Buffet', 'RE-09.07', ['cocina'], [
    'Pared', 'Techo', 'Ventanas', 'Bufeteras', 'Balanza', 'Mesas', 'Cubierto del servicio', 'Piso', 'Basurero',
  ]],
  ['lavadero', 'Lavadero de utensilios', 'RE-09.08', ['cocina'], [
    'Piso', 'Pared', 'Techo', 'Puerta', '*Pileta de lavado', 'Estantes', 'Porta utensilios para escurrir', 'Utensilios varios',
    'Basurero con tapa', 'Pasillo logístico',
  ]],
  ['sanitario', 'Sanitario', 'RE-09.09', ['cocina', 'chiperia', 'chipitas', 'panaderia'], [
    'Piso', 'Pared', 'Techo', 'Lavamanos', 'Inodoro', 'Ventana', 'Puerta', 'Basurero',
  ]],
  ['deposito-mp', 'Depósito de materia prima', 'RE-09.02', ['chiperia'], [
    'Techo', 'Puerta', 'Pared', 'Pallets', 'Estantes', 'Piso',
  ]],
  ['camaras', 'Antecámara y cámaras', 'RE-09.01', ['cocina'], [
    'Antecámara: techo', 'Antecámara: cortina PVC', 'Antecámara: pared', 'Antecámara: estantes', 'Antecámara: recipientes',
    'Antecámara: pallets', 'Antecámara: piso', 'Cámara cárnicos: techo', 'Cámara cárnicos: puerta', 'Cámara cárnicos: pared',
    'Cámara cárnicos: evaporador', 'Cámara cárnicos: estantes', 'Cámara cárnicos: ganchos', 'Cámara cárnicos: pallets',
    'Cámara cárnicos: piso', 'Cámara en proceso: techo', 'Cámara en proceso: puerta', 'Cámara en proceso: pared',
    'Cámara en proceso: evaporador', 'Cámara en proceso: estantes', 'Cámara en proceso: pallets', 'Cámara en proceso: piso',
  ]],
]

const dos = (n: number) => String(n).padStart(2, '0')
export const idProducto = (sector: SectorId, i: number) => `prod-${sector}-${dos(i + 1)}`
export const idMaquina = (sector: SectorId, numero: number) => `maq-${sector}-${numero}`
export const idTarea = (area: string, i: number) => `tarea-${area}-${dos(i + 1)}`

/** Sectores, productos, máquinas, áreas y tareas de limpieza. */
export function catalogoInicial(): Sentencia[] {
  const s: Sentencia[] = []
  SECTORES.forEach(([id, nombre, conLotes], i) =>
    s.push(['INSERT INTO sectores (id, nombre, con_lotes, orden) VALUES (?, ?, ?, ?)', [id, nombre, conLotes, i]]))
  for (const [sector, nombres] of Object.entries(PRODUCTOS) as [SectorId, string[]][]) {
    nombres.forEach((nombre, i) =>
      s.push(['INSERT INTO productos (id, sector, nombre, unidad, activo, orden) VALUES (?, ?, ?, ?, 1, ?)',
        [idProducto(sector, i), sector, nombre, 'unidades', i]]))
  }
  for (const [sector, numero, nombre, tipo, min, max] of MAQUINAS) {
    s.push(['INSERT INTO maquinas (id, sector, numero, nombre, tipo, temp_min, temp_max, activo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [idMaquina(sector, numero), sector, numero, nombre, tipo, min, max]])
  }
  AREAS.forEach(([id, nombre, codigo, sectores, tareas], orden) => {
    s.push(['INSERT INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES (?, ?, ?, 1, ?)', [id, nombre, codigo, orden]])
    for (const sector of sectores) s.push(['INSERT INTO areas_sectores (area_id, sector) VALUES (?, ?)', [id, sector]])
    tareas.forEach((t, i) => {
      const pide = t.startsWith('*')
      s.push(['INSERT INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES (?, ?, ?, ?, 1, ?)',
        [idTarea(id, i), id, pide ? t.slice(1) : t, pide ? 1 : 0, i]])
    })
  })
  return s
}

/** Escapa una sentencia con sus parámetros como SQL literal (para generar la migración). */
export function aSqlLiteral([sql, params]: Sentencia): string {
  let i = 0
  return sql.replace(/\?/g, () => {
    const v = params[i++]
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') return String(v)
    return `'${v.replace(/'/g, "''")}'`
  }) + ';'
}
