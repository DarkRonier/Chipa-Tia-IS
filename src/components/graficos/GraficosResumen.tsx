// Secciones «Historial» y «Comparación» de la pantalla Resumen del administrador. Una sola consulta
// (GET /reportes/serie) con los últimos 90 días alcanza para los dos gráficos y todos sus selectores.
import { useState } from 'react'
import { useSectores } from '../../cliente/catalogo'
import { useConsulta } from '../../cliente/consultas'
import { diaPY, sumarDias } from '../../shared/hora'
import type { MedidaSerie, SerieReporte } from '../../shared/tipos'
import { ConDatos } from '../Estado'
import Comparacion, { MEDIDAS } from './Comparacion'
import { Selector } from './comunes'
import type { Comparacion as TipoComparacion } from './datos'
import Historial from './Historial'
import '../../styles/graficos.css'

const DIAS_ATRAS = 90
type Dias = 14 | 30 | 90

export default function GraficosResumen() {
  const hoy = diaPY()
  const serie = useConsulta<SerieReporte>('/reportes/serie', { desde: sumarDias(hoy, -(DIAS_ATRAS - 1)), hasta: hoy })
  const sectores = useSectores()
  const [dias, setDias] = useState<Dias>(14)
  const [tipo, setTipo] = useState<TipoComparacion>('semana')
  const [medida, setMedida] = useState<MedidaSerie>('cocinado')

  return (
    <>
      <section className="graf-seccion" aria-labelledby="graf-historial">
        <h2 id="graf-historial">Historial</h2>
        <p className="suave chico graf-sub">Unidades cocinadas por día en cada sector · hora de Paraguay</p>
        <div className="graf-filtros">
          <Selector<Dias>
            etiqueta="Días del historial" valor={dias} onCambio={setDias}
            opciones={[[14, '14 días'], [30, '30 días'], [90, '90 días']]}
          />
        </div>
        <ConDatos consulta={serie}>
          {(s) => <Historial serie={s} dias={dias} nombre={sectores.nombre} />}
        </ConDatos>
      </section>

      <section className="graf-seccion" aria-labelledby="graf-comparacion">
        <h2 id="graf-comparacion">Comparación</h2>
        <p className="suave chico graf-sub">Cada sector contra el mismo tramo del período anterior</p>
        <div className="graf-filtros">
          <Selector<TipoComparacion>
            etiqueta="Período a comparar" valor={tipo} onCambio={setTipo}
            opciones={[['semana', 'Semana'], ['mes', 'Mes']]}
          />
          <Selector<MedidaSerie> etiqueta="Medida" valor={medida} onCambio={setMedida} opciones={MEDIDAS} />
        </div>
        <ConDatos consulta={serie}>
          {(s) => <Comparacion serie={s} hoy={hoy} tipo={tipo} medida={medida} nombre={sectores.nombre} />}
        </ConDatos>
      </section>
    </>
  )
}
