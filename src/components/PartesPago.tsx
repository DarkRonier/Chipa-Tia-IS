// Pago híbrido: un pago (a un proveedor) o un cobro (de una venta) en varias partes de distintos medios.
// Ejemplo: 1.300.000 en cheque del Banco Regional + 145.000 en cheque del Continental + 115.000 en efectivo.
// Cada parte lleva su medio y su importe; el cheque, el banco (obligatorio) y el número; la transferencia, el banco
// (opcional). Abajo se va mostrando cuánto suman las partes y cuánto falta.
//
// - modo «compra»: cada parte tiene su importe; se puede pagar menos que el saldo (queda debiendo el resto).
// - modo «venta»: las partes tienen que sumar justo el total. Con un solo medio no se pide importe (es el total); con
//   varias, la primera parte cobra sola lo que falta («el resto»), así el cajero solo escribe las otras.
import { useId } from 'react'
import { gs, leerImporte, miles } from '../shared/dinero'
import { BANCOS_SUGERIDOS, MEDIO_CON_BANCO, MEDIOS_PAGO, NOMBRE_MEDIO_PAGO, type MedioPago, type PartePago } from '../shared/tipos'
import BotonIcono from './BotonIcono'
import { Icono } from './Iconos'

export interface ParteForm extends PartePago {
  clave: number
}

let siguiente = 1
export const parteNueva = (medio: MedioPago = 'efectivo', importe = 0): ParteForm => ({ clave: siguiente++, medio, importe, banco: '', chequeNumero: '' })

type Modo = 'compra' | 'venta'

/** Los importes de cada parte como quedan para enviar (en la venta, la primera es el resto). */
export function importesFinales(partes: ParteForm[], objetivo: number, modo: Modo): PartePago[] {
  const limpias = partes.map(({ medio, importe, banco, chequeNumero }) => ({
    medio, importe, banco: MEDIO_CON_BANCO[medio] ? banco.trim() : '', chequeNumero: medio === 'cheque' ? chequeNumero.trim() : '',
  }))
  if (modo === 'venta') {
    const otras = limpias.slice(1).reduce((s, p) => s + p.importe, 0)
    limpias[0] = { ...limpias[0], importe: objetivo - otras }
  }
  return limpias
}

/** Por qué todavía no se puede guardar (o null si está todo bien). */
export function faltaEnPartes(partes: ParteForm[], objetivo: number, modo: Modo): string | null {
  const finales = importesFinales(partes, objetivo, modo)
  const suma = finales.reduce((s, p) => s + p.importe, 0)
  const sinBanco = finales.findIndex((p) => p.medio === 'cheque' && !p.banco)
  if (finales.some((p, i) => p.importe <= 0 && !(modo === 'venta' && i === 0 && objetivo === 0))) {
    return modo === 'venta' && finales[0].importe <= 0 && finales.length > 1
      ? 'Las otras partes ya cubren todo el total: quitá una o bajá su importe.'
      : 'Falta el importe de alguna parte.'
  }
  if (sinBanco >= 0) return `Falta el banco del cheque${finales.length > 1 ? ` (parte ${sinBanco + 1})` : ''}.`
  if (suma > objetivo) return `Las partes suman ${gs(suma)}: pasan ${gs(objetivo)} por ${gs(suma - objetivo)}.`
  return null
}

