// H01–H04: reporte del administrador para cualquier rango de fechas (todos los sectores o uno), exportación
// a Excel y envío de un resumen de prueba por correo. El enlace del correo abre esta pantalla con
// ?desde=…&hasta=… (si hace falta entrar primero, se recuerda el enlace hasta después del login).
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { esDemo, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { mensajeDe, useAccion, useConsulta } from '../../cliente/consultas'
import { celdaDia, celdaFechaHora, descargarExcel, negrita, type Celda, type Hoja } from '../../cliente/excel'
import { Aviso, ConDatos } from '../../components/Estado'
import {
  diaLegible, diaPY, esDiaValido, fechaHoraPY, inicioDeMes, inicioDeSemana, rangoResumen, sumarDias,
} from '../../shared/hora'
import {
  NOMBRE_ESTADO, NOMBRE_MOMENTO, NOMBRE_TIPO_MOVIMIENTO, SECTOR_IDS,
  type Configuracion, type Lectura, type PeriodoResumen, type Reporte, type ResumenCorreo, type SectorId,
} from '../../shared/tipos'
import '../../styles/reportes.css'

type Atajo = 'hoy' | 'ayer' | 'semana' | 'semanaPasada' | 'mes' | 'mesPasado'
const ATAJOS: [Atajo, string][] = [
  ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['semanaPasada', 'Semana pasada'], ['mes', 'Este mes'], ['mesPasado', 'Mes pasado'],
]

function rangoDe(a: Atajo, hoy: string): [string, string] {
  switch (a) {
    case 'hoy': return [hoy, hoy]
    case 'ayer': return [sumarDias(hoy, -1), sumarDias(hoy, -1)]
    case 'semana': return [inicioDeSemana(hoy), hoy]
    case 'semanaPasada': {
      const r = rangoResumen('semanal', hoy)
      return [r.desde, r.hasta]
    }
    case 'mes': return [inicioDeMes(hoy), hoy]
    case 'mesPasado': {
      const r = rangoResumen('mensual', hoy)
      return [r.desde, r.hasta]
    }
  }
}

const num = (n: number) => n.toLocaleString('es-PY')
const grados = (t: number | null) => (t === null ? '—' : `${String(t).replace('.', ',').replace('-', '−')} °C`)
const periodoLegible = (desde: string, hasta: string) =>
  desde === hasta ? `el ${diaLegible(desde)}` : `del ${diaLegible(desde)} al ${diaLegible(hasta)}`

export default function Reportes() {
  const hoy = diaPY()
  const [params, setParams] = useSearchParams()
  const sectores = useSectores()
  const pDesde = params.get('desde')
  const pHasta = params.get('hasta')
  const desde = esDiaValido(pDesde) ? pDesde : hoy
  const hasta = esDiaValido(pHasta) ? pHasta : esDiaValido(pDesde) ? pDesde : hoy
  const sector = (SECTOR_IDS as string[]).includes(params.get('sector') ?? '') ? (params.get('sector') as SectorId) : ''
  const rangoMal = desde > hasta
  const consulta = useConsulta<Reporte>(rangoMal ? null : '/reportes', { desde, hasta, sector })

  const fijar = (v: { desde?: string; hasta?: string; sector?: string }) => {
    const nuevo = { desde, hasta, sector, ...v }
    setParams(Object.fromEntries(Object.entries(nuevo).filter(([, x]) => x)), { replace: true })
  }
  const elegido = ATAJOS.find(([a]) => {
    const [d, h] = rangoDe(a, hoy)
    return d === desde && h === hasta
  })?.[0]

  return (
    <div className="rep-pagina">
      <h1>Reportes</h1>
      <div className="tarjeta">
        <div className="segmentado rep-periodos" role="group" aria-label="Período">
          {ATAJOS.map(([a, t]) => (
            <button
              key={a} type="button" className={elegido === a ? 'activo' : ''} aria-pressed={elegido === a}
              onClick={() => {
                const [d, h] = rangoDe(a, hoy)
                fijar({ desde: d, hasta: h })
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="rep-fechas">
          <label className="campo"><span>Desde</span>
            <input type="date" value={desde} max={hoy} onChange={(e) => e.target.value && fijar({ desde: e.target.value })} />
          </label>
          <label className="campo"><span>Hasta</span>
            <input type="date" value={hasta} onChange={(e) => e.target.value && fijar({ hasta: e.target.value })} />
          </label>
          <label className="campo rep-sector"><span>Sector</span>
            <select value={sector} onChange={(e) => fijar({ sector: e.target.value })}>
              <option value="">Todos los sectores</option>
              {sectores.lista.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        </div>
      </div>

      {rangoMal ? (
        <Aviso>La fecha desde no puede ser posterior a la fecha hasta.</Aviso>
      ) : (
        <ConDatos consulta={consulta}>
          {(r) => <VistaReporte r={r} sector={sector} nombre={sectores.nombre} actualizando={consulta.cargando} />}
        </ConDatos>
      )}

      <ResumenPorCorreo verPeriodo={(d, h) => {
        fijar({ desde: d, hasta: h, sector: '' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }} />
    </div>
  )
}

// ---------- Reporte en pantalla ----------

interface Columna {
  titulo: string
  num?: boolean
}

/** Tabla del reporte. Con `tarjetas`, en el celular cada fila se ve como una tarjeta con el nombre de cada dato. */
function Tabla({ columnas, children, tarjetas = false, etiqueta }: {
  columnas: Columna[]; children: ReactNode; tarjetas?: boolean; etiqueta: string
}) {
  return (
    <table className={`tabla rep-tabla${tarjetas ? ' rep-tarjetas' : ''}`} aria-label={etiqueta}>
      <thead><tr>{columnas.map((c) => <th key={c.titulo} className={c.num ? 'num' : undefined}>{c.titulo}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  )
}

function Seccion({ titulo, detalle, children }: { titulo: string; detalle?: ReactNode; children: ReactNode }) {
  return (
    <section className="rep-seccion">
      <h2>{titulo}{detalle && <span className="suave chico">{detalle}</span>}</h2>
      {children}
    </section>
  )
}

const Vacio = ({ children }: { children: ReactNode }) => <p className="suave">{children}</p>

function VistaReporte({ r, sector, nombre, actualizando }: {
  r: Reporte; sector: SectorId | ''; nombre: (s: SectorId) => string; actualizando: boolean
}) {
  const [excel, setExcel] = useState<{ estado: 'armando' | 'listo' | 'error'; texto?: string } | null>(null)
  const t = r.totales
  const sectoresCon = <T extends { sector: SectorId }>(xs: T[]) =>
    SECTOR_IDS.map((s) => ({ s, filas: xs.filter((x) => x.sector === s) })).filter((g) => g.filas.length > 0)

  const bajarExcel = async () => {
    setExcel({ estado: 'armando' })
    try {
      const archivo = `reporte-chipa-tia-${r.desde}${r.hasta !== r.desde ? `-a-${r.hasta}` : ''}${sector ? `-${sector}` : ''}.xlsx`
      await descargarExcel(archivo, hojasDelReporte(r, sector, nombre))
      setExcel({ estado: 'listo', texto: `Listo: se descargó ${archivo}.` })
    } catch (e) {
      console.error(e)
      setExcel({ estado: 'error', texto: `No se pudo armar el Excel. ${mensajeDe(e)}` })
    }
  }

  const sucursales = new Map<string, { nombre: string; total: number; filas: Reporte['envios'] }>()
  for (const e of r.envios) {
    const s = sucursales.get(e.sucursalId) ?? { nombre: e.sucursalNombre, total: 0, filas: [] }
    s.total += e.cantidad
    s.filas.push(e)
    sucursales.set(e.sucursalId, s)
  }

  return (
    <div aria-busy={actualizando}>
      <p className="suave rep-rango">
        {sector ? nombre(sector) : 'Todos los sectores'} · {periodoLegible(r.desde, r.hasta)} · hora de Paraguay
        <br /><span className="chico">Generado el {fechaHoraPY(r.generadoEn)}{actualizando ? ' · actualizando…' : ''}</span>
      </p>

      <div className="cifras">
        <div className="cifra"><strong>{num(t.cargasProduccion)}</strong><span>cargas de producción</span></div>
        <div className="cifra"><strong>{num(t.unidadesCocinadas)}</strong><span>unidades cocinadas</span></div>
        <div className="cifra"><strong>{num(t.unidadesGuardadas)}</strong><span>unidades guardadas en frío</span></div>
        <div className="cifra"><strong>{num(t.unidadesEnviadas)}</strong><span>unidades enviadas</span></div>
        <div className={t.temperaturasFueraDeRango ? 'cifra alerta' : 'cifra'}>
          <strong>{num(t.temperaturasFueraDeRango)}</strong><span>temperaturas fuera de rango</span>
        </div>
        <div className="cifra">
          <strong>{num(t.limpiezas)}</strong><span>limpiezas ({num(t.limpiezasSinControlar)} sin controlar)</span>
        </div>
      </div>

      <div className="rep-acciones">
        <button type="button" className="btn-primario" onClick={() => void bajarExcel()} disabled={excel?.estado === 'armando'}>
          {excel?.estado === 'armando' ? 'Armando el Excel…' : 'Descargar Excel'}
        </button>
      </div>
      {excel?.estado === 'listo' && <Aviso tipo="ok">{excel.texto}</Aviso>}
      {excel?.estado === 'error' && <Aviso>{excel.texto}</Aviso>}

      <Seccion titulo="Producción por producto" detalle="cocinado (venta) contra guardado (frío)">
        {r.produccion.length === 0 ? <Vacio>No se cargó producción en el período.</Vacio> : (
          <>
            <Tabla etiqueta="Producción por producto" columnas={[{ titulo: 'Producto' }, { titulo: 'Cocinado', num: true }, { titulo: 'Guardado', num: true }]}>
              {sectoresCon(r.produccion).map(({ s, filas }) => [
                <tr key={s} className="rep-grupo">
                  <td>{nombre(s)}</td>
                  <td className="num">{num(filas.reduce((a, f) => a + f.cocinado, 0))}</td>
                  <td className="num">{num(filas.reduce((a, f) => a + f.guardado, 0))}</td>
                </tr>,
                ...filas.map((f) => (
                  <tr key={`${s}-${f.productoId}`}>
                    <td>{f.productoNombre}</td>
                    <td className="num">{num(f.cocinado)}</td>
                    <td className="num">{num(f.guardado)}</td>
                  </tr>
                )),
              ])}
              <tr className="rep-total"><td>Total</td><td className="num">{num(t.unidadesCocinadas)}</td><td className="num">{num(t.unidadesGuardadas)}</td></tr>
            </Tabla>
            {(!sector || sector === 'chiperia') && <p className="suave chico">En Chipería, cocinado = al horno y guardado = al congelador.</p>}
          </>
        )}
      </Seccion>

      <Seccion titulo="Stock en frío actual" detalle="lo que hay hoy, no al cierre del período">
        {r.stock.length === 0 ? <Vacio>No hay stock en frío.</Vacio> : (
          <Tabla etiqueta="Stock en frío actual" columnas={[{ titulo: 'Producto' }, { titulo: 'Unidades', num: true }]}>
            {sectoresCon(r.stock).map(({ s, filas }) => [
              <tr key={s} className="rep-grupo"><td>{nombre(s)}</td><td className="num">{num(filas.reduce((a, f) => a + f.total, 0))}</td></tr>,
              ...filas.map((f) => (
                <tr key={`${s}-${f.productoId}`}>
                  <td>{f.productoNombre}</td>
                  <td className={`num${f.total < 0 ? ' rep-negativo' : ''}`}>{num(f.total)}</td>
                </tr>
              )),
            ])}
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Envíos por sucursal">
        {sucursales.size === 0 ? <Vacio>No hubo envíos en el período.</Vacio> : (
          <Tabla etiqueta="Envíos por sucursal" columnas={[{ titulo: 'Producto' }, { titulo: 'Unidades', num: true }]}>
            {[...sucursales.entries()].map(([id, s]) => [
              <tr key={id} className="rep-grupo"><td>{s.nombre}</td><td className="num">{num(s.total)}</td></tr>,
              ...s.filas.map((f, i) => (
                <tr key={`${id}-${i}`}>
                  <td>{f.productoNombre}{!sector && <div className="rep-muted">{nombre(f.sector)}</div>}</td>
                  <td className="num">{num(f.cantidad)}</td>
                </tr>
              )),
            ])}
            <tr className="rep-total"><td>Total enviado</td><td className="num">{num(t.unidadesEnviadas)}</td></tr>
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Salidas del stock" detalle="por tipo, en unidades">
        {r.salidas.length === 0 ? <Vacio>No salió nada del frío en el período.</Vacio> : (
          <Tabla etiqueta="Salidas del stock" columnas={[{ titulo: 'Tipo' }, { titulo: 'Unidades', num: true }]}>
            {sectoresCon(r.salidas).map(({ s, filas }) => [
              <tr key={s} className="rep-grupo"><td>{nombre(s)}</td><td className="num">{num(filas.reduce((a, f) => a + f.cantidad, 0))}</td></tr>,
              ...filas.map((f) => (
                <tr key={`${s}-${f.tipo}`}>
                  <td>
                    <span className={`rep-etiqueta${f.tipo === 'merma' || f.tipo === 'vencimiento' ? ' rep-rojo' : ''}`}>
                      {NOMBRE_TIPO_MOVIMIENTO[f.tipo]}
                    </span>
                  </td>
                  <td className="num">{num(f.cantidad)}</td>
                </tr>
              )),
            ])}
          </Tabla>
        )}
      </Seccion>

      {(!sector || sector === 'chiperia') && (
        <Seccion titulo="Lotes de Chipería" detalle={r.lotesChipa.length ? `${r.lotesChipa.length} ${r.lotesChipa.length === 1 ? 'lote' : 'lotes'}` : undefined}>
          {r.lotesChipa.length === 0 ? <Vacio>No hubo producción de chipas en el período.</Vacio> : (
            <Tabla etiqueta="Lotes de Chipería" tarjetas columnas={[
              { titulo: 'Lote' }, { titulo: 'Día' }, { titulo: 'Horno', num: true }, { titulo: 'Congelador', num: true },
              { titulo: 'Queda', num: true }, { titulo: 'Materia prima' },
            ]}>
              {r.lotesChipa.map((l) => (
                <tr key={l.id}>
                  <td className="rep-nowrap"><Link to={`/trazabilidad?lote=${encodeURIComponent(l.codigo)}`}>{l.codigo}</Link></td>
                  <td data-etiqueta="Día" className="rep-medio rep-nowrap">{diaLegible(l.dia)}</td>
                  <td data-etiqueta="Horno" className="num rep-medio">{num(l.horno)}</td>
                  <td data-etiqueta="Congelador" className="num rep-medio">{num(l.congelador)}</td>
                  <td data-etiqueta="Queda" className="num rep-medio">{num(l.stock)}</td>
                  <td data-etiqueta="Materia prima" className="chico">{l.lotesMP.map((m) => m.descripcion).join(' · ') || '—'}</td>
                </tr>
              ))}
            </Tabla>
          )}
        </Seccion>
      )}

      <Seccion titulo="Temperaturas fuera de rango" detalle={r.temperaturasFueraDeRango.length ? `${r.temperaturasFueraDeRango.length}` : undefined}>
        {r.temperaturasFueraDeRango.length === 0 ? <Vacio>Ninguna en el período.</Vacio> : (
          <TablaLecturas lecturas={r.temperaturasFueraDeRango} nombre={nombre} rojas etiqueta="Temperaturas fuera de rango" />
        )}
      </Seccion>

      <Seccion titulo="Máquinas con fallas">
        {r.maquinasConFallas.length === 0 ? <Vacio>Ninguna máquina reportada con fallas o fuera de servicio.</Vacio> : (
          <TablaLecturas lecturas={r.maquinasConFallas} nombre={nombre} etiqueta="Máquinas con fallas" />
        )}
      </Seccion>

      <Seccion titulo="Limpiezas" detalle={t.limpiezas ? `${num(t.limpiezas)} reportes · ${num(t.limpiezasSinControlar)} sin controlar` : undefined}>
        {r.limpiezas.length === 0 ? <Vacio>No se reportaron limpiezas en el período.</Vacio> : (
          <>
            <Tabla etiqueta="Limpiezas" columnas={[
              { titulo: 'Área' }, { titulo: 'Reportes', num: true }, { titulo: 'Sin controlar', num: true }, { titulo: 'Tareas sin hacer', num: true },
            ]}>
              {sectoresCon(r.limpiezas).map(({ s, filas }) => [
                <tr key={s} className="rep-grupo"><td colSpan={4}>{nombre(s)}</td></tr>,
                ...filas.map((f) => (
                  <tr key={`${s}-${f.areaNombre}`}>
                    <td>{f.areaNombre}</td>
                    <td className="num">{num(f.cantidad)}</td>
                    <td className="num">{f.sinControlar ? <span className="rep-etiqueta">{num(f.sinControlar)}</span> : '0'}</td>
                    <td className="num">{f.tareasNoHechas ? <span className="rep-etiqueta rep-rojo">{num(f.tareasNoHechas)}</span> : '0'}</td>
                  </tr>
                )),
              ])}
            </Tabla>
            <p className="chico"><Link to="/admin/controles">Ver las limpiezas y dar el visto bueno</Link></p>
          </>
        )}
      </Seccion>
    </div>
  )
}

function TablaLecturas({ lecturas, nombre, rojas = false, etiqueta }: {
  lecturas: Lectura[]; nombre: (s: SectorId) => string; rojas?: boolean; etiqueta: string
}) {
  return (
    <Tabla etiqueta={etiqueta} tarjetas columnas={[
      { titulo: 'Fecha y hora' }, { titulo: 'Máquina' }, rojas ? { titulo: 'Temperatura', num: true } : { titulo: 'Estado' }, { titulo: 'Observación' },
    ]}>
      {lecturas.map((l) => (
        <tr key={l.id} className={rojas ? 'fila-roja' : undefined}>
          <td>{fechaHoraPY(l.fecha)}</td>
          <td data-etiqueta="Máquina">
            N° {l.maquinaNumero} · {l.maquinaNombre}
            <div className="rep-muted">{nombre(l.sector)} · {NOMBRE_MOMENTO[l.momento]} · {l.usuarioNombre}</div>
          </td>
          {rojas
            ? <td data-etiqueta="Temperatura" className="num"><strong>{grados(l.temperatura)}</strong></td>
            : <td data-etiqueta="Estado"><span className="rep-etiqueta rep-rojo">{NOMBRE_ESTADO[l.estado]}</span></td>}
          <td data-etiqueta="Observación" className={l.observacion || l.mantenimiento ? undefined : 'rep-vacia'}>
            {l.observacion || (l.mantenimiento ? '' : '—')}
            {l.mantenimiento && <div className="rep-muted">Mantenimiento: {l.mantenimiento}{l.mantenimientoPor ? ` · ${l.mantenimientoPor}` : ''}</div>}
          </td>
        </tr>
      ))}
    </Tabla>
  )
}

// ---------- Excel (H03) ----------

function hojasDelReporte(r: Reporte, sector: SectorId | '', nombre: (s: SectorId) => string): Hoja[] {
  const periodo = r.desde === r.hasta ? diaLegible(r.desde) : `del ${diaLegible(r.desde)} al ${diaLegible(r.hasta)}`
  const arriba = (titulo: string): Celda[][] => [[negrita(`${titulo} · ${periodo}`)]]
  const t = r.totales
  const hojas: Hoja[] = [
    {
      nombre: 'Resumen',
      arriba: [
        [negrita('Chipa Tía · Reporte de producción', { fontSize: 14 })],
        ['Desde', celdaDia(r.desde)],
        ['Hasta', celdaDia(r.hasta)],
        ['Sectores', sector ? nombre(sector) : 'Todos'],
        ['Generado', celdaFechaHora(r.generadoEn)],
        ['Fechas y horas en hora de Paraguay.'],
      ],
      encabezados: ['Dato', 'Cantidad'],
      filas: [
        ['Cargas de producción', t.cargasProduccion],
        ['Unidades cocinadas', t.unidadesCocinadas],
        ['Unidades guardadas en frío', t.unidadesGuardadas],
        ['Unidades enviadas a sucursales', t.unidadesEnviadas],
        ['Temperaturas fuera de rango', t.temperaturasFueraDeRango],
        ['Limpiezas reportadas', t.limpiezas],
        ['Limpiezas sin controlar', t.limpiezasSinControlar],
      ],
      anchos: [34, 14],
    },
    {
      nombre: 'Producción',
      arriba: arriba('Producción por producto'),
      encabezados: ['Sector', 'Producto', 'Cocinado', 'Guardado', 'Total'],
      filas: r.produccion.map((p) => [nombre(p.sector), p.productoNombre, p.cocinado, p.guardado, p.cocinado + p.guardado]),
    },
    {
      nombre: 'Stock actual',
      arriba: [[negrita(`Stock en frío al ${fechaHoraPY(r.generadoEn)}`)]],
      encabezados: ['Sector', 'Producto', 'Unidades'],
      filas: r.stock.map((s) => [nombre(s.sector), s.productoNombre, s.total]),
    },
    {
      nombre: 'Envíos',
      arriba: arriba('Envíos por sucursal'),
      encabezados: ['Sucursal', 'Sector', 'Producto', 'Unidades'],
      filas: r.envios.map((e) => [e.sucursalNombre, nombre(e.sector), e.productoNombre, e.cantidad]),
    },
    {
      nombre: 'Salidas',
      arriba: arriba('Salidas del stock por tipo'),
      encabezados: ['Sector', 'Tipo', 'Unidades'],
      filas: r.salidas.map((s) => [nombre(s.sector), NOMBRE_TIPO_MOVIMIENTO[s.tipo], s.cantidad]),
    },
  ]
  if (!sector || sector === 'chiperia') {
    hojas.push({
      nombre: 'Lotes de chipa',
      arriba: arriba('Lotes de Chipería'),
      encabezados: ['Lote', 'Día', 'Amasada', 'Horno', 'Congelador', 'Queda', 'Materia prima'],
      filas: r.lotesChipa.map((l) => [l.codigo, celdaDia(l.dia), l.amasada, l.horno, l.congelador, l.stock, l.lotesMP.map((m) => m.descripcion).join(' · ')]),
    })
  }
  const lecturas = (ls: Lectura[]): Celda[][] => ls.map((l) => [
    celdaFechaHora(l.fecha), nombre(l.sector), l.maquinaNumero, l.maquinaNombre, NOMBRE_MOMENTO[l.momento], NOMBRE_ESTADO[l.estado],
    l.temperatura, l.observacion, l.mantenimiento ?? '', l.mantenimientoPor ?? '', l.usuarioNombre,
  ])
  const columnasLectura = ['Fecha y hora', 'Sector', 'N°', 'Máquina', 'Momento', 'Estado', 'Temperatura (°C)', 'Observación', 'Mantenimiento', 'Hecho por', 'Usuario']
  hojas.push(
    { nombre: 'Temperaturas fuera de rango', arriba: arriba('Temperaturas fuera de rango'), encabezados: columnasLectura, filas: lecturas(r.temperaturasFueraDeRango) },
    { nombre: 'Máquinas con fallas', arriba: arriba('Máquinas con fallas o fuera de servicio'), encabezados: columnasLectura, filas: lecturas(r.maquinasConFallas) },
    {
      nombre: 'Limpiezas',
      arriba: arriba('Limpiezas por sector y área'),
      encabezados: ['Sector', 'Área', 'Reportes', 'Sin controlar', 'Tareas sin hacer'],
      filas: r.limpiezas.map((l) => [nombre(l.sector), l.areaNombre, l.cantidad, l.sinControlar, l.tareasNoHechas]),
    },
  )
  return hojas
}

// ---------- Resumen por correo (H04) ----------

const PERIODOS: [PeriodoResumen, string][] = [
  ['hoy', 'Hoy (lo cargado hasta ahora)'], ['diario', 'Diario'], ['semanal', 'Semanal'], ['mensual', 'Mensual'],
]
const QUE_CUBRE: Record<PeriodoResumen, string> = {
  hoy: 'lo cargado hasta ahora en el día de hoy',
  diario: 'el día de ayer',
  semanal: 'la semana pasada, de lunes a domingo',
  mensual: 'el mes pasado completo',
}

function ResumenPorCorreo({ verPeriodo }: { verPeriodo: (desde: string, hasta: string) => void }) {
  const hoy = diaPY()
  const [periodo, setPeriodo] = useState<PeriodoResumen>('hoy')
  const [resultado, setResultado] = useState<ResumenCorreo | null>(null)
  const config = useConsulta<Configuracion>('/config')
  const enviar = useAccion((p: PeriodoResumen) => post<ResumenCorreo>('/reportes/enviar', { periodo: p }))
  const { desde, hasta } = periodo === 'hoy' ? { desde: hoy, hasta: hoy } : rangoResumen(periodo, hoy)
  const destino = config.datos?.correoReportes

  const mandar = async () => {
    setResultado(null)
    const r = await enviar.ejecutar(periodo)
    if (r) setResultado(r)
  }

  return (
    <section className="rep-seccion">
      <h2>Resumen por correo</h2>
      <div className="tarjeta">
        <p className="rep-nota">
          Todos los días a las 06:00 llega el resumen de ayer; los lunes, el de la semana pasada; el día 1, el del mes pasado.
          Cada correo trae el enlace a este reporte.
        </p>
        <div className="segmentado chico" role="group" aria-label="Resumen a enviar">
          {PERIODOS.map(([p, t]) => (
            <button key={p} type="button" className={periodo === p ? 'activo' : ''} aria-pressed={periodo === p}
              onClick={() => { setPeriodo(p); setResultado(null) }}>
              {t}
            </button>
          ))}
        </div>
        <p className="rep-nota">
          Cubre {QUE_CUBRE[periodo]}: {periodoLegible(desde, hasta)}.{' '}
          <button type="button" className="btn-texto" onClick={() => verPeriodo(desde, hasta)}>Ver ese período arriba</button>
        </p>
        <p className="rep-nota">
          {config.datos === undefined ? 'Buscando el correo configurado…'
            : destino ? <>Se envía a <strong>{destino}</strong>. <Link to="/admin/datos">Cambiar</Link></>
              : <>Todavía no hay un correo para los resúmenes. <Link to="/admin/datos">Cargalo en Datos</Link>.</>}
          {esDemo && ' En la demo no se envían correos: se muestra cómo se vería.'}
        </p>
        <button type="button" className="btn-secundario" onClick={() => void mandar()} disabled={enviar.enviando}>
          {enviar.enviando ? 'Armando el resumen…' : 'Enviar resumen de prueba'}
        </button>
        {enviar.error && <Aviso>{enviar.error}</Aviso>}
        {resultado && (
          <>
            {resultado.enviado
              ? <p className="ok" role="status">Listo: se envió «{resultado.asunto}» a {resultado.destino}. Revisá la bandeja de entrada.</p>
              : <p className="rep-aviso" role="status">No se envió: {resultado.motivo}</p>}
            <p className="suave chico">Vista previa · asunto: «{resultado.asunto}»</p>
            <iframe
              className="rep-vista"
              title="Vista previa del correo"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={resultado.html.replace('<head>', '<head><base target="_blank">')}
            />
          </>
        )}
      </div>
    </section>
  )
}

// ---------- Enlace del correo cuando hay que entrar primero ----------

const CLAVE_ENLACE = 'chipa-tia-enlace-reporte'
const VIGENCIA_ENLACE = 30 * 60_000

/** Sin sesión: si se abrió el enlace de un reporte, lo recuerda para después de entrar. */
export function RecordarEnlaceReporte() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (pathname !== '/admin/reportes' || !search) return
    try {
      sessionStorage.setItem(CLAVE_ENLACE, JSON.stringify({ a: `${pathname}${search}`, t: Date.now() }))
    } catch {
      // sin almacenamiento: se entra a la pantalla de inicio
    }
  }, [pathname, search])
  return null
}

/** En la pantalla de inicio del administrador: si venía de un enlace de reporte, lo abre. */
export function IrAlEnlacePendiente() {
  const navigate = useNavigate()
  useEffect(() => {
    let destino: string | null = null
    try {
      const guardado = sessionStorage.getItem(CLAVE_ENLACE)
      sessionStorage.removeItem(CLAVE_ENLACE)
      const o = guardado ? (JSON.parse(guardado) as { a?: unknown; t?: unknown }) : null
      if (o && typeof o.a === 'string' && o.a.startsWith('/admin/reportes?') && typeof o.t === 'number' && Date.now() - o.t < VIGENCIA_ENLACE) {
        destino = o.a
      }
    } catch {
      // nada que abrir
    }
    if (destino) navigate(destino, { replace: true })
  }, [navigate])
  return null
}
