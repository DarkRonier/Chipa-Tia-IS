// Piezas para imprimir o guardar como PDF (H06, H09): el botón y el encabezado que solo se ve en el papel.
import type { ReactNode } from 'react'
import { imprimir } from '../cliente/imprimir'
import { fechaHoraPY } from '../shared/hora'

/** Botón «Descargar PDF»: abre el diálogo de impresión con `archivo` como nombre sugerido. */
export function BotonPDF({ archivo, className = 'btn-secundario' }: { archivo: string; className?: string }) {
  return (
    <button type="button" className={`${className} no-imprimir`} onClick={() => imprimir(archivo)}>
      Descargar PDF
    </button>
  )
}

/** Encabezado que solo aparece al imprimir: empresa, título, detalle (período, sector…) y fecha de generación. */
export function EncabezadoImpresion({ titulo, detalle, generado }: {
  titulo: string; detalle?: ReactNode; generado?: string
}) {
  return (
    <header className="solo-impresion encabezado-impresion">
      <img src="./logo.png" alt="" width="50" height="40" />
      <div>
        <p className="ei-empresa">Chipa Tía</p>
        <h1 className="ei-titulo">{titulo}</h1>
        {detalle && <p className="ei-detalle">{detalle}</p>}
        <p className="ei-generado">Generado el {fechaHoraPY(generado ?? new Date().toISOString())} (hora de Paraguay)</p>
      </div>
    </header>
  )
}
