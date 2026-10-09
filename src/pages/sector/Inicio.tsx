import { Link } from 'react-router-dom'
import { SECTORES } from '../../mock/data'
import { diaPY, useDatos } from '../../mock/store'
import { useSector } from '../../components/Layout'

export default function Inicio() {
  const { datos } = useDatos()
  const sector = useSector()
  const info = SECTORES.find((s) => s.id === sector)!
  const hoy = diaPY(new Date().toISOString())
  const cargasHoy = datos.producciones.filter((p) => p.sector === sector && diaPY(p.fecha) === hoy).length
  const limpiezasHoy = datos.limpiezas.filter((l) => l.sector === sector && diaPY(l.fecha) === hoy).length
  const lecturasHoy = datos.lecturas.filter((l) => {
    const m = datos.maquinas.find((x) => x.id === l.maquinaId)
    return m?.sector === sector && diaPY(l.fecha) === hoy
  }).length

  const botones = [
    { a: '/sector/produccion', t: 'Registrar producción', d: `${cargasHoy} cargas hoy` },
    { a: '/sector/stock', t: 'Stock en frío', d: 'Lo guardado por producto' },
    { a: '/sector/salida', t: 'Sacar para la venta', d: 'Descuenta del stock' },
    { a: '/sector/envio', t: 'Envío a sucursal', d: 'Productos, cantidades y lote' },
    { a: '/sector/maquinas', t: 'Máquinas y temperatura', d: `${lecturasHoy} lecturas hoy` },
    { a: '/sector/limpieza', t: 'Limpieza', d: `${limpiezasHoy} reportes hoy` },
    ...(info.conLotes
      ? [
          { a: '/sector/lotes', t: 'Materia prima y lotes', d: 'Queso, almidón y lotes de chipa' },
          { a: '/trazabilidad', t: 'Trazabilidad', d: 'De la materia prima a la sucursal' },
        ]
      : []),
    { a: '/sector/historial', t: 'Historial de salidas', d: 'Filtrar por fecha y sucursal' },
  ]

  return (
    <>
      <h1>{info.nombre}</h1>
      <div className="grilla-botones">
        {botones.map((b) => (
          <Link key={b.a} to={b.a} className="boton-grande">
            <strong>{b.t}</strong>
            <span>{b.d}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
