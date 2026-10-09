import { useState } from 'react'
import Volver from '../../components/Volver'
import { useSector } from '../../components/Layout'
import { fechaHora, fueraDeRango, nuevoId, textoRango, useDatos, type EstadoMaquina, type Lectura, type Momento } from '../../mock/store'

const ESTADOS: Record<EstadoMaquina, string> = {
  funciona: 'Funciona', con_fallas: 'Con fallas', fuera_de_servicio: 'Fuera de servicio',
}
const MOMENTOS: Record<Momento, string> = {
  inicio: 'Inicio de jornada', fin: 'Fin de jornada', inicial: 'T° inicial (buffet)', intermedia: 'T° intermedia (buffet)', otro: 'Otro momento',
}

// Achica la foto antes de subirla (F03): lado mayor de 1024 px, JPEG.
function achicar(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const escala = Math.min(1, 1024 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * escala)
      canvas.height = Math.round(img.height * escala)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(archivo)
  })
}

export default function Maquinas() {
  const { datos, actualizar, usuario } = useDatos()
  const sector = useSector()
  const maquinas = datos.maquinas.filter((m) => m.sector === sector)
  const [maquinaId, setMaquinaId] = useState<string | null>(null)
  const [momento, setMomento] = useState<Momento>('inicio')
  const [estado, setEstado] = useState<EstadoMaquina>('funciona')
  const [temp, setTemp] = useState('')
  const [obs, setObs] = useState('')
  const [mant, setMant] = useState(false)
  const [mantDesc, setMantDesc] = useState('')
  const [mantPor, setMantPor] = useState('')
  const [foto, setFoto] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)

  const maquina = maquinas.find((m) => m.id === maquinaId)
  const ultima = (id: string) => datos.lecturas.filter((l) => l.maquinaId === id).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]

  if (!maquina) {
    return (
      <>
        <Volver titulo="Máquinas y temperatura" />
        <div className="lista">
          {maquinas.map((m) => {
            const u = ultima(m.id)
            return (
              <button key={m.id} className={u?.fueraDeRango ? 'item alerta' : 'item'} onClick={() => setMaquinaId(m.id)}>
                <strong>N° {m.numero} · {m.nombre}</strong>
                <span className="suave">Rango: {textoRango(m)}</span>
                <span className="suave">
                  {u ? `Última: ${fechaHora(u.fecha)}${u.temperatura !== null ? ` · ${u.temperatura} °C` : ''} · ${ESTADOS[u.estado]}` : 'Sin lecturas'}
                </span>
              </button>
            )
          })}
        </div>
      </>
    )
  }

  const pideTemp = maquina.tempMin !== null || maquina.tempMax !== null
  const t = temp === '' ? null : Number(temp)
  const fuera = fueraDeRango(maquina, t)
  const historial = datos.lecturas.filter((l) => l.maquinaId === maquina.id).sort((a, b) => b.fecha.localeCompare(a.fecha))

  const guardar = () => {
    if (pideTemp && t === null) return setError('La temperatura es obligatoria en esta máquina.')
    if (mant && !mantDesc.trim()) return setError('Describí el mantenimiento realizado.')
    const l: Lectura = {
      id: nuevoId(), maquinaId: maquina.id, usuarioId: usuario!.id, fecha: new Date().toISOString(),
      momento, estado, temperatura: t, fueraDeRango: fuera, observacion: obs.trim(),
      mantenimiento: mant ? { descripcion: mantDesc.trim(), realizadoPor: mantPor.trim() } : undefined, foto,
    }
    actualizar((d) => ({ ...d, lecturas: [...d.lecturas, l] }))
    setTemp(''); setObs(''); setMant(false); setMantDesc(''); setMantPor(''); setFoto(undefined); setError(null)
  }

  return (
    <>
      <div className="titulo">
        <button className="volver" onClick={() => setMaquinaId(null)} aria-label="Volver">‹</button>
        <h1>N° {maquina.numero} · {maquina.nombre}</h1>
      </div>
      <div className="tarjeta">
        <p className="suave">Rango aceptable: {textoRango(maquina)}</p>
        {pideTemp && (
          <label className="campo">
            <span>Momento de la lectura</span>
            <select value={momento} onChange={(e) => setMomento(e.target.value as Momento)}>
              {Object.entries(MOMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        <div className="campo">
          <span>Estado</span>
          <div className="segmentado">
            {(Object.keys(ESTADOS) as EstadoMaquina[]).map((e) => (
              <button key={e} className={estado === e ? 'activo' : ''} onClick={() => setEstado(e)}>{ESTADOS[e]}</button>
            ))}
          </div>
        </div>
        {pideTemp && (
          <label className="campo">
            <span>Temperatura actual (°C) · obligatoria</span>
            <input type="number" inputMode="decimal" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} className={fuera ? 'rojo' : ''} />
            {fuera && <span className="error">Fuera de rango: el reporte queda marcado en rojo.</span>}
          </label>
        )}
        <label className="campo">
          <span>Observación</span>
          <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={mant} onChange={(e) => setMant(e.target.checked)} /> Se hizo mantenimiento
        </label>
        {mant && (
          <>
            <label className="campo"><span>Qué se hizo</span><textarea rows={2} value={mantDesc} onChange={(e) => setMantDesc(e.target.value)} placeholder="Limpieza, cambio de partes, verificación..." /></label>
            <label className="campo"><span>Lo hizo (empresa o persona)</span><input value={mantPor} onChange={(e) => setMantPor(e.target.value)} /></label>
          </>
        )}
        <label className="campo">
          <span>Foto (opcional)</span>
          <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFoto(await achicar(f)) }} />
        </label>
        {foto && <img src={foto} alt="Foto adjunta" className="foto" />}
        {error && <p className="error">{error}</p>}
        <button className="btn-primario" onClick={guardar}>Guardar reporte</button>
      </div>
      <h2>Historial</h2>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>T°</th><th>Estado y observación</th></tr></thead>
        <tbody>
          {historial.map((l) => (
            <tr key={l.id} className={l.fueraDeRango ? 'fila-roja' : ''}>
              <td>{fechaHora(l.fecha)}<div className="suave chico">{datos.usuarios.find((u) => u.id === l.usuarioId)?.nombre}</div></td>
              <td>{l.temperatura ?? '—'}</td>
              <td>
                {ESTADOS[l.estado]} · {MOMENTOS[l.momento]}
                {l.observacion && <div className="chico">{l.observacion}</div>}
                {l.mantenimiento && <div className="chico">Mantenimiento: {l.mantenimiento.descripcion} ({l.mantenimiento.realizadoPor || 'sin responsable'})</div>}
                {l.foto && <img src={l.foto} alt="Foto del reporte" className="foto-mini" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