export default function PartesPago({ partes, onChange, objetivo, modo }: {
  partes: ParteForm[]
  onChange: (p: ParteForm[]) => void
  /** Compra: lo que falta pagar. Venta: el total a cobrar. */
  objetivo: number
  modo: Modo
}) {
  const idBancos = useId()
  const finales = importesFinales(partes, objetivo, modo)
  const suma = finales.reduce((s, p) => s + p.importe, 0)
  const varias = partes.length > 1
  const cambiar = (i: number, cambio: Partial<ParteForm>) => onChange(partes.map((p, j) => (j === i ? { ...p, ...cambio } : p)))
  const agregar = () => {
    // La nueva parte arranca en 0 (Mati, 2026-11-21): el importe de cada cheque se escribe a mano.
    const medio = partes.some((p) => p.medio === 'efectivo') ? 'cheque' : 'efectivo'
    onChange([...partes, parteNueva(medio)])
  }

  return (
    <div className={`partes-pago ${modo}`}>
      <datalist id={idBancos}>{BANCOS_SUGERIDOS.map((b) => <option key={b} value={b} />)}</datalist>
      {partes.map((p, i) => {
        const resto = modo === 'venta' && i === 0
        const titulo = varias ? `Parte ${i + 1}` : null
        return (
          <div key={p.clave} className={`parte-pago${varias ? ' con-borde' : ''}`}>
            {titulo && <span className="parte-titulo">{titulo}</span>}
            <label className="campo">
              <span>Medio de pago</span>
              <select value={p.medio} onChange={(e) => cambiar(i, { medio: e.target.value as MedioPago })}>
                {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{NOMBRE_MEDIO_PAGO[m]}</option>)}
              </select>
            </label>
            {modo === 'compra' && (
              <label className="campo">
                <span>{varias ? 'Importe (Gs.)' : 'Importe a pagar (Gs.)'}</span>
                <input inputMode="numeric" value={p.importe ? miles(p.importe) : ''} placeholder="0" autoFocus={i > 0}
                  onChange={(e) => cambiar(i, { importe: leerImporte(e.target.value) })} />
              </label>
            )}
            {modo === 'venta' && varias && (
              resto ? (
                <div className="campo">
                  <span>Lo que falta (Gs.)</span>
                  <output className={`parte-resto${finales[0].importe < 0 ? ' negativo' : ''}`}>{miles(finales[0].importe)}</output>
                </div>
              ) : (
                <label className="campo">
                  <span>Importe (Gs.)</span>
                  <input inputMode="numeric" value={p.importe ? miles(p.importe) : ''} placeholder="0" autoFocus
                    onChange={(e) => cambiar(i, { importe: leerImporte(e.target.value) })} />
                </label>
              )
            )}
            {MEDIO_CON_BANCO[p.medio] && (
              <label className="campo">
                <span>Banco</span>
                <input value={p.banco} maxLength={60} list={idBancos} placeholder={p.medio === 'cheque' ? '' : 'opcional'}
                  onChange={(e) => cambiar(i, { banco: e.target.value })} />
              </label>
            )}
            {p.medio === 'cheque' && (
              <label className="campo">
                <span>N° de cheque</span>
                <input value={p.chequeNumero} maxLength={30} inputMode="numeric" placeholder="opcional" onChange={(e) => cambiar(i, { chequeNumero: e.target.value })} />
              </label>
            )}
            {varias && (
              <BotonIcono icono="cancelar" texto={`Quitar la parte ${i + 1}`} tono="peligro" className="parte-quitar"
                onClick={() => onChange(partes.filter((_, j) => j !== i))} />
            )}
          </div>
        )
      })}
      <div className="partes-pie">
        <button type="button" className="btn-discreto" onClick={agregar} disabled={partes.length >= 10}>
          <Icono nombre="mas" /> Pagar con otro medio también
        </button>
        {(varias || modo === 'compra') && (
          <span className="partes-suma">
            {varias && modo === 'compra' && <>Suman <strong>{gs(suma)}</strong> · </>}
            {suma > objetivo || (modo === 'venta' && finales[0].importe < 0)
              ? <span className="diferencia-negativa">Se pasan {gs(modo === 'venta' ? -finales[0].importe : suma - objetivo)}</span>
              : modo === 'compra'
                ? <>{suma === objetivo ? <strong>Cubre todo lo que falta</strong> : <>Queda debiendo <strong>{gs(objetivo - suma)}</strong></>}</>
                : <strong>Cubre el total</strong>}
          </span>
        )}
      </div>
    </div>
  )
}
