import { useState } from 'react'
import { useSector } from '../../components/Layout'
import { fechaHora, nuevoId, useDatos, type Produccion } from '../../mock/store'

export default function Registros() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const [editando, setEditando] = useState<Produccion | null>(null)
  const lista = datos.producciones.filter((p) => p.sector === sector).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const nombre = (id: string) => datos.productos.find((p) => p.id === id)?.nombre ?? id
  const quien = (id: string) => datos.usuarios.find((u) => u.id === id)?.nombre ?? id

  const guardar = () => {
    const original = datos.producciones.find((p) => p.id === editando!.id)!
    const ahora = new Date().toISOString()
    const corregido = { ...editando!, corregido: { usuarioId: usuario!.id, fecha: ahora } }
    // La diferencia en lo guardado se refleja en el stock como un ajuste.
    const ajustes = editando!.items
      .map((i) => ({ i, dif: i.guardado - (original.items.find((o) => o.productoId === i.productoId)?.guardado ?? 0) }))
      .filter(({ dif }) => dif !== 0)
      .map(({ i, dif }) => ({
        id: nuevoId(), sector, productoId: i.productoId, lote: original.lote?.codigo, tipo: 'ajuste' as const, cantidad: dif,
        motivo: 'Corrección de un registro de producción', usuarioId: usuario!.id, fecha: ahora,
      }))
    actualizar((d) => ({
      ...d,
      producciones: d.producciones.map((p) => (p.id === corregido.id ? corregido : p)),
      movimientos: [...d.movimientos, ...ajustes],
      auditoria: [...d.auditoria, {
        id: nuevoId(), tabla: 'producciones', registroId: corregido.id, usuarioId: usuario!.id, fecha: ahora,
        antes: JSON.stringify(original.items), despues: JSON.stringify(corregido.items),
      }],
    }))
    setEditando(null)
  }

  return (
    <>
      <h1>Registros de producción</h1>
      {lista.length === 0 && <p className="suave">Este sector no tiene registros.</p>}
      {lista.map((p) => (
        <div className="tarjeta" key={p.id}>
          <div className="fila-acciones">
            <strong>{fechaHora(p.fecha)} · turno {p.turno === 'dia' ? 'día' : 'noche'}</strong>
            <span className="suave chico">{quien(p.usuarioId)}</span>
            {p.lote && <span className="chip">{p.lote.codigo}</span>}
            {editando?.id !== p.id && <button className="btn-texto" onClick={() => setEditando(structuredClone(p))}>Corregir</button>}
          </div>
          {p.corregido && <p className="suave chico">Corregido por {quien(p.corregido.usuarioId)} el {fechaHora(p.corregido.fecha)}</p>}
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num">Cocinado</th><th className="num">Guardado</th></tr></thead>
            <tbody>
              {(editando?.id === p.id ? editando : p).items.map((i, idx) => (
                <tr key={i.productoId}>
                  <td>{nombre(i.productoId)}</td>
                  {editando?.id === p.id ? (
                    <>
                      {(['cocinado', 'guardado'] as const).map((campo) => (
                        <td className="num" key={campo}>
                          <input className="nro" type="number" value={i[campo]} onChange={(e) => {
                            const items = editando.items.map((x, j) => (j === idx ? { ...x, [campo]: Math.max(0, Number(e.target.value) || 0) } : x))
                            setEditando({ ...editando, items })
                          }} />
                        </td>
                      ))}
                    </>
                  ) : (
                    <><td className="num">{i.cocinado}</td><td className="num">{i.guardado}</td></>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {editando?.id === p.id && (
            <div className="fila-acciones">
              <button className="btn-primario" onClick={guardar}>Guardar corrección</button>
              <button className="btn-texto" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
