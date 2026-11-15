// Inicio del cajero. Abrir y cerrar caja, registrar ventas y generar facturas llegan en la etapa 3 (M11–M13);
// mientras tanto el cajero ya puede entrar con su usuario y ve qué va a poder hacer acá.
import { useUsuario } from '../../cliente/sesion'

const PROXIMAMENTE = [
  ['Abrir y cerrar caja', 'Con el monto inicial y el arqueo al cerrar.'],
  ['Registrar ventas', 'Con el detalle de lo que se vende.'],
  ['Generar facturas', 'Sobre la factura preimpresa.'],
]

export default function InicioCaja() {
  const usuario = useUsuario()
  return (
    <>
      <h1>Caja</h1>
      <p>Hola, {usuario.nombre}.</p>
      <div className="tarjeta">
        <p className="suave">Estas funciones se están preparando y van a aparecer acá:</p>
        <ul>
          {PROXIMAMENTE.map(([t, d]) => <li key={t}><strong>{t}</strong>: {d}</li>)}
        </ul>
      </div>
    </>
  )
}
