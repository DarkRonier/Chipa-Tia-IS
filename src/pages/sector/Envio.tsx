import { useState } from 'react'
import Volver from '../../components/Volver'
import Numero from '../../components/Numero'
import { useSector } from '../../components/Layout'
import { SECTORES } from '../../mock/data'
import { nuevoId, stockDe, stockPorLote, useDatos, type Movimiento } from '../../mock/store'

interface Linea { productoId: string; lote: string; cantidad: number }

export default function Envio() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const conLotes = SECTORES.find((s) => s.id === sector)!.conLotes
  const productos = datos.productos.filter((p) => p.sector === sector && stockDe(datos.movimientos, sector, p.id) > 0)
  const [sucursalId, setSucursalId] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([{ productoId: '', lote: '', cantidad: 0 }])
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  const cambiar = (i: number, cambio: Partial<Linea>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)))

  const disponible = (l: Linea) =>
    l.productoId ? stockDe(datos.movimientos, sector, l.productoId, conLotes ? l.lote || undefined : undefined) : 0

  const guardar = () => {
    const validas = lineas.filter((l) => l.productoId && l.cantidad > 0)
    if (!sucursalId) return setMsg({ ok: false, t: 'Elegí la sucursal.' })
    if (validas.length === 0) return setMsg({ ok: false, t: 'Cargá al menos un producto.' })
    for (const l of validas) {
      const nombre = datos.productos.find((p) => p.id === l.productoId)!.nombre
      if (conLotes && !l.lote) return setMsg({ ok: false, t: `Elegí el lote de ${nombre}.` })
      if (l.cantidad > disponible(l)) return setMsg({ ok: false, t: `No alcanza ${nombre}: hay ${disponible(l)}.` })
    }
    const envioId = nuevoId()
    const fecha = new Date().toISOString()
    const movs: Movimiento[] = validas.map((l) => ({
      id: nuevoId(), sector, productoId: l.productoId, lote: l.lote || undefined, tipo: 'envio',
      cantidad: -l.cantidad, sucursalId, envioId, usuarioId: usuario!.id, fecha,
    }))
    actualizar((d) => ({ ...d, movimientos: [...d.movimientos, ...movs] }))
    const suc = datos.sucursales.find((s) => s.id === sucursalId)!.nombre
    setMsg({ ok: true, t: `Envío a ${suc} registrado con ${validas.length} producto(s).` })
    setLineas([{ productoId: '', lote: '', cantidad: 0 }])
  }

  return (
    <>
      <Volver titulo="Envío a sucursal" />
      <div className="tarjeta">
        <label className="campo">
          <span>Sucursal</span>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            <option value="">Elegí la sucursal</option>
            {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
      </div>
      {lineas.map((l, i) => (
        <div className="tarjeta" key={i}>
          <label className="campo">
            <span>Producto {i + 1}</span>
            <select value={l.productoId} onChange={(e) => cambiar(i, { productoId: e.target.value, lote: '' })}>
              <option value="">Elegí un producto</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          {conLotes && l.productoId && (
            <label className="campo">
              <span>Lote</span>
              <select value={l.lote} onChange={(e) => cambiar(i, { lote: e.target.value })}>
                <option value="">Elegí un lote</option>
                {stockPorLote(datos.movimientos, sector, l.productoId).map(([lt, n]) => <option key={lt} value={lt}>{lt} ({n})</option>)}
              </select>
            </label>
          )}
          <Numero etiqueta={l.productoId ? `Cantidad (hay ${disponible(l)})` : 'Cantidad'} valor={l.cantidad} onChange={(n) => cambiar(i, { cantidad: n })} />
        </div>
      ))}
      <button className="btn-secundario" onClick={() => setLineas((ls) => [...ls, { productoId: '', lote: '', cantidad: 0 }])}>
        + Agregar otro producto
      </button>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      <div className="accion-fija">
        <button className="btn-primario" onClick={guardar}>Registrar envío</button>
      </div>
    </>
  )
}
