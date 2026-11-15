// M14 y reportes detallados. El administrador ve y carga ingresos y egresos, define los gastos fijos y sueldos y
// mira el reporte detallado (ventas, cajas, ingresos y egresos, sueldos). El supervisor solo ve los egresos por pagos
// a proveedores.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { get, patch, post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { celdaDia, descargarExcel, negrita, type Hoja } from '../../cliente/excel'
import { usePuede } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { Icono } from '../../components/Iconos'
import Volver from '../../components/Volver'
import { gs, leerImporte, miles } from '../../shared/dinero'
import { diaLegible, diaPY, inicioDeMes } from '../../shared/hora'
import {
  MEDIOS_PAGO, NOMBRE_MEDIO_PAGO,
  type GastoFijo, type GastoFijoMes, type MedioPago, type ReporteDetallado, type ResumenIE,
} from '../../shared/tipos'
import { TablaTotales, textoDiferencia } from '../caja/Caja'
import '../../styles/compras.css'

type Pestana = 'ie' | 'fijos' | 'reporte'

export default function Finanzas() {
  const puede = usePuede()
  const completo = puede('ie.completo')
  const [params, setParams] = useSearchParams()
  const pestanas: [Pestana, string][] = completo
    ? [['ie', 'Ingresos y egresos'], ['fijos', 'Gastos fijos y sueldos'], ['reporte', 'Reporte detallado']]
    : [['ie', 'Egresos a proveedores']]
  const pedida = params.get('ver')
  const pestana: Pestana = pestanas.some(([p]) => p === pedida) ? (pedida as Pestana) : 'ie'
  const hoy = diaPY()
  const [desde, setDesde] = useState(inicioDeMes(hoy))
  const [hasta, setHasta] = useState(hoy)
  return (
    <>
      <Volver titulo={completo ? 'Finanzas' : 'Egresos a proveedores'} icono={<Icono nombre="dinero" />} a="/admin" />
      {pestanas.length > 1 && (
        <div className="segmentado" role="tablist">
          {pestanas.map(([p, t]) => (
            <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''}
              onClick={() => setParams({ ver: p }, { replace: true })}>{t}</button>
          ))}
        </div>
      )}
      {pestana !== 'fijos' && (
        <div className="tarjeta filtros">
          <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      )}
      {pestana === 'ie' && <IngresosEgresos desde={desde} hasta={hasta} completo={completo} />}
      {pestana === 'fijos' && <GastosFijos />}
      {pestana === 'reporte' && <Reporte desde={desde} hasta={hasta} />}
    </>
  )
}

function CampoImporte({ etiqueta, valor, onChange }: { etiqueta: string; valor: number; onChange: (n: number) => void }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      <input inputMode="numeric" value={valor ? miles(valor) : ''} placeholder="0" onChange={(e) => onChange(leerImporte(e.target.value))} />
    </label>
  )
}

const ORIGEN = { manual: 'Cargado a mano', gasto_fijo: 'Gasto fijo', venta: 'Ventas (automático)', proveedor: 'Pago a proveedor (automático)' }

// ---------- Ingresos y egresos ----------

