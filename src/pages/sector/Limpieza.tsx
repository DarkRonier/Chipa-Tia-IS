import { useState } from 'react'
import Volver from '../../components/Volver'
import { useSector } from '../../components/Layout'
import { fechaHora, nuevoId, useDatos, type Marca } from '../../mock/store'

export const MARCAS: { m: Marca; t: string }[] = [
  { m: 'X', t: 'Diaria' },
  { m: 'XX', t: 'Profunda' },
  { m: '-', t: 'No se hizo' },
]

export default function Limpieza() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const areas = datos.areas.filter((a) => a.sectores.includes(sector))
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '')
  const [marcas, setMarcas] = useState<Record<string, Marca>>({})
  const [numeros, setNumeros] = useState<Record<string, string>>({})
  const [comentario, setComentario] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const area = areas.find((a) => a.id === areaId)

  const cambiarArea = (id: string) => { setAreaId(id); setMarcas({}); setNumeros({}); setMsg(null) }
  const todas = (m: Marca) => setMarcas(Object.fromEntries(area!.items.map((i) => [i.id, m])))

  const guardar = () => {
    const faltan = area!.items.filter((i) => !marcas[i.id]).length
    // La planilla en papel pide no dejar cuadros en blanco.
    if (faltan > 0) return setMsg({ ok: false, t: `Faltan ${faltan} ítems por marcar.` })
    actualizar((d) => ({
      ...d,
      limpiezas: [...d.limpiezas, {
        id: nuevoId(), areaId, sector, usuarioId: usuario!.id, fecha: new Date().toISOString(),
        marcas, numeros, comentario: comentario.trim(),
      }],
    }))
    setMsg({ ok: true, t: `Limpieza de ${area!.nombre} registrada.` })
    setMarcas({}); setNumeros({}); setComentario('')
  }

  const historial = datos.limpiezas.filter((l) => l.sector === sector).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10)

  return (
    <>
      <Volver titulo="Limpieza y desinfección" />
      <div className="chips">
        {areas.map((a) => (
          <button key={a.id} className={a.id === areaId ? 'chip activo' : 'chip'} onClick={() => cambiarArea(a.id)}>{a.nombre}</button>
        ))}
      </div>
      {area && (
        <>
          <div className="fila-acciones">
            <span className="suave chico">{area.codigo} · marcar todo:</span>
            {MARCAS.map(({ m, t }) => <button key={m} className="btn-texto" onClick={() => todas(m)}>{t}</button>)}
          </div>
          <div className="lista-limpieza">
            {area.items.map((i) => (
              <div key={i.id} className="fila-limpieza">
                <span>{i.nombre}</span>
                <div className="segmentado chico">
                  {MARCAS.map(({ m, t }) => (
                    <button key={m} className={marcas[i.id] === m ? `activo marca-${m === '-' ? 'no' : m}` : ''} onClick={() => setMarcas((s) => ({ ...s, [i.id]: m }))}>{t}</button>
                  ))}
                </div>
                {i.pideNumero && marcas[i.id] && marcas[i.id] !== '-' && (
                  <input className="nro" placeholder="N° de equipo" value={numeros[i.id] ?? ''} onChange={(e) => setNumeros((s) => ({ ...s, [i.id]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
          <label className="campo"><span>Comentario (opcional)</span><textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} /></label>
          {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
          <div className="accion-fija"><button className="btn-primario" onClick={guardar}>Guardar limpieza</button></div>
        </>
      )}
      <h2>Últimos reportes</h2>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Área</th><th>Controlado</th></tr></thead>
        <tbody>
          {historial.map((l) => (
            <tr key={l.id}>
              <td>{fechaHora(l.fecha)}</td>
              <td>{datos.areas.find((a) => a.id === l.areaId)?.nombre}</td>
              <td>{l.controladoPor ? `Sí, ${fechaHora(l.controladoPor.fecha)}` : <span className="suave">Pendiente</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
