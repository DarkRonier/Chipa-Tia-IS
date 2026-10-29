// Inicio del sector: botones grandes a cada tarea, con lo cargado hoy.
import { Link } from 'react-router-dom'
import { useConsulta } from '../../cliente/consultas'
import Avisos from '../../components/Avisos'
import { Icono, type NombreIcono } from '../../components/Iconos'
import { useSectorActivo } from '../../components/Layout'
import { diaPY } from '../../shared/hora'
import type { Lectura, Limpieza, Produccion } from '../../shared/tipos'
import '../../styles/iconos.css'

/** "1 carga hoy", "3 cargas hoy"; mientras carga o si la consulta falla, nada. */
function cuenta(datos: unknown[] | undefined, singular: string, plural: string) {
  if (!datos) return undefined
  return `${datos.length} ${datos.length === 1 ? singular : plural} hoy`
}

type Boton = { a: string; i: NombreIcono; t: string; d?: string }

export default function Inicio() {
  const sector = useSectorActivo()
  const hoy = diaPY()
  const filtro = { sector: sector.id, desde: hoy, hasta: hoy }
  const cargas = useConsulta<Produccion[]>('/producciones', filtro)
  const lecturas = useConsulta<Lectura[]>('/lecturas', filtro)
  const limpiezas = useConsulta<Limpieza[]>('/limpiezas', filtro)

  const botones: Boton[] = [
    { a: '/sector/produccion', i: 'produccion', t: 'Registrar producción', d: cuenta(cargas.datos, 'carga', 'cargas') },
    { a: '/sector/stock', i: 'stock', t: 'Stock en frío' },
    { a: '/sector/salida', i: 'venta', t: 'Sacar para la venta' },
    { a: '/sector/envio', i: 'envio', t: 'Envío a sucursal' },
    { a: '/sector/maquinas', i: 'maquinas', t: 'Máquinas y temperatura', d: cuenta(lecturas.datos, 'lectura', 'lecturas') },
    { a: '/sector/limpieza', i: 'limpieza', t: 'Limpieza', d: cuenta(limpiezas.datos, 'reporte', 'reportes') },
    ...(sector.conLotes
      ? ([
          { a: '/sector/lotes', i: 'lotes', t: 'Materia prima y lotes' },
          { a: '/trazabilidad', i: 'trazabilidad', t: 'Trazabilidad' },
        ] as Boton[])
      : []),
    { a: '/sector/historial', i: 'historial', t: 'Historial de salidas' },
  ]

  return (
    <>
      <h1>{sector.nombre || ' '}</h1>
      <Avisos sector={sector.id} />
      <div className="grilla-botones con-iconos">
        {botones.map((b) => (
          <Link key={b.a} to={b.a} className="boton-grande con-icono">
            <div className="icono-caja"><Icono nombre={b.i} /></div>
            <strong>{b.t}</strong>
            {b.d && <span>{b.d}</span>}
          </Link>
        ))}
      </div>
    </>
  )
}
