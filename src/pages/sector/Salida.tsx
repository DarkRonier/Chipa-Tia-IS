import { useState } from 'react'
import Volver from '../../components/Volver'
import Numero from '../../components/Numero'
import { useSector } from '../../components/Layout'
import { SECTORES } from '../../mock/data'
import { nuevoId, stockDe, stockPorLote, useDatos } from '../../mock/store'

export default function Salida() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const conLotes = SECTORES.find((s) => s.id === sector)!.conLotes
  const productos = datos.productos.filter((p) => p.sector === sector && stockDe(datos.movimientos, sector, p.id) > 0)
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  const lotes = productoId && conLotes ? stockPorLote(datos.movimientos, sector, productoId) : []
  const disponible = productoId ? stockDe(datos.movimientos, sector, productoId, conLotes ? lote || undefined : undefined) : 0

  const guardar = () => {
    if (!productoId || cantidad <= 0) return setMsg({ ok: false, t: 'Elegí el producto y la cantidad.' })
    if (conLotes && !lote) return setMsg({ ok: false, t: 'Elegí de qué lote sale.' })
    if (cantidad > disponible) return setMsg({ ok: false, t: `Solo hay ${disponible} en stock.` })
    actualizar((d) => ({
      ...d,
      movimientos: [...d.movimientos, {
        id: nuevoId(), sector, productoId, lote: lote || undefined, tipo: 'salida_venta', cantidad: -cantidad,
        usuarioId: usuario!.id, fecha: new Date().toISOString(),
      }],
    }))
    setMsg({ ok: true, t: `Listo: salieron ${cantidad}. Quedan ${disponible - cantidad}.` })
    setCantidad(0)
  }

  return (
    <>
      <Volver titulo="Sacar para la venta" />
      <div className="tarjeta">
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => { setProductoId(e.target.value); setLote(''); setMsg(null) }}>
            <option value="">Elegí un producto</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({stockDe(datos.movimientos, sector, p.id)})</option>)}
          </select>
        </label>
        {conLotes && productoId && (
          <label className="campo">
            <span>Lote</span>
            <select value={lote} onChange={(e) => setLote(e.target.value)}>
              <option value="">Elegí un lote</option>
              {lotes.map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
            </select>
          </label>
        )}
        <Numero etiqueta={productoId ? `Cantidad (hay ${disponible})` : 'Cantidad'} valor={cantidad} onChange={setCantidad} />
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <button className="btn-primario" onClick={guardar}>Registrar salida</button>
      </div>
    </>
  )
}
