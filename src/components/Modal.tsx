// Ventana modal con <dialog> del navegador: tapa la pantalla, atrapa el foco del teclado y se cierra con Escape,
// con la X o tocando fuera. Al cerrarse devuelve el foco al botón que la abrió (lo hace el navegador).
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icono } from './Iconos'
import '../styles/modal.css'

export default function Modal({ titulo, alCerrar, children, ancho = 'normal' }: {
  titulo: string
  alCerrar: () => void
  children: ReactNode
  ancho?: 'normal' | 'grande'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const cerrar = useRef(alCerrar)
  cerrar.current = alCerrar

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => d?.close?.()
  }, [])

  return (
    <dialog
      ref={ref} className={`modal modal-${ancho} no-imprimir`} aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); cerrar.current() }}
      // Tocar el fondo oscuro (fuera de la caja) cierra; el clic dentro de la caja tiene otro target.
      onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar.current() }}
    >
      <div className="modal-caja">
        <header className="modal-cabeza">
          <h2 id={id}>{titulo}</h2>
          <button type="button" className="modal-cerrar" aria-label="Cerrar" title="Cerrar" onClick={() => cerrar.current()}>
            <Icono nombre="cancelar" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
