// Estado en memoria del prototipo, guardado en el navegador. En la versión real
// cada acción será una llamada a la API (Hono + D1) con la misma forma.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AREAS_LIMPIEZA, LOTES_MP, MAQUINAS, PRODUCTOS, SUCURSALES, USUARIOS,
  type AreaLimpieza, type LoteMP, type Maquina, type Producto, type SectorId, type Sucursal, type Usuario,
} from './data'

export type Turno = 'dia' | 'noche'
export type TipoMovimiento = 'produccion' | 'stock_inicial' | 'salida_venta' | 'envio' | 'merma' | 'vencimiento' | 'ajuste'
export type Marca = 'X' | 'XX' | '-'
export type EstadoMaquina = 'funciona' | 'con_fallas' | 'fuera_de_servicio'
export type Momento = 'inicio' | 'fin' | 'inicial' | 'intermedia' | 'otro'

export interface LoteChipa {
  codigo: string
  amasada: number
  lotesMP: string[]
  horno: number
  congelador: number
}

export interface Produccion {
  id: string
  sector: SectorId
  usuarioId: string
  fecha: string
  turno: Turno
  items: { productoId: string; cocinado: number; guardado: number }[]
  lote?: LoteChipa
  corregido?: { usuarioId: string; fecha: string }
}

export interface Movimiento {
  id: string
  sector: SectorId
  productoId: string
  lote?: string
  tipo: TipoMovimiento
  cantidad: number
  motivo?: string
  sucursalId?: string
  envioId?: string
  usuarioId: string
  fecha: string
}

export interface Lectura {
  id: string
  maquinaId: string
  usuarioId: string
  fecha: string
  momento: Momento
  estado: EstadoMaquina
  temperatura: number | null
  fueraDeRango: boolean
  observacion: string
  mantenimiento?: { descripcion: string; realizadoPor: string }
  foto?: string
}

export interface Limpieza {
  id: string
  areaId: string
  sector: SectorId
  usuarioId: string
  fecha: string
  marcas: Record<string, Marca>
  numeros: Record<string, string>
  comentario: string
  controladoPor?: { usuarioId: string; fecha: string }
}

export interface Auditoria {
  id: string
  tabla: string
  registroId: string
  usuarioId: string
  fecha: string
  antes: string
  despues: string
}

interface Datos {
  usuarios: Usuario[]
  productos: Producto[]
  maquinas: Maquina[]
  sucursales: Sucursal[]
  areas: AreaLimpieza[]
  lotesMP: LoteMP[]
  producciones: Produccion[]
  movimientos: Movimiento[]
  lecturas: Lectura[]
  limpiezas: Limpieza[]
  auditoria: Auditoria[]
}

const CLAVE = 'chipa-tia-prototipo-v1'
const CLAVE_SESION = 'chipa-tia-sesion'

let contador = 0
export const nuevoId = () => `${Date.now().toString(36)}${(contador++).toString(36)}`

const haceHoras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

function datosIniciales(): Datos {
  const producciones: Produccion[] = [
    {
      id: 'p1', sector: 'cocina', usuarioId: 'u4', fecha: haceHoras(26), turno: 'dia',
      items: [
        { productoId: 'cocina-10', cocinado: 47, guardado: 30 },
        { productoId: 'cocina-14', cocinado: 29, guardado: 15 },
        { productoId: 'cocina-1', cocinado: 17, guardado: 5 },
      ],
    },
    {
      id: 'p2', sector: 'chiperia', usuarioId: 'u1', fecha: haceHoras(25), turno: 'dia',
      items: [
        { productoId: 'chiperia-1', cocinado: 200, guardado: 300 },
        { productoId: 'chiperia-2', cocinado: 30, guardado: 0 },
      ],
      lote: { codigo: 'CH-261008-1', amasada: 1, lotesMP: ['mp1', 'mp2'], horno: 230, congelador: 300 },
    },
  ]
  const movimientos: Movimiento[] = [
    { id: 'mv1', sector: 'cocina', productoId: 'cocina-10', tipo: 'produccion', cantidad: 30, usuarioId: 'u4', fecha: haceHoras(26) },
    { id: 'mv2', sector: 'cocina', productoId: 'cocina-14', tipo: 'produccion', cantidad: 15, usuarioId: 'u4', fecha: haceHoras(26) },
    { id: 'mv3', sector: 'cocina', productoId: 'cocina-1', tipo: 'produccion', cantidad: 5, usuarioId: 'u4', fecha: haceHoras(26) },
    { id: 'mv4', sector: 'cocina', productoId: 'cocina-10', tipo: 'salida_venta', cantidad: -10, usuarioId: 'u4', fecha: haceHoras(20) },
    { id: 'mv5', sector: 'chiperia', productoId: 'chiperia-1', lote: 'CH-261008-1', tipo: 'produccion', cantidad: 300, usuarioId: 'u1', fecha: haceHoras(25) },
    { id: 'mv6', sector: 'chiperia', productoId: 'chiperia-1', lote: 'CH-261008-1', tipo: 'envio', cantidad: -100, sucursalId: 's1', envioId: 'e1', usuarioId: 'u1', fecha: haceHoras(22) },
  ]
  const lecturas: Lectura[] = [
    { id: 'l1', maquinaId: 'm1', usuarioId: 'u4', fecha: haceHoras(27), momento: 'inicio', estado: 'funciona', temperatura: 3, fueraDeRango: false, observacion: '' },
    { id: 'l2', maquinaId: 'm2', usuarioId: 'u4', fecha: haceHoras(27), momento: 'inicio', estado: 'con_fallas', temperatura: -12, fueraDeRango: true, observacion: 'La puerta no cierra bien' },
  ]
  const limpiezas: Limpieza[] = [
    {
      id: 'lp1', areaId: 'cocina', sector: 'cocina', usuarioId: 'u4', fecha: haceHoras(24),
      marcas: { 'coc-1': '-', 'coc-2': 'X', 'coc-8': 'XX', 'coc-17': 'X' }, numeros: { 'coc-17': '1' }, comentario: '',
    },
  ]
  return {
    usuarios: USUARIOS, productos: PRODUCTOS, maquinas: MAQUINAS, sucursales: SUCURSALES,
    areas: AREAS_LIMPIEZA, lotesMP: LOTES_MP, producciones, movimientos, lecturas, limpiezas, auditoria: [],
  }
}

