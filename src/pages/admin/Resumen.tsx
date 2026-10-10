// Pantalla de inicio del administrador: lo de hoy en todos los sectores (producción, envíos, temperaturas
// fuera de rango, máquinas con fallas y limpiezas por controlar) y accesos rápidos.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSectores } from '../../cliente/catalogo'
import { useConsulta } from '../../cliente/consultas'
import { Aviso, Cargando, ConDatos } from '../../components/Estado'
import { diaDeSemana, diaLegible, diaPY, fechaHoraPY } from '../../shared/hora'
import { NOMBRE_ESTADO, type Limpieza, type Reporte, type SectorId } from '../../shared/tipos'
import { IrAlEnlacePendiente } from './Reportes'
import '../../styles/reportes.css'

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const num = (n: number) => n.toLocaleString('es-PY')
const grados = (t: number | null) => (t === null ? '—' : `${String(t).replace('.', ',').replace('-', '−')} °C`)
const hora = (iso: string) => fechaHoraPY(iso).slice(11)

const ATAJOS: [string, string, string][] = [
  ['/admin/reportes', 'Reportes', 'Por fechas, Excel y resumen por correo'],
  ['/admin/registros', 'Producción', 'Registros y correcciones'],
  ['/admin/stock', 'Stock', 'Stock en frío, mermas y ajustes'],
  ['/admin/controles', 'Limpieza y temperatura', 'Visto bueno y lecturas'],
  ['/sector/lotes', 'Lotes', 'Materia prima y lotes de chipa'],
  ['/admin/datos', 'Datos', 'Excel completo, copias y configuración'],
]

export default function Resumen() {
  const hoy = diaPY()
  const reporte = useConsulta<Reporte>('/reportes', { desde: hoy, hasta: hoy })
  const pendientes = useConsulta<Limpieza[]>('/limpiezas', { sinControlar: true })
  const sectores = useSectores()

  return (
    <div className="rep-pagina">
      <IrAlEnlacePendiente />
      <h1>Resumen</h1>
      <p className="suave rep-rango">Hoy, {DIAS[diaDeSemana(hoy)].toLowerCase()} {diaLegible(hoy)} · todos los sectores · hora de Paraguay</p>
      <ConDatos consulta={reporte}>
        {(r) => (
          <>
            <div className="cifras">
              <Cifra n={r.totales.cargasProduccion} texto="cargas de producción" />
              <Cifra n={r.totales.unidadesCocinadas} texto="unidades cocinadas" />
              <Cifra n={r.totales.unidadesGuardadas} texto="unidades guardadas en frío" />
              <Cifra n={r.totales.unidadesEnviadas} texto="unidades enviadas" />
              <Cifra n={r.totales.temperaturasFueraDeRango} texto="temperaturas fuera de rango" alerta={r.totales.temperaturasFueraDeRango > 0} />
              <Cifra n={r.totales.limpiezas} texto={`limpiezas hoy (${num(r.totales.limpiezasSinControlar)} sin controlar)`} />
            </div>

            <h2>Para revisar</h2>
            <Alertas r={r} pendientes={pendientes} nombre={sectores.nombre} />

            <h2>Producción de hoy por sector</h2>
            <table className="tabla rep-tabla" aria-label="Producción de hoy por sector">
              <thead><tr><th>Sector</th><th className="num">Cocinado</th><th className="num">Guardado</th></tr></thead>
              <tbody>
                {(sectores.lista.length ? sectores.lista.map((s) => s.id) : ([...new Set(r.produccion.map((p) => p.sector))] as SectorId[])).map((s) => {
                  const filas = r.produccion.filter((p) => p.sector === s)
                  return (
                    <tr key={s}>
                      <td>{sectores.nombre(s)}{filas.length === 0 && <div className="rep-muted">Sin carga todavía</div>}</td>
                      <td className="num">{num(filas.reduce((a, f) => a + f.cocinado, 0))}</td>
                      <td className="num">{num(filas.reduce((a, f) => a + f.guardado, 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="chico"><Link to={`/admin/reportes?desde=${hoy}&hasta=${hoy}`}>Ver el reporte completo de hoy</Link></p>
          </>
        )}
      </ConDatos>

      <h2>Accesos rápidos</h2>
      <div className="grilla-botones">
        {ATAJOS.map(([a, t, d]) => (
          <Link key={a} to={a} className="boton-grande"><strong>{t}</strong><span>{d}</span></Link>
        ))}
      </div>
    </div>
  )
}

function Cifra({ n, texto, alerta = false }: { n: number; texto: string; alerta?: boolean }) {
  return <div className={alerta ? 'cifra alerta' : 'cifra'}><strong>{num(n)}</strong><span>{texto}</span></div>
}

function Alertas({ r, pendientes, nombre }: {
  r: Reporte
  pendientes: { datos: Limpieza[] | undefined; error: string | null }
  nombre: (s: SectorId) => string
}) {
  const items: ReactNode[] = []
  for (const l of r.temperaturasFueraDeRango) {
    items.push(
      <Link key={l.id} to="/admin/controles?ver=temperaturas" className="item alerta">
        <strong>{grados(l.temperatura)} en N° {l.maquinaNumero} · {l.maquinaNombre}</strong>
        <span className="chico">{nombre(l.sector)} · {hora(l.fecha)} · {l.usuarioNombre}{l.observacion ? ` · ${l.observacion}` : ''}</span>
      </Link>,
    )
  }
  for (const l of r.maquinasConFallas) {
    items.push(
      <Link key={l.id} to="/admin/controles?ver=temperaturas" className="item alerta">
        <strong>{NOMBRE_ESTADO[l.estado]}: N° {l.maquinaNumero} · {l.maquinaNombre}</strong>
        <span className="chico">{nombre(l.sector)} · {hora(l.fecha)}{l.observacion ? ` · ${l.observacion}` : ''}</span>
      </Link>,
    )
  }
  const sinHacer = r.limpiezas.reduce((a, l) => a + l.tareasNoHechas, 0)
  if (sinHacer > 0) {
    items.push(
      <Link key="sin-hacer" to="/admin/controles" className="item">
        <strong>{sinHacer === 1 ? '1 tarea de limpieza no se hizo hoy' : `${num(sinHacer)} tareas de limpieza no se hicieron hoy`}</strong>
        <span className="chico">{r.limpiezas.filter((l) => l.tareasNoHechas > 0).map((l) => `${l.areaNombre} (${nombre(l.sector)})`).join(' · ')}</span>
      </Link>,
    )
  }
  const lista = pendientes.datos
  if (lista && lista.length > 0) {
    const masVieja = lista.reduce((a, l) => (l.dia < a ? l.dia : a), lista[0].dia)
    items.push(
      <Link key="pendientes" to="/admin/controles" className="item">
        <strong>{lista.length === 1 ? '1 limpieza espera el visto bueno' : `${num(lista.length)} limpiezas esperan el visto bueno`}</strong>
        <span className="chico">{masVieja < diaPY() ? `La más vieja es del ${diaLegible(masVieja)}.` : 'Todas de hoy.'} Tocá para controlarlas.</span>
      </Link>,
    )
  }
  return (
    <div className="rep-alertas">
      {items}
      {pendientes.error && <Aviso>{pendientes.error}</Aviso>}
      {!pendientes.error && lista === undefined && <Cargando texto="Buscando limpiezas sin controlar…" />}
      {items.length === 0 && lista !== undefined && (
        <p className="ok" role="status">Todo en orden: sin temperaturas fuera de rango, máquinas con fallas ni limpiezas por controlar.</p>
      )}
    </div>
  )
}
