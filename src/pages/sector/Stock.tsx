import Volver from '../../components/Volver'
import { useSector } from '../../components/Layout'
import { SECTORES } from '../../mock/data'
import { stockDe, stockPorLote, useDatos } from '../../mock/store'

export function TablaStock() {
  const { datos } = useDatos()
  const sector = useSector()
  const conLotes = SECTORES.find((s) => s.id === sector)!.conLotes
  const filas = datos.productos
    .filter((p) => p.sector === sector)
    .map((p) => ({ p, total: stockDe(datos.movimientos, sector, p.id), lotes: conLotes ? stockPorLote(datos.movimientos, sector, p.id) : [] }))
    .filter((f) => f.total !== 0 || f.p.activo)

  return (
    <table className="tabla">
      <thead>
        <tr><th>Producto</th><th className="num">En frío</th></tr>
      </thead>
      <tbody>
        {filas.map(({ p, total, lotes }) => (
          <tr key={p.id} className={total === 0 ? 'apagado' : ''}>
            <td>
              {p.nombre}
              {lotes.length > 0 && (
                <div className="suave chico">{lotes.map(([l, n]) => `${l}: ${n}`).join(' · ')}</div>
              )}
            </td>
            <td className="num">{total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Stock() {
  return (
    <>
      <Volver titulo="Stock en frío" />
      <TablaStock />
    </>
  )
}
