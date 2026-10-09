import { useState } from 'react'
import { SECTORES } from '../../mock/data'
import { diaPY, fechaHora, stockDe, useDatos } from '../../mock/store'

type Periodo = 'dia' | 'semana' | 'mes' | 'rango'

const sumarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function rangoDe(periodo: Periodo, hoy: string, desde: string, hasta: string): [string, string] {
  if (periodo === 'dia') return [hoy, hoy]
  if (periodo === 'semana') {
    const dow = (new Date(`${hoy}T12:00:00Z`).getUTCDay() + 6) % 7
    return [sumarDias(hoy, -dow), hoy]
  }
  if (periodo === 'mes') return [`${hoy.slice(0, 8)}01`, hoy]
  return [desde || hoy, hasta || hoy]
}

function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export default function Resumen() {
  const { datos } = useDatos()
  const hoy = diaPY(new Date().toISOString())
  const [periodo, setPeriodo] = useState<Periodo>('dia')
  const [desde, setDesde] = useState(sumarDias(hoy, -7))
  const [hasta, setHasta] = useState(hoy)
  const [ini, fin] = rangoDe(periodo, hoy, desde, hasta)
  const enRango = (iso: string) => diaPY(iso) >= ini && diaPY(iso) <= fin

  const nombre = (id: string) => datos.productos.find((p) => p.id === id)?.nombre ?? id
  const producciones = datos.producciones.filter((p) => enRango(p.fecha))
  const porProducto = new Map<string, { sector: string; cocinado: number; guardado: number }>()
  for (const p of producciones) {
    for (const i of p.items) {
      const v = porProducto.get(i.productoId) ?? { sector: p.sector, cocinado: 0, guardado: 0 }
      v.cocinado += i.cocinado
      v.guardado += i.guardado
      porProducto.set(i.productoId, v)
    }
  }
  const envios = datos.movimientos.filter((m) => m.tipo === 'envio' && enRango(m.fecha))
  const porSucursal = datos.sucursales.map((s) => ({ s, total: envios.filter((m) => m.sucursalId === s.id).reduce((a, m) => a - m.cantidad, 0) }))
  const fuera = datos.lecturas.filter((l) => l.fueraDeRango && enRango(l.fecha))
  const limpiezas = datos.limpiezas.filter((l) => enRango(l.fecha))
  const lotes = producciones.filter((p) => p.lote)
  const stockPorSector = SECTORES.map((s) => ({
    s, total: datos.productos.filter((p) => p.sector === s.id).reduce((a, p) => a + stockDe(datos.movimientos, s.id, p.id), 0),
  }))

  const exportar = () =>
    descargarCSV(`reporte-${ini}-a-${fin}.csv`, [
      ['Reporte Chipa Tía', `${ini} a ${fin}`],
      [],
      ['Sector', 'Producto', 'Cocinado / horno', 'Guardado / congelador'],
      ...[...porProducto].map(([id, v]) => [SECTORES.find((s) => s.id === v.sector)!.nombre, nombre(id), v.cocinado, v.guardado]),
      [],
      ['Sucursal', 'Unidades enviadas'],
      ...porSucursal.map(({ s, total }) => [s.nombre, total]),
      [],
      ['Temperaturas fuera de rango', 'Máquina', 'Temperatura'],
      ...fuera.map((l) => [fechaHora(l.fecha), datos.maquinas.find((m) => m.id === l.maquinaId)?.nombre ?? '', l.temperatura ?? '']),
    ])

  return (
    <>
      <h1>Resumen</h1>
      <div className="segmentado">
        {(['dia', 'semana', 'mes', 'rango'] as Periodo[]).map((p) => (
          <button key={p} className={periodo === p ? 'activo' : ''} onClick={() => setPeriodo(p)}>
            {{ dia: 'Hoy', semana: 'Semana', mes: 'Mes', rango: 'Rango' }[p]}
          </button>
        ))}
      </div>
      {periodo === 'rango' && (
        <div className="filtros">
          <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      )}
      <p className="suave">Del {ini.split('-').reverse().join('/')} al {fin.split('-').reverse().join('/')} · hora de Paraguay</p>

      <div className="cifras">
        <div className="cifra"><strong>{producciones.length}</strong><span>cargas de producción</span></div>
        <div className="cifra"><strong>{envios.reduce((a, m) => a - m.cantidad, 0)}</strong><span>unidades enviadas</span></div>
        <div className={fuera.length ? 'cifra alerta' : 'cifra'}><strong>{fuera.length}</strong><span>temperaturas fuera de rango</span></div>
        <div className="cifra"><strong>{limpiezas.length}</strong><span>limpiezas ({limpiezas.filter((l) => !l.controladoPor).length} sin controlar)</span></div>
      </div>

      <h2>Producción por producto</h2>
      {porProducto.size === 0 ? <p className="suave">Sin producción en el período.</p> : (
        <table className="tabla">
          <thead><tr><th>Producto</th><th className="num">Cocinado</th><th className="num">Guardado</th></tr></thead>
          <tbody>
            {[...porProducto].map(([id, v]) => (
              <tr key={id}><td>{nombre(id)}<div className="suave chico">{SECTORES.find((s) => s.id === v.sector)!.nombre}</div></td><td className="num">{v.cocinado}</td><td className="num">{v.guardado}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Stock en frío actual</h2>
      <table className="tabla">
        <tbody>{stockPorSector.map(({ s, total }) => <tr key={s.id}><td>{s.nombre}</td><td className="num">{total}</td></tr>)}</tbody>
      </table>

      <h2>Envíos por sucursal</h2>
      <table className="tabla">
        <tbody>{porSucursal.map(({ s, total }) => <tr key={s.id}><td>{s.nombre}</td><td className="num">{total}</td></tr>)}</tbody>
      </table>

      <h2>Lotes de Chipería</h2>
      {lotes.length === 0 ? <p className="suave">Sin lotes en el período.</p> : (
        <ul>{lotes.map((p) => <li key={p.id}>{p.lote!.codigo}: {p.lote!.horno} al horno, {p.lote!.congelador} al congelador</li>)}</ul>
      )}

      <h2>Temperaturas fuera de rango</h2>
      {fuera.length === 0 ? <p className="suave">Ninguna.</p> : (
        <table className="tabla">
          <tbody>
            {fuera.map((l) => {
              const m = datos.maquinas.find((x) => x.id === l.maquinaId)!
              return <tr key={l.id} className="fila-roja"><td>{fechaHora(l.fecha)}</td><td>{m.nombre}<div className="suave chico">{SECTORES.find((s) => s.id === m.sector)!.nombre}</div></td><td className="num">{l.temperatura} °C</td></tr>
            })}
          </tbody>
        </table>
      )}

      <div className="fila-acciones">
        <button className="btn-secundario" onClick={exportar}>Exportar a Excel</button>
        <span className="suave chico">En el prototipo se descarga un CSV que abre en Excel; la versión final genera .xlsx.</span>
      </div>
    </>
  )
}
