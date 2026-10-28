// D01, D07, E05: lo que hay guardado en frío, por producto. En Chipería, también por lote (el más viejo primero).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useConsulta } from '../../cliente/consultas'
import { ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import { IconoStock } from '../../components/Iconos'
import Volver from '../../components/Volver'
import type { SectorId, StockFila } from '../../shared/tipos'
import '../../styles/stock.css'

/** Stock en frío del sector (activos y desactivados que todavía tienen algo). */
export const useStock = (sector: SectorId) => useConsulta<StockFila[]>('/stock', { sector })

/** Tabla de stock por producto (y por lote en Chipería). `ocultarCeros`: arranca escondiendo los productos en 0. */
export function TablaStock({ filas, conLotes, ocultarCeros = false }: { filas: StockFila[]; conLotes: boolean; ocultarCeros?: boolean }) {
  const [soloConStock, setSoloConStock] = useState(ocultarCeros)
  const hayCeros = filas.some((f) => f.total === 0)
  const visibles = soloConStock ? filas.filter((f) => f.total !== 0) : filas
  if (filas.length === 0) return <p className="suave">Este sector no tiene productos cargados.</p>
  return (
    <>
      {hayCeros && (
        <label className="check stk-filtro">
          <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
          Ocultar los productos en 0
        </label>
      )}
      {visibles.length === 0 ? (
        <p className="suave">No hay nada guardado en frío.</p>
      ) : (
        <table className="tabla stk-tabla">
          <thead>
            <tr><th>Producto</th><th className="num">En frío</th></tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.productoId} className={f.total === 0 ? 'apagado' : ''}>
                <td>
                  {f.productoNombre}
                  {!f.activo && <span className="stk-desactivado">desactivado</span>}
                  {conLotes && f.lotes.length > 0 && (
                    <ul className="stk-lotes" aria-label={`Lotes de ${f.productoNombre}`}>
                      {f.lotes.map((l) => (
                        <li key={l.lote}><span>{l.lote}</span><strong>{l.cantidad}</strong></li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="num stk-total">{f.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export default function Stock() {
  const { id: sector, conLotes } = useSectorActivo()
  const stock = useStock(sector)
  return (
    <>
      <Volver titulo="Stock en frío" icono={<IconoStock />} />
      <ConDatos consulta={stock}>
        {(filas) => (
          <>
            <TablaStock filas={filas} conLotes={conLotes} />
            <div className="stk-atajos">
              <Link className="boton-grande" to="/sector/salida"><strong>Sacar para la venta</strong></Link>
              <Link className="boton-grande" to="/sector/envio"><strong>Envío a sucursal</strong></Link>
            </div>
          </>
        )}
      </ConDatos>
    </>
  )
}
