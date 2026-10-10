// Íconos de las acciones de la app: SVG en línea, de trazo (sin relleno), que toman el color del texto
// (currentColor) y miden 1em salvo que se pase otro tamaño. Todos comparten la grilla de 24 × 24.
import type { ReactNode } from 'react'

const ENGRANAJE =
  'M10.8 4.8L10.88 2.57L13.12 2.57L13.2 4.8L16.24 6.06L17.88 4.54L19.46 6.12L17.94 7.76L19.2 10.8L21.43 10.88L21.43 13.12L19.2 13.2L17.94 16.24L19.46 17.88L17.88 19.46L16.24 17.94L13.2 19.2L13.12 21.43L10.88 21.43L10.8 19.2L7.76 17.94L6.12 19.46L4.54 17.88L6.06 16.24L4.8 13.2L2.57 13.12L2.57 10.88L4.8 10.8L6.06 7.76L4.54 6.12L6.12 4.54L7.76 6.06z'

const DIBUJOS = {
  // Bandeja con tres chipas y vapor.
  produccion: (
    <>
      <circle cx="6.5" cy="13" r="2.7" />
      <circle cx="12" cy="13" r="2.7" />
      <circle cx="17.5" cy="13" r="2.7" />
      <path d="M2.5 17.5h19l-1.6 3.5H4.1z" />
      <path d="M9 3.5c-1 1-1 2 0 3M12 2.5c-1 1.2-1 2.6 0 3.8M15 3.5c-1 1-1 2 0 3" />
    </>
  ),
  // Copo de nieve: stock guardado en frío.
  stock: (
    <>
      <path d="M12 12L12 2.5M12 12L20.2 7.3M12 12L20.2 16.8M12 12L12 21.5M12 12L3.8 16.8M12 12L3.8 7.2" />
      <path d="M10.2 4.1L12 5.7L13.8 4.1M18 6.5L17.5 8.8L19.8 9.6M19.8 14.4L17.5 15.1L18 17.5M13.8 19.9L12 18.3L10.2 19.9M6 17.5L6.5 15.2L4.2 14.4M4.2 9.6L6.5 8.8L6 6.5" />
    </>
  ),
  // Bolsa con flecha hacia arriba: sale para la venta.
  venta: (
    <>
      <path d="M4.5 8h15l-1.2 12.2a1 1 0 0 1-1 .8H6.7a1 1 0 0 1-1-.8z" />
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
      <path d="M12 17.2v-6M9.2 13.8l2.8-2.8 2.8 2.8" />
    </>
  ),
  // Camioncito de reparto.
  envio: (
    <>
      <path d="M2.5 6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V16h-12z" />
      <path d="M14.5 9h3.7l3.3 3.6V16h-7z" />
      <circle cx="7" cy="17.8" r="2.1" />
      <circle cx="17.5" cy="17.8" r="2.1" />
    </>
  ),
  // Reloj con flecha que vuelve atrás.
  historial: (
    <>
      <path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2" />
      <path d="M3.4 3.8v4.6h4.6" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // Termómetro.
  maquinas: (
    <>
      <path d="M14.2 14.4V5.2a2.2 2.2 0 0 0-4.4 0v9.2a4.2 4.2 0 1 0 4.4 0z" />
      <path d="M12 9.5v7" />
      <circle cx="12" cy="17.2" r="1.1" />
      <path d="M17.5 5.5h2.5M17.5 9h2.5M17.5 12.5h2.5" />
    </>
  ),
  // Balde con brillos.
  limpieza: (
    <>
      <path d="M4.5 10h13l-1.4 10.2a1 1 0 0 1-1 .8H6.9a1 1 0 0 1-1-.8z" />
      <path d="M7.5 10a4 4 0 0 1 7 -2.6" />
      <path d="M18.5 2.5v4M16.5 4.5h4" />
      <path d="M20.7 9.5v2.2M19.6 10.6h2.2" />
    </>
  ),
  // Etiqueta con ojal y código.
  lotes: (
    <>
      <path d="M3 4.2v7.2c0 .3.1.6.3.8l8.4 8.4a1.1 1.1 0 0 0 1.5 0l7-7a1.1 1.1 0 0 0 0-1.5L11.8 3.7a1.1 1.1 0 0 0-.8-.3H3.8a.8.8 0 0 0-.8.8z" />
      <circle cx="7.6" cy="8" r="1.4" />
      <path d="M11.2 12.6l2.8 2.8M13.2 10.6l2.8 2.8" />
    </>
  ),
  // Camino con dos nodos.
  trazabilidad: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M7 5h7a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h7" />
    </>
  ),
  // Tablero con cuatro paneles.
  resumen: (
    <>
      <rect x="3" y="3" width="8" height="10" rx="1.6" />
      <rect x="13" y="3" width="8" height="5.5" rx="1.6" />
      <rect x="13" y="11" width="8" height="10" rx="1.6" />
      <rect x="3" y="15.5" width="8" height="5.5" rx="1.6" />
    </>
  ),
  // Gráfico de barras.
  reportes: (
    <>
      <path d="M3.5 3.5v17h17" />
      <rect x="7" y="12" width="3" height="5.5" rx=".7" />
      <rect x="12" y="7" width="3" height="10.5" rx=".7" />
      <rect x="17" y="10" width="3" height="7.5" rx=".7" />
    </>
  ),
  // Dos personas.
  usuarios: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20.5v-1a6.5 6.5 0 0 1 13 0v1" />
      <path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.2a6.5 6.5 0 0 1 3 5.3v1" />
    </>
  ),
  // Lista con viñetas.
  catalogos: (
    <>
      <path d="M9.5 6h11M9.5 12h11M9.5 18h11" />
      <circle cx="4.5" cy="6" r="1.2" />
      <circle cx="4.5" cy="12" r="1.2" />
      <circle cx="4.5" cy="18" r="1.2" />
    </>
  ),
  // Balanza: ajustar lo que hay en stock.
  ajustes: (
    <>
      <path d="M12 3.5v16.5M7 21h10" />
      <path d="M4.5 6.5h15" />
      <path d="M4.5 6.5L2 13.2a3.1 3.1 0 0 0 5 0z" />
      <path d="M19.5 6.5L17 13.2a3.1 3.1 0 0 0 5 0z" />
    </>
  ),
  // Lápiz: registros y correcciones.
  registros: (
    <>
      <path d="M4 20l1-4.5L16.8 3.7a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19z" />
      <path d="M14.5 6l3.5 3.5M4 20l4.5-1" />
    </>
  ),
  // Portapapeles con tilde: controles.
  controles: (
    <>
      <rect x="4.5" y="4.5" width="15" height="17" rx="2" />
      <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5z" />
      <path d="M8.5 13.5l2.5 2.5 4.5-5" />
    </>
  ),
  // Cilindro de base de datos.
  datos: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  // Engranaje.
  configuracion: (
    <>
      <path d={ENGRANAJE} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type NombreIcono = keyof typeof DIBUJOS

type Props = {
  nombre: NombreIcono
  /** Tamaño en px o en cualquier unidad CSS; sin él, 1em (hereda el tamaño del texto). */
  tamano?: number | string
  className?: string
}

export function Icono({ nombre, tamano = '1em', className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {DIBUJOS[nombre]}
    </svg>
  )
}

type Corto = Omit<Props, 'nombre'>
export const IconoProduccion = (p: Corto) => <Icono nombre="produccion" {...p} />
export const IconoStock = (p: Corto) => <Icono nombre="stock" {...p} />
export const IconoVenta = (p: Corto) => <Icono nombre="venta" {...p} />
export const IconoEnvio = (p: Corto) => <Icono nombre="envio" {...p} />
export const IconoHistorial = (p: Corto) => <Icono nombre="historial" {...p} />
export const IconoMaquinas = (p: Corto) => <Icono nombre="maquinas" {...p} />
export const IconoLimpieza = (p: Corto) => <Icono nombre="limpieza" {...p} />
export const IconoLotes = (p: Corto) => <Icono nombre="lotes" {...p} />
export const IconoTrazabilidad = (p: Corto) => <Icono nombre="trazabilidad" {...p} />
export const IconoResumen = (p: Corto) => <Icono nombre="resumen" {...p} />
export const IconoReportes = (p: Corto) => <Icono nombre="reportes" {...p} />
export const IconoUsuarios = (p: Corto) => <Icono nombre="usuarios" {...p} />
export const IconoCatalogos = (p: Corto) => <Icono nombre="catalogos" {...p} />
export const IconoAjustes = (p: Corto) => <Icono nombre="ajustes" {...p} />
export const IconoRegistros = (p: Corto) => <Icono nombre="registros" {...p} />
export const IconoControles = (p: Corto) => <Icono nombre="controles" {...p} />
export const IconoDatos = (p: Corto) => <Icono nombre="datos" {...p} />
export const IconoConfiguracion = (p: Corto) => <Icono nombre="configuracion" {...p} />
