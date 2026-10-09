import { useState } from 'react'
import Volver from '../../components/Volver'
import { fechaHora, useDatos } from '../../mock/store'

export default function Trazabilidad() {
  const { datos, usuario } = useDatos()
  const [modo, setModo] = useState<'mp' | 'sucursal'>('mp')
  const [loteMP, setLoteMP] = useState(datos.lotesMP[0]?.id ?? '')
  const [sucursal, setSucursal] = useState(datos.sucursales[0]?.id ?? '')

  const nombreMP = (id: string) => {
    const l = datos.lotesMP.find((x) => x.id === id)
    return l ? `${l.insumo} · ${l.proveedor} ${l.fechaLote.slice(8)}/${l.fechaLote.slice(5, 7)}` : id
  }
  const nombreSuc = (id?: string) => datos.sucursales.find((s) => s.id === id)?.nombre ?? '—'
  const envios = datos.movimientos.filter((m) => m.tipo === 'envio' && m.lote)

  const lotesDeMP = datos.producciones.filter((p) => p.lote?.lotesMP.includes(loteMP))
  const enviosASucursal = envios.filter((m) => m.sucursalId === sucursal)

  return (
    <>
      <Volver titulo="Trazabilidad" a={usuario!.rol === 'admin' ? '/admin' : '/sector'} />
      <div className="segmentado">
        <button className={modo === 'mp' ? 'activo' : ''} onClick={() => setModo('mp')}>Desde materia prima</button>
        <button className={modo === 'sucursal' ? 'activo' : ''} onClick={() => setModo('sucursal')}>Desde sucursal</button>
      </div>
      {modo === 'mp' ? (
        <>
          <label className="campo">
            <span>Lote de materia prima</span>
            <select value={loteMP} onChange={(e) => setLoteMP(e.target.value)}>
              {datos.lotesMP.map((l) => <option key={l.id} value={l.id}>{nombreMP(l.id)}</option>)}
            </select>
          </label>
          {lotesDeMP.length === 0 && <p className="suave">Este lote todavía no se usó.</p>}
          {lotesDeMP.map((p) => (
            <div className="tarjeta" key={p.id}>
              <strong>Lote de chipa {p.lote!.codigo}</strong>
              <div className="suave chico">{fechaHora(p.fecha)} · {p.lote!.horno} al horno, {p.lote!.congelador} al congelador</div>
              <ul>
                {envios.filter((m) => m.lote === p.lote!.codigo).map((m) => (
                  <li key={m.id}>{fechaHora(m.fecha)}: {-m.cantidad} a {nombreSuc(m.sucursalId)}</li>
                ))}
                {envios.every((m) => m.lote !== p.lote!.codigo) && <li className="suave">Sin envíos todavía</li>}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <>
          <label className="campo">
            <span>Sucursal</span>
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          {enviosASucursal.length === 0 && <p className="suave">No hay envíos de chipa a esta sucursal.</p>}
          {enviosASucursal.map((m) => {
            const prod = datos.producciones.find((p) => p.lote?.codigo === m.lote)
            return (
              <div className="tarjeta" key={m.id}>
                <strong>{fechaHora(m.fecha)}: {-m.cantidad} del lote {m.lote}</strong>
                <div className="suave chico">Materia prima: {prod?.lote?.lotesMP.map(nombreMP).join(', ') ?? '—'}</div>
              </div>
            )
          })}
        </>
      )}
    </>
  )
}
