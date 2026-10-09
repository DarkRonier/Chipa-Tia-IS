import { useState } from 'react'
import Volver from '../../components/Volver'
import { diaPY, fechaHora, nuevoId, useDatos } from '../../mock/store'
import type { LoteMP } from '../../mock/data'

export default function Lotes() {
  const { datos, actualizar, usuario } = useDatos()
  const esAdmin = usuario!.rol === 'admin'
  const hoy = diaPY(new Date().toISOString())
  const [nuevo, setNuevo] = useState({ insumo: 'Queso' as LoteMP['insumo'], proveedor: '', fechaLote: hoy, vencimiento: '', cantidadKg: 0 })
  const [error, setError] = useState<string | null>(null)

  const agregar = () => {
    if (!nuevo.proveedor.trim() || !nuevo.vencimiento || nuevo.cantidadKg <= 0) return setError('Completá proveedor, cantidad y vencimiento.')
    actualizar((d) => ({ ...d, lotesMP: [...d.lotesMP, { id: nuevoId(), ...nuevo, proveedor: nuevo.proveedor.trim(), bloqueado: false }] }))
    setNuevo({ ...nuevo, proveedor: '', cantidadKg: 0, vencimiento: '' })
    setError(null)
  }
  const bloquear = (id: string) =>
    actualizar((d) => ({ ...d, lotesMP: d.lotesMP.map((l) => (l.id === id ? { ...l, bloqueado: !l.bloqueado } : l)) }))

  const lotesChipa = datos.producciones.filter((p) => p.lote).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const stockLote = (codigo: string) => datos.movimientos.filter((m) => m.lote === codigo).reduce((s, m) => s + m.cantidad, 0)

  return (
    <>
      <Volver titulo="Materia prima y lotes" a={esAdmin ? '/admin' : '/sector'} />
      <h2>Ingresar materia prima</h2>
      <div className="tarjeta filtros">
        <label className="campo">
          <span>Insumo</span>
          <select value={nuevo.insumo} onChange={(e) => setNuevo({ ...nuevo, insumo: e.target.value as LoteMP['insumo'] })}>
            <option>Queso</option><option>Almidón</option>
          </select>
        </label>
        <label className="campo"><span>Proveedor</span><input value={nuevo.proveedor} onChange={(e) => setNuevo({ ...nuevo, proveedor: e.target.value })} placeholder="Ej.: Codipsa" /></label>
        <label className="campo"><span>Fecha del lote</span><input type="date" value={nuevo.fechaLote} onChange={(e) => setNuevo({ ...nuevo, fechaLote: e.target.value })} /></label>
        <label className="campo"><span>Vencimiento</span><input type="date" value={nuevo.vencimiento} onChange={(e) => setNuevo({ ...nuevo, vencimiento: e.target.value })} /></label>
        <label className="campo"><span>Cantidad (kg)</span><input type="number" inputMode="decimal" value={nuevo.cantidadKg || ''} onChange={(e) => setNuevo({ ...nuevo, cantidadKg: Number(e.target.value) || 0 })} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primario" onClick={agregar}>Agregar lote</button>
      </div>
      <h2>Lotes de materia prima</h2>
      <table className="tabla">
        <thead><tr><th>Lote</th><th>Vence</th><th>Estado</th></tr></thead>
        <tbody>
          {datos.lotesMP.map((l) => {
            const vencido = l.vencimiento < hoy
            return (
              <tr key={l.id} className={vencido || l.bloqueado ? 'apagado' : ''}>
                <td>{l.insumo} · {l.proveedor} {l.fechaLote.slice(8)}/{l.fechaLote.slice(5, 7)}<div className="suave chico">{l.cantidadKg} kg</div></td>
                <td>{l.vencimiento.split('-').reverse().join('/')}</td>
                <td>
                  {vencido ? 'Vencido' : l.bloqueado ? 'Bloqueado' : 'Disponible'}
                  {esAdmin && !vencido && (
                    <div><button className="btn-texto" onClick={() => bloquear(l.id)}>{l.bloqueado ? 'Desbloquear' : 'Bloquear'}</button></div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <h2>Lotes de chipa</h2>
      <table className="tabla">
        <thead><tr><th>Lote</th><th className="num">Horno</th><th className="num">Congelador</th><th className="num">Queda</th></tr></thead>
        <tbody>
          {lotesChipa.map((p) => (
            <tr key={p.id}>
              <td>{p.lote!.codigo}<div className="suave chico">{fechaHora(p.fecha)} · amasada {p.lote!.amasada}</div></td>
              <td className="num">{p.lote!.horno}</td>
              <td className="num">{p.lote!.congelador}</td>
              <td className="num">{stockLote(p.lote!.codigo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
