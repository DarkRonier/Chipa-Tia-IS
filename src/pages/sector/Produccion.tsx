import { useState } from 'react'
import Volver from '../../components/Volver'
import Numero from '../../components/Numero'
import { useSector } from '../../components/Layout'
import { SECTORES } from '../../mock/data'
import { diaPY, fechaHora, nuevoId, useDatos, type Movimiento, type Produccion as Prod, type Turno } from '../../mock/store'

const turnoPorHora = (): Turno => {
  const h = Number(new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', hour: 'numeric', hour12: false }).format(new Date()))
  return h >= 5 && h < 15 ? 'dia' : 'noche'
}

export default function Produccion() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const conLotes = SECTORES.find((s) => s.id === sector)!.conLotes
  const productos = datos.productos.filter((p) => p.sector === sector && p.activo)
  const hoy = diaPY(new Date().toISOString())
  const lotesDisponibles = datos.lotesMP.filter((l) => !l.bloqueado && l.vencimiento >= hoy)

  const [turno, setTurno] = useState<Turno>(turnoPorHora)
  const [cant, setCant] = useState<Record<string, { cocinado: number; guardado: number }>>({})
  const [lotesMP, setLotesMP] = useState<string[]>([])
  const [listo, setListo] = useState<Prod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')

  const amasadasHoy = datos.producciones.filter((p) => p.sector === sector && p.lote && diaPY(p.fecha) === hoy).length
  const setValor = (id: string, campo: 'cocinado' | 'guardado', n: number) =>
    setCant((c) => ({ ...c, [id]: { ...(c[id] ?? { cocinado: 0, guardado: 0 }), [campo]: n } }))

  const guardar = () => {
    const items = Object.entries(cant)
      .filter(([, v]) => v.cocinado + v.guardado > 0)
      .map(([productoId, v]) => ({ productoId, ...v }))
    if (items.length === 0) return setError('Cargá al menos una cantidad.')
    if (conLotes && !(['Queso', 'Almidón'] as const).every((ins) => lotesMP.some((id) => datos.lotesMP.find((l) => l.id === id)?.insumo === ins)))
      return setError('Elegí el lote de queso y el de almidón usados.')
    const ahora = new Date().toISOString()
    const amasada = amasadasHoy + 1
    const lote = conLotes
      ? {
          codigo: `CH-${hoy.slice(2).replaceAll('-', '')}-${amasada}`,
          amasada,
          lotesMP,
          horno: items.reduce((s, i) => s + i.cocinado, 0),
          congelador: items.reduce((s, i) => s + i.guardado, 0),
        }
      : undefined
    const prod: Prod = { id: nuevoId(), sector, usuarioId: usuario!.id, fecha: ahora, turno, items, lote }
    const movs: Movimiento[] = items
      .filter((i) => i.guardado > 0)
      .map((i) => ({
        id: nuevoId(), sector, productoId: i.productoId, lote: lote?.codigo, tipo: 'produccion',
        cantidad: i.guardado, usuarioId: usuario!.id, fecha: ahora,
      }))
    actualizar((d) => ({ ...d, producciones: [...d.producciones, prod], movimientos: [...d.movimientos, ...movs] }))
    setListo(prod)
    setCant({})
    setLotesMP([])
    setError(null)
  }

  const nombre = (id: string) => datos.productos.find((p) => p.id === id)?.nombre ?? id
  const [cocLabel, guaLabel] = conLotes ? ['Al horno', 'Al congelador'] : ['Cocinado', 'Guardado en frío']

  return (
    <>
      <Volver titulo="Registrar producción" />
      {listo && (
        <div className="ok">
          Guardado {fechaHora(listo.fecha)} por {usuario!.nombre}
          {listo.lote && <> · Lote <strong>{listo.lote.codigo}</strong></>}
          <ul>{listo.items.map((i) => <li key={i.productoId}>{nombre(i.productoId)}: {i.cocinado} {cocLabel.toLowerCase()}, {i.guardado} {guaLabel.toLowerCase()}</li>)}</ul>
        </div>
      )}
      <div className="tarjeta">
        <div className="segmentado" role="group" aria-label="Turno">
          <button className={turno === 'dia' ? 'activo' : ''} onClick={() => setTurno('dia')}>Turno día</button>
          <button className={turno === 'noche' ? 'activo' : ''} onClick={() => setTurno('noche')}>Turno noche</button>
        </div>
        {conLotes && (
          <div className="campo">
            <span>Lotes de materia prima usados · amasada N° {amasadasHoy + 1} de hoy</span>
            <div className="chips">
              {lotesDisponibles.map((l) => (
                <button
                  key={l.id}
                  className={lotesMP.includes(l.id) ? 'chip activo' : 'chip'}
                  onClick={() => setLotesMP((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))}
                >
                  {l.insumo} · {l.proveedor} {l.fechaLote.slice(8)}/{l.fechaLote.slice(5, 7)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="suave">Escribí cuánto se hizo de cada producto. Lo que dejes vacío no se registra.</p>
      {productos.length > 10 && (
        <input className="buscar" placeholder="Buscar producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      )}
      <div className="lista-productos">
        {productos.filter((p) => p.nombre.toLowerCase().includes(buscar.trim().toLowerCase()) || (cant[p.id]?.cocinado ?? 0) + (cant[p.id]?.guardado ?? 0) > 0).map((p) => (
          <div key={p.id} className={(cant[p.id]?.cocinado ?? 0) + (cant[p.id]?.guardado ?? 0) > 0 ? 'fila-producto con-valor' : 'fila-producto'}>
            <span className="nombre">{p.nombre}</span>
            <Numero etiqueta={cocLabel} valor={cant[p.id]?.cocinado ?? 0} onChange={(n) => setValor(p.id, 'cocinado', n)} />
            <Numero etiqueta={guaLabel} valor={cant[p.id]?.guardado ?? 0} onChange={(n) => setValor(p.id, 'guardado', n)} />
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="accion-fija">
        <button className="btn-primario" onClick={guardar}>Guardar producción</button>
      </div>
    </>
  )
}
