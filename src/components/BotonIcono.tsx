// Botón de una acción mostrado solo con su ícono (editar, desactivar, anular, imprimir…). Reemplaza a los botones
// con forma de link. El texto de la acción queda como cartel al pasar el mouse (title) y para lectores de pantalla.
import type { ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Icono, type NombreIcono } from './Iconos'

type Tono = 'normal' | 'peligro' | 'positivo'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  icono: NombreIcono
  /** Qué hace el botón: es el cartel al pasar el mouse y lo que lee el lector de pantalla. */
  texto: string
  tono?: Tono
  /** Para los que abren y cierran algo (por ejemplo, la cuenta de un proveedor): se ve presionado. */
  presionado?: boolean
}

const clases = (tono: Tono, presionado?: boolean, extra?: string) =>
  ['btn-icono-accion', tono !== 'normal' && tono, presionado && 'presionado', extra].filter(Boolean).join(' ')

export default function BotonIcono({ icono, texto, tono = 'normal', presionado, className, type = 'button', ...resto }: Props) {
  return (
    <button
      type={type} className={clases(tono, presionado, className)} title={texto} aria-label={texto}
      aria-pressed={presionado} {...resto}
    >
      <Icono nombre={icono} />
    </button>
  )
}

/** Igual que BotonIcono pero navega a otra página. */
export function LinkIcono({ icono, texto, tono = 'normal', className, ...resto }: Omit<LinkProps, 'children' | 'title'> & { icono: NombreIcono; texto: string; tono?: Tono }) {
  return (
    <Link className={clases(tono, false, className)} title={texto} aria-label={texto} {...resto}>
      <Icono nombre={icono} />
    </Link>
  )
}

/** Fila de botones con ícono, alineados y con un poco de aire entre ellos. */
export function Acciones({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`acciones-icono${className ? ` ${className}` : ''}`}>{children}</div>
}
