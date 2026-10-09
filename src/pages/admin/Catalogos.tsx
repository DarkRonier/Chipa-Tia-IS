import { useState } from 'react'
import { useSector } from '../../components/Layout'
import { SECTORES, TIPOS_MAQUINA, type TipoMaquina } from '../../mock/data'
import { nuevoId, textoRango, useDatos } from '../../mock/store'

type Pestana = 'productos' | 'maquinas' | 'limpieza' | 'sucursales'

export default function Catalogos() {
  const { datos, actualizar } = useDatos()
  const sector = useSector()
  const nombreSector = SECTORES.find((s) => s.id === sector)!.nombre
  const [pestana, setPestana] = useState<Pestana>('productos')
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoMaquina>('heladera')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [areaId, setAreaId] = useState(datos.areas[0].id)

  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null)
  const guardarNombre = () => {
    const n = renombrando!.nombre.trim()
    if (n) actualizar((d) => ({ ...d, productos: d.productos.map((x) => (x.id === renombrando!.id ? { ...x, nombre: n } : x)) }))
    setRenombrando(null)
  }

  const agregar = () => {
    const t = texto.trim()
    if (!t) return
    if (pestana === 'productos') actualizar((d) => ({ ...d, productos: [...d.productos, { id: nuevoId(), sector, nombre: t, activo: true }] }))
    if (pestana === 'sucursales') actualizar((d) => ({ ...d, sucursales: [...d.sucursales, { id: nuevoId(), nombre: t }] }))
    if (pestana === 'limpieza')
      actualizar((d) => ({ ...d, areas: d.areas.map((a) => (a.id === areaId ? { ...a, items: [...a.items, { id: nuevoId(), nombre: t }] } : a)) }))
    if (pestana === 'maquinas') {
      const numero = Math.max(0, ...datos.maquinas.filter((m) => m.sector === sector).map((m) => m.numero)) + 1
      actualizar((d) => ({
        ...d,
        maquinas: [...d.maquinas, { id: nuevoId(), sector, numero, nombre: t, tipo, tempMin: min === '' ? null : Number(min), tempMax: max === '' ? null : Number(max) }],
      }))
      setMin(''); setMax('')
    }
    setTexto('')
  }

  return (
    <>
      <h1>Catálogos</h1>
      <div className="segmentado">
        {(['productos', 'maquinas', 'limpieza', 'sucursales'] as Pestana[]).map((p) => (
          <button key={p} className={pestana === p ? 'activo' : ''} onClick={() => setPestana(p)}>
            {{ productos: 'Productos', maquinas: 'Máquinas', limpieza: 'Limpieza', sucursales: 'Sucursales' }[p]}
          </button>
        ))}
      </div>
      {(pestana === 'productos' || pestana === 'maquinas') && <p className="suave">Sector: {nombreSector} (se cambia arriba a la derecha).</p>}

      {pestana === 'productos' && (
        <table className="tabla">
          <tbody>
            {datos.productos.filter((p) => p.sector === sector).map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'apagado'}>
                <td>
                  {renombrando?.id === p.id ? (
                    <input id={`renombrar-${p.id}`} autoFocus value={renombrando.nombre} onChange={(e) => setRenombrando({ id: p.id, nombre: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && guardarNombre()} />
                  ) : p.nombre}
                </td>
                <td>
                  {renombrando?.id === p.id ? (
                    <button className="btn-texto" onClick={guardarNombre}>Guardar</button>
                  ) : (
                    <button className="btn-texto" onClick={() => setRenombrando({ id: p.id, nombre: p.nombre })}>Renombrar</button>
                  )}
                  <button className="btn-texto" onClick={() => actualizar((d) => ({ ...d, productos: d.productos.map((x) => (x.id === p.id ? { ...x, activo: !x.activo } : x)) }))}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pestana === 'maquinas' && (
        <table className="tabla">
          <thead><tr><th>N°</th><th>Máquina</th><th>Rango</th></tr></thead>
          <tbody>
            {datos.maquinas.filter((m) => m.sector === sector).map((m) => (
              <tr key={m.id}><td>{m.numero}</td><td>{m.nombre}<div className="suave chico">{TIPOS_MAQUINA[m.tipo]}</div></td><td>{textoRango(m)}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {pestana === 'limpieza' && (
        <>
          <label className="campo">
            <span>Área</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {datos.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
          {(() => {
            const a = datos.areas.find((x) => x.id === areaId)!
            return (
              <>
                <p className="suave">
                  {a.codigo} · la cargan: {a.sectores.map((s) => SECTORES.find((x) => x.id === s)!.nombre).join(', ')} ·{' '}
                  {SECTORES.map((s) => (
                    <label key={s.id} className="check en-linea">
                      <input
                        type="checkbox"
                        checked={a.sectores.includes(s.id)}
                        onChange={() => actualizar((d) => ({ ...d, areas: d.areas.map((x) => (x.id === a.id ? { ...x, sectores: x.sectores.includes(s.id) ? x.sectores.filter((y) => y !== s.id) : [...x.sectores, s.id] } : x)) }))}
                      /> {s.nombre}
                    </label>
                  ))}
                </p>
                <ol>{a.items.map((i) => <li key={i.id}>{i.nombre}{i.pideNumero && <span className="suave"> (pide N° de equipo)</span>}</li>)}</ol>
              </>
            )
          })()}
        </>
      )}

      {pestana === 'sucursales' && (
        <ul>{datos.sucursales.map((s) => <li key={s.id}>{s.nombre}</li>)}</ul>
      )}

      <div className="tarjeta filtros">
        <label className="campo">
          <span>{{ productos: 'Nuevo producto', maquinas: 'Nueva máquina', limpieza: 'Nueva tarea de limpieza', sucursales: 'Nueva sucursal' }[pestana]}</span>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        {pestana === 'maquinas' && (
          <>
            <label className="campo">
              <span>Tipo</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMaquina)}>
                {Object.entries(TIPOS_MAQUINA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="campo"><span>T° mínima (vacío = sin mínimo)</span><input type="number" value={min} onChange={(e) => setMin(e.target.value)} /></label>
            <label className="campo"><span>T° máxima (vacío = sin máximo)</span><input type="number" value={max} onChange={(e) => setMax(e.target.value)} /></label>
          </>
        )}
        <button className="btn-primario" onClick={agregar}>Agregar</button>
      </div>
    </>
  )
}