function leer<T>(clave: string): T | null {
  try {
    const v = localStorage.getItem(clave)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

function escribir(clave: string, valor: unknown) {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // Sin almacenamiento el prototipo sigue andando, solo no recuerda los datos.
  }
}

type Actualizar = (fn: (d: Datos) => Datos) => void

interface Ctx {
  datos: Datos
  actualizar: Actualizar
  usuario: Usuario | null
  entrar: (usuario: string, clave: string) => string | null
  salir: () => void
  reiniciar: () => void
}

const Contexto = createContext<Ctx | null>(null)

export function ProveedorDatos({ children }: { children: ReactNode }) {
  const [datos, setDatos] = useState<Datos>(() => leer<Datos>(CLAVE) ?? datosIniciales())
  const [usuarioId, setUsuarioId] = useState<string | null>(() => leer<string>(CLAVE_SESION))

  useEffect(() => escribir(CLAVE, datos), [datos])
  useEffect(() => escribir(CLAVE_SESION, usuarioId), [usuarioId])

  const valor = useMemo<Ctx>(() => {
    const usuario = datos.usuarios.find((u) => u.id === usuarioId && u.activo) ?? null
    return {
      datos,
      actualizar: (fn) => setDatos((d) => fn(d)),
      usuario,
      entrar: (nombre, clave) => {
        const u = datos.usuarios.find((x) => x.usuario === nombre.trim().toLowerCase())
        // En el prototipo la contraseña de todos es "1234".
        if (!u || clave !== '1234') return 'Usuario o contraseña incorrectos'
        if (!u.activo) return 'Este usuario está desactivado'
        setUsuarioId(u.id)
        return null
      },
      salir: () => setUsuarioId(null),
      reiniciar: () => setDatos(datosIniciales()),
    }
  }, [datos, usuarioId])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useDatos() {
  const c = useContext(Contexto)
  if (!c) throw new Error('useDatos fuera de ProveedorDatos')
  return c
}

export function stockDe(movs: Movimiento[], sector: SectorId, productoId: string, lote?: string) {
  return movs
    .filter((m) => m.sector === sector && m.productoId === productoId && (lote === undefined || m.lote === lote))
    .reduce((s, m) => s + m.cantidad, 0)
}

export function stockPorLote(movs: Movimiento[], sector: SectorId, productoId: string) {
  const porLote = new Map<string, number>()
  for (const m of movs) {
    if (m.sector !== sector || m.productoId !== productoId || !m.lote) continue
    porLote.set(m.lote, (porLote.get(m.lote) ?? 0) + m.cantidad)
  }
  return [...porLote.entries()].filter(([, n]) => n > 0)
}

export function fueraDeRango(m: Maquina, t: number | null) {
  if (t === null) return false
  return (m.tempMin !== null && t < m.tempMin) || (m.tempMax !== null && t > m.tempMax)
}

export function textoRango(m: Maquina) {
  if (m.tempMin !== null && m.tempMax !== null) return `${m.tempMin} °C a ${m.tempMax} °C`
  if (m.tempMax !== null) return `≤ ${m.tempMax} °C`
  if (m.tempMin !== null) return `≥ ${m.tempMin} °C`
  return 'sin control de temperatura'
}

const formato = new Intl.DateTimeFormat('es-PY', {
  timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})
export const fechaHora = (iso: string) => formato.format(new Date(iso))

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' })
export const diaPY = (iso: string) => formatoDia.format(new Date(iso))
