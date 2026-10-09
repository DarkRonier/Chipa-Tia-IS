import { SECTORES } from '../../mock/data'
import { fechaHora, useDatos } from '../../mock/store'
import { MARCAS } from '../sector/Limpieza'

export default function Controles() {
  const { datos, actualizar, usuario } = useDatos()
  const limpiezas = [...datos.limpiezas].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const fuera = datos.lecturas.filter((l) => l.fueraDeRango).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const quien = (id: string) => datos.usuarios.find((u) => u.id === id)?.nombre ?? id

  const controlar = (id: string) =>
    actualizar((d) => ({
      ...d,
      limpiezas: d.limpiezas.map((l) => (l.id === id ? { ...l, controladoPor: { usuarioId: usuario!.id, fecha: new Date().toISOString() } } : l)),
    }))

  return (
    <>
      <h1>Limpieza y temperatura</h1>
      <h2>Limpiezas</h2>
      <p className="suave">"Controlado por" de la planilla en papel: el administrador da el visto bueno.</p>
      {limpiezas.map((l) => {
        const area = datos.areas.find((a) => a.id === l.areaId)!
        const cuenta = (m: string) => Object.values(l.marcas).filter((x) => x === m).length
        return (
          <div className="tarjeta" key={l.id}>
            <div className="fila-acciones">
              <strong>{area.nombre}</strong>
              <span className="suave chico">{fechaHora(l.fecha)} · {quien(l.usuarioId)} · {SECTORES.find((s) => s.id === l.sector)!.nombre}</span>
            </div>
            <div className="chico">
              {MARCAS.map(({ m, t }) => `${t}: ${cuenta(m)}`).join(' · ')}
              {Object.keys(l.numeros).length > 0 && <> · N° de equipo: {Object.entries(l.numeros).map(([i, n]) => `${area.items.find((x) => x.id === i)?.nombre} ${n}`).join(', ')}</>}
            </div>
            {l.comentario && <div className="chico">“{l.comentario}”</div>}
            {l.controladoPor ? (
              <p className="ok chico">Controlado por {quien(l.controladoPor.usuarioId)} el {fechaHora(l.controladoPor.fecha)}</p>
            ) : (
              <button className="btn-secundario" onClick={() => controlar(l.id)}>Dar visto bueno</button>
            )}
          </div>
        )
      })}
      <h2>Temperaturas fuera de rango</h2>
      <table className="tabla">
        <tbody>
          {fuera.map((l) => {
            const m = datos.maquinas.find((x) => x.id === l.maquinaId)!
            return (
              <tr key={l.id} className="fila-roja">
                <td>{fechaHora(l.fecha)}</td>
                <td>{m.nombre}<div className="suave chico">{SECTORES.find((s) => s.id === m.sector)!.nombre} · {l.observacion}</div></td>
                <td className="num">{l.temperatura} °C</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
