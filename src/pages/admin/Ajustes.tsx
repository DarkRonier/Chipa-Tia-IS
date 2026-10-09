import { useState } from 'react'
import Numero from '../../components/Numero'
import { useSector } from '../../components/Layout'
import { SECTORES } from '../../mock/data'
import { nuevoId, stockDe, stockPorLote, useDatos, type TipoMovimiento } from '../../mock/store'
import { TablaStock } from '../sector/Stock'
import { NOMBRE_TIPO } from '../sector/Historial'

const TIPOS: TipoMovimiento[] = ['merma', 'vencimiento', 'ajuste', 'stock_inicial']

export default function Ajustes() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const conLotes = SECTORES.find((s) => s.id === sector)!.conLotes
  const [tipo, setTipo] = useState<TipoMovimiento>('merma')
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [sentido, setSentido] = useState<1 | -1>(-1)
  const [motivo, setMotivo] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  // Merma y vencimiento siempre restan; stock inicial suma; un ajuste puede ir en los dos sentidos.
  const signo = tipo === 'stock_inicial' ? 1 : tipo === 'ajuste' ? sentido : -1
  const disponible = productoId ? stockDe(datos.movimientos, sector, productoId, conLotes && lote ? lote : undefined) : 0

  const guardar = () => {
    if (!productoId || cantidad <= 0) return setMsg({ ok: false, t: 'Elegí producto y cantidad.' })
    if (!motivo.trim() && tipo !== 'stock_inicial') return setMsg({ ok: false, t: 'El motivo es obligatorio.' })
    if (signo < 0 && cantidad > disponible) return setMsg({ ok: false, t: `Solo hay ${disponible} en stock.` })
    actualizar((d) => ({
      ...d,
      movimientos: [...d.movimientos, {
        id: nuevoId(), sector, productoId, lote: lote || undefined, tipo, cantidad: signo * cantidad,
        motivo: motivo.trim() || undefined, usuarioId: usuario!.id, fecha: new Date().toISOString(),
      }],
    }))
    setMsg({ ok: true, t: `${NOMBRE_TIPO[tipo]} registrado.` })
    setCantidad(0); setMotivo('')
  }

  return (
    <>
      <h1>Stock en frío · {SECTORES.find((s) => s.id === sector)!.nombre}</h1>
      <TablaStock />
      <h2>Registrar merma, vencimiento o ajuste</h2>
      <div className="tarjeta">
        <div className="segmentado">
          {TIPOS.map((t) => <button key={t} className={tipo === t ? 'activo' : ''} onClick={() => setTipo(t)}>{NOMBRE_TIPO[t]}</button>)}
        </div>
        {tipo === 'ajuste' && (
          <div className="segmentado">
            <button className={sentido === 1 ? 'activo' : ''} onClick={() => setSentido(1)}>Sumar</button>
            <button className={sentido === -1 ? 'activo' : ''} onClick={() => setSentido(-1)}>Restar</button>
          </div>
        )}
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => { setProductoId(e.target.value); setLote('') }}>
            <option value="">Elegí un producto</option>
            {datos.productos.filter((p) => p.sector === sector).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({stockDe(datos.movimientos, sector, p.id)})</option>)}
          </select>
        </label>
        {conLotes && productoId && (
          <label className="campo">
            <span>Lote {tipo === 'stock_inicial' ? '(escribí el código)' : ''}</span>
            {tipo === 'stock_inicial' ? (
              <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ej.: CH-261001-1" />
            ) : (
              <select value={lote} onChange={(e) => setLote(e.target.value)}>
                <option value="">Elegí un lote</option>
                {stockPorLote(datos.movimientos, sector, productoId).map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
              </select>
            )}
          </label>
        )}
        <Numero etiqueta="Cantidad" valor={cantidad} onChange={setCantidad} />
        <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'stock_inicial' ? 'Opcional' : 'Ej.: se rompió la bolsa'} /></label>
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <button className="btn-primario" onClick={guardar}>Guardar</button>
      </div>
    </>
  )
}