function IngresosEgresos({ desde, hasta, completo }: { desde: string; hasta: string; completo: boolean }) {
  const r = useConsulta<ResumenIE>('/ie', { desde, hasta })
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const anular = useAccion((id: string) => post(`/ie/${id}/anular`, { motivo }))
  const exportar = useAccion(async () => {
    const d = await get<ResumenIE>('/ie', { desde, hasta })
    await descargarExcel(`ingresos-egresos-${d.desde}-a-${d.hasta}.xlsx`, [{
      nombre: 'Ingresos y egresos',
      arriba: [[negrita(`Ingresos y egresos · ${diaLegible(d.desde)} al ${diaLegible(d.hasta)}`)]],
      encabezados: ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Medio', 'Importe', 'Origen', 'Anulado'],
      filas: d.movimientos.map((m) => [
        celdaDia(m.dia), m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso', m.concepto, m.categoria, m.medio ? NOMBRE_MEDIO_PAGO[m.medio] : '',
        m.tipo === 'ingreso' ? m.importe : -m.importe, ORIGEN[m.origen], m.anulado ? 'Sí' : '',
      ]),
    }])
  })
  return (
    <>
      {completo && <NuevoMovimiento />}
      <ConDatos consulta={r}>
        {(d) => (
          <>
            <div className="cifras">
              {!d.soloProveedores && <div className="cifra"><span className="suave chico">Ingresos</span><strong>{gs(d.ingresos)}</strong></div>}
              <div className="cifra"><span className="suave chico">Egresos</span><strong>{gs(d.egresos)}</strong></div>
              {!d.soloProveedores && <div className="cifra"><span className="suave chico">Resultado</span><strong className={d.resultado < 0 ? 'diferencia-negativa' : ''}>{gs(d.resultado)}</strong></div>}
            </div>
            {d.porCategoria.length > 0 && (
              <>
                <h2>Por categoría</h2>
                <table className="tabla tabla-caja">
                  <tbody>{d.porCategoria.map((k) => <tr key={`${k.tipo}${k.categoria}`}><td>{k.tipo === 'ingreso' ? '＋' : '−'} {k.categoria}</td><td>{miles(k.importe)}</td></tr>)}</tbody>
                </table>
              </>
            )}
            <div className="fila-acciones">
              <h2>Movimientos</h2>
              <button type="button" className="btn-texto" disabled={exportar.enviando} onClick={() => void exportar.ejecutar()}>Descargar Excel</button>
            </div>
            <Aviso>{exportar.error ?? anular.error}</Aviso>
            {d.movimientos.length ? (
              <ul className="lista-pagos">
                {d.movimientos.map((m) => (
                  <li key={m.id} className={m.anulado ? 'apagado' : ''}>
                    {diaLegible(m.dia)} · <strong className={m.tipo === 'egreso' ? 'diferencia-negativa' : 'diferencia-positiva'}>{m.tipo === 'ingreso' ? '+' : '−'}{miles(m.importe)}</strong> · {m.concepto}
                    <span className="suave chico"> · {m.categoria}{m.medio && ` · ${NOMBRE_MEDIO_PAGO[m.medio]}`}{m.desdeCaja && ' · de la caja'}{m.origen === 'venta' || m.origen === 'proveedor' ? ' · automático' : ''}{m.anulado && ' · anulado'}</span>
                    {completo && !m.anulado && (m.origen === 'manual' || m.origen === 'gasto_fijo') && anulando !== m.id && (
                      <button type="button" className="btn-texto" onClick={() => { setAnulando(m.id); setMotivo('') }}>Anular</button>
                    )}
                    {anulando === m.id && (
                      <div className="filtros anular">
                        <label className="campo"><span>Motivo</span><input value={motivo} maxLength={300} autoFocus onChange={(e) => setMotivo(e.target.value)} /></label>
                        <button type="button" className="btn-primario" disabled={!motivo.trim() || anular.enviando} onClick={() => void anular.ejecutar(m.id).then((x) => x && setAnulando(null))}>Anular</button>
                        <button type="button" className="btn-texto" onClick={() => setAnulando(null)}>Cancelar</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="suave">No hay movimientos en ese período.</p>}
          </>
        )}
      </ConDatos>
    </>
  )
}

function NuevoMovimiento() {
  const categorias = useConsulta<{ ingreso: string[]; egreso: string[] }>('/ie/categorias')
  const vacio = { tipo: 'egreso' as 'ingreso' | 'egreso', dia: diaPY(), concepto: '', categoria: '', importe: 0, medio: 'efectivo' as MedioPago, desdeCaja: false }
  const [d, setD] = useState(vacio)
  const [ok, setOk] = useState(false)
  const guardar = useAccion(() => post('/ie', d))
  const opciones = categorias.datos?.[d.tipo] ?? []
  return (
    <details className="tarjeta">
      <summary><strong>Cargar un ingreso o egreso</strong> <span className="suave chico">(lo que no viene de ventas ni de compras)</span></summary>
      <div className="filtros">
        <label className="campo">
          <span>Tipo</span>
          <select value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as 'ingreso' | 'egreso', categoria: '' })}>
            <option value="egreso">Egreso (gasto)</option>
            <option value="ingreso">Ingreso</option>
          </select>
        </label>
        <label className="campo"><span>Fecha</span><input type="date" value={d.dia} max={diaPY()} onChange={(e) => setD({ ...d, dia: e.target.value })} /></label>
        <label className="campo"><span>Concepto</span><input value={d.concepto} maxLength={200} placeholder="Factura de la ANDE" onChange={(e) => setD({ ...d, concepto: e.target.value })} /></label>
        <label className="campo">
          <span>Categoría</span>
          <input list="categorias-ie" value={d.categoria} maxLength={60} onChange={(e) => setD({ ...d, categoria: e.target.value })} />
          <datalist id="categorias-ie">{opciones.map((o) => <option key={o} value={o} />)}</datalist>
        </label>
        <CampoImporte etiqueta="Importe (Gs.)" valor={d.importe} onChange={(n) => setD({ ...d, importe: n })} />
        <label className="campo">
          <span>Medio</span>
          <select value={d.medio} onChange={(e) => setD({ ...d, medio: e.target.value as MedioPago })}>
            {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={d.desdeCaja} onChange={(e) => setD({ ...d, desdeCaja: e.target.checked })} />
          <span>{d.tipo === 'egreso' ? 'Sale de la caja abierta' : 'Entra a la caja abierta'}</span>
        </label>
      </div>
      <Aviso>{guardar.error}</Aviso>
      {ok && <Aviso tipo="ok">Guardado.</Aviso>}
      <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void guardar.ejecutar().then((r) => { if (r) { setOk(true); setD({ ...vacio, tipo: d.tipo }) } })}>Guardar</button>
    </details>
  )
}

// ---------- Gastos fijos y sueldos ----------

function GastosFijos() {
  const [periodo, setPeriodo] = useState(diaPY().slice(0, 7))
  const c = useConsulta<GastoFijoMes[]>('/gastos-fijos', { periodo })
  const [nuevo, setNuevo] = useState({ nombre: '', categoria: '', importe: 0, diaDelMes: 5, esSueldo: false })
  const crear = useAccion(() => post<GastoFijo>('/gastos-fijos', nuevo))
  return (
    <>
      <p className="suave">
        Los gastos que se repiten cada mes (alquiler, luz, internet) y los sueldos. Solo el administrador define y cambia
        sus importes. Cada mes, al pagarlo, tocá «Marcar pagado»: queda como egreso en Ingresos y egresos.
      </p>
      <label className="campo"><span>Mes</span><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></label>
      <ConDatos consulta={c}>
        {(lista) => lista.length ? (
          <>
            <p className="chico">
              Sueldos: {gs(lista.filter((g) => g.esSueldo && g.activo).reduce((s, g) => s + g.importe, 0))} · Otros gastos fijos: {gs(lista.filter((g) => !g.esSueldo && g.activo).reduce((s, g) => s + g.importe, 0))}
              {' · '}Falta pagar: {gs(lista.filter((g) => !g.pagado && g.activo).reduce((s, g) => s + g.importe, 0))}
            </p>
            <div className="lista">{lista.map((g) => <FilaGasto key={g.id} g={g} />)}</div>
          </>
        ) : <p className="suave">Todavía no hay gastos fijos.</p>}
      </ConDatos>
      <h2>Nuevo gasto fijo o sueldo</h2>
      <div className="tarjeta filtros">
        <label className="campo"><span>Nombre</span><input value={nuevo.nombre} maxLength={100} placeholder="Sueldo de María" onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={nuevo.esSueldo} onChange={(e) => setNuevo({ ...nuevo, esSueldo: e.target.checked })} /><span>Es un sueldo</span></label>
        {!nuevo.esSueldo && <label className="campo"><span>Categoría</span><input value={nuevo.categoria} maxLength={60} placeholder="Alquiler" onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} /></label>}
        <CampoImporte etiqueta="Importe mensual (Gs.)" valor={nuevo.importe} onChange={(n) => setNuevo({ ...nuevo, importe: n })} />
        <label className="campo"><span>Vence el día</span><input inputMode="numeric" value={String(nuevo.diaDelMes)} onChange={(e) => setNuevo({ ...nuevo, diaDelMes: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></label>
        <button type="button" className="btn-primario" disabled={crear.enviando} onClick={() => void crear.ejecutar().then((r) => r && setNuevo({ nombre: '', categoria: '', importe: 0, diaDelMes: 5, esSueldo: false }))}>Agregar</button>
      </div>
      <Aviso>{crear.error}</Aviso>
    </>
  )
}

function FilaGasto({ g }: { g: GastoFijoMes }) {
  const [editando, setEditando] = useState(false)
  const [importe, setImporte] = useState(g.importe)
  const [medio, setMedio] = useState<MedioPago>('transferencia')
  const [desdeCaja, setDesdeCaja] = useState(false)
  const [pagando, setPagando] = useState(false)
  const guardar = useAccion((cambios: Partial<GastoFijo>) => patch<GastoFijo>(`/gastos-fijos/${g.id}`, cambios))
  const pagar = useAccion(() => post(`/gastos-fijos/${g.id}/pagar`, { periodo: g.periodo, medio, desdeCaja }))
  return (
    <div className={`item${g.activo ? '' : ' apagado'}`}>
      <div className="compra-cabeza">
        <span><strong>{g.nombre}</strong> <span className="suave chico">· {g.esSueldo ? 'Sueldo' : g.categoria}</span></span>
        <span className="compra-cifras">
          <strong>{gs(g.importe)}</strong>
          <span className={`etq-compra ${g.pagado ? 'pagada' : g.vence < diaPY() ? 'vencida' : 'pendiente'}`}>{g.pagado ? 'Pagado' : g.vence < diaPY() ? 'Vencido' : 'Pendiente'}</span>
        </span>
        <span className="suave chico">Vence el {diaLegible(g.vence)}{g.pagado && g.importePagado !== g.importe ? ` · se pagó ${gs(g.importePagado ?? 0)}` : ''}{!g.activo && ' · desactivado'}</span>
      </div>
      {editando ? (
        <div className="filtros">
          <CampoImporte etiqueta="Importe mensual (Gs.)" valor={importe} onChange={setImporte} />
          <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void guardar.ejecutar({ importe }).then((r) => r && setEditando(false))}>Guardar</button>
          <button type="button" className="btn-texto" onClick={() => setEditando(false)}>Cancelar</button>
        </div>
      ) : pagando ? (
        <div className="filtros">
          <label className="campo">
            <span>Medio</span>
            <select value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
              {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={desdeCaja} onChange={(e) => setDesdeCaja(e.target.checked)} /><span>Sale de la caja abierta</span></label>
          <button type="button" className="btn-primario" disabled={pagar.enviando} onClick={() => void pagar.ejecutar().then((r) => r && setPagando(false))}>Marcar pagado {gs(g.importe)}</button>
          <button type="button" className="btn-texto" onClick={() => setPagando(false)}>Cancelar</button>
        </div>
      ) : (
        <div className="fila-acciones">
          {!g.pagado && g.activo && <button type="button" className="btn-texto" onClick={() => setPagando(true)}>Marcar pagado</button>}
          <button type="button" className="btn-texto" onClick={() => { setImporte(g.importe); setEditando(true) }}>Cambiar importe</button>
          <button type="button" className="btn-texto" disabled={guardar.enviando} onClick={() => void guardar.ejecutar({ activo: !g.activo })}>{g.activo ? 'Desactivar' : 'Activar'}</button>
        </div>
      )}
      <Aviso>{guardar.error ?? pagar.error}</Aviso>
    </div>
  )
}

// ---------- Reporte detallado ----------

function Reporte({ desde, hasta }: { desde: string; hasta: string }) {
  const r = useConsulta<ReporteDetallado>('/reportes/detallado', { desde, hasta })
  const exportar = useAccion(async () => {
    const d = await get<ReporteDetallado>('/reportes/detallado', { desde, hasta })
    const arriba = [[negrita(`Reporte detallado · ${diaLegible(d.desde)} al ${diaLegible(d.hasta)}`)]]
    const hojas: Hoja[] = [
      {
        nombre: 'Resumen', arriba, encabezados: ['Concepto', 'Importe (Gs.)'],
        filas: [
          ['Ventas (cantidad)', d.ventas.cantidad], ['Ventas brutas', d.ventas.bruto], ['Descuentos', d.ventas.descuentos], ['Ventas netas', d.ventas.total],
          ['Ticket promedio', d.ventas.ticketPromedio], ['Ventas anuladas', d.ventas.anuladas], ['Diferencias de caja', d.diferenciasCaja],
          ['Ingresos', d.ie.ingresos], ['Egresos', d.ie.egresos], ['Resultado', d.ie.resultado],
          ['Sueldos pagados', d.sueldos.pagados], ['Sueldos pendientes', d.sueldos.pendientes],
          ['Gastos fijos pagados', d.gastosFijos.pagados], ['Gastos fijos pendientes', d.gastosFijos.pendientes],
          ['Compras', d.compras.total], ['Pagado a proveedores', d.compras.pagado], ['Deuda con proveedores hoy', d.compras.deudaTotal],
        ],
      },
      { nombre: 'Ventas por día', arriba, encabezados: ['Día', 'Ventas', 'Importe'], filas: d.ventas.porDia.map((x) => [celdaDia(x.dia), x.cantidad, x.importe]) },
      { nombre: 'Por producto', arriba, encabezados: ['Producto', 'Cantidad', 'Importe'], filas: d.ventas.porProducto.map((x) => [x.nombre, x.cantidad, x.importe]) },
      {
        nombre: 'Cajas', arriba, encabezados: ['Día', 'Abrió', 'Cerró', 'Fondo', 'Ventas', 'Esperado', 'Contado', 'Diferencia'],
        filas: d.cajas.map((c) => [celdaDia(c.dia), c.abiertaPorNombre, c.cerradaPorNombre ?? 'Abierta', c.fondoInicial, c.totalVentas, c.esperadoEfectivo, c.contadoEfectivo, c.diferencia]),
      },
      { nombre: 'Categorías I-E', arriba, encabezados: ['Tipo', 'Categoría', 'Importe'], filas: d.ie.porCategoria.map((k) => [k.tipo === 'ingreso' ? 'Ingreso' : 'Egreso', k.categoria, k.importe]) },
      {
        nombre: 'Sueldos', arriba, encabezados: ['Mes', 'Nombre', 'Importe', 'Pagado'],
        filas: d.sueldos.detalle.map((s) => [s.periodo, s.nombre, s.importe, s.pagado ? s.importePagado : 'No']),
      },
    ]
    await descargarExcel(`reporte-detallado-${d.desde}-a-${d.hasta}.xlsx`, hojas)
  })
  return (
    <>
      <button type="button" className="btn-secundario" disabled={exportar.enviando} onClick={() => void exportar.ejecutar()}>Descargar Excel</button>
      <Aviso>{exportar.error}</Aviso>
      <ConDatos consulta={r}>
        {(d) => (
          <>
            <h2>Ventas</h2>
            <div className="cifras">
              <div className="cifra"><span className="suave chico">Vendido ({d.ventas.cantidad})</span><strong>{gs(d.ventas.total)}</strong></div>
              <div className="cifra"><span className="suave chico">Descuentos</span><strong>{gs(d.ventas.descuentos)}</strong></div>
              <div className="cifra"><span className="suave chico">Ticket promedio</span><strong>{gs(d.ventas.ticketPromedio)}</strong></div>
              <div className="cifra"><span className="suave chico">Anuladas · con factura</span><strong>{d.ventas.anuladas} · {d.ventas.facturas}</strong></div>
            </div>
            {d.ventas.porMedio.length > 0 && <p className="suave">Por medio: {d.ventas.porMedio.map((m) => `${NOMBRE_MEDIO_PAGO[m.medio]} ${gs(m.importe)} (${m.cantidad})`).join(' · ')}</p>}
            {d.ventas.porProducto.length > 0 && (
              <table className="tabla tabla-caja">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Importe</th></tr></thead>
                <tbody>{d.ventas.porProducto.slice(0, 15).map((x) => <tr key={x.productoId}><td>{x.nombre}</td><td>{miles(x.cantidad)}</td><td>{miles(x.importe)}</td></tr>)}</tbody>
              </table>
            )}
            <h2>Cajas</h2>
            {d.cajas.length ? (
              <>
                <p className="suave">Diferencias del período: {textoDiferencia(d.diferenciasCaja)}</p>
                <div className="lista">
                  {d.cajas.map((c) => (
                    <details key={c.id} className="item">
                      <summary>{diaLegible(c.dia)} · {c.abiertaPorNombre} · ventas {gs(c.totalVentas)} · {c.diferencia === null ? 'abierta' : textoDiferencia(c.diferencia)}</summary>
                      <TablaTotales caja={c} />
                    </details>
                  ))}
                </div>
              </>
            ) : <p className="suave">No hubo cajas en el período.</p>}
            <h2>Ingresos y egresos</h2>
            <div className="cifras">
              <div className="cifra"><span className="suave chico">Ingresos</span><strong>{gs(d.ie.ingresos)}</strong></div>
              <div className="cifra"><span className="suave chico">Egresos</span><strong>{gs(d.ie.egresos)}</strong></div>
              <div className="cifra"><span className="suave chico">Resultado</span><strong className={d.ie.resultado < 0 ? 'diferencia-negativa' : ''}>{gs(d.ie.resultado)}</strong></div>
            </div>
            <h2>Sueldos y gastos fijos</h2>
            <div className="cifras">
              <div className="cifra"><span className="suave chico">Sueldos pagados</span><strong>{gs(d.sueldos.pagados)}</strong></div>
              <div className="cifra"><span className="suave chico">Sueldos por pagar</span><strong>{gs(d.sueldos.pendientes)}</strong></div>
              <div className="cifra"><span className="suave chico">Gastos fijos pagados</span><strong>{gs(d.gastosFijos.pagados)}</strong></div>
              <div className="cifra"><span className="suave chico">Gastos fijos por pagar</span><strong>{gs(d.gastosFijos.pendientes)}</strong></div>
            </div>
            <h2>Compras</h2>
            <p>Comprado {gs(d.compras.total)} · pagado a proveedores {gs(d.compras.pagado)} · deuda hoy {gs(d.compras.deudaTotal)}</p>
          </>
        )}
      </ConDatos>
    </>
  )
}
