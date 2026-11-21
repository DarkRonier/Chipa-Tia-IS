// M12: qué se escribe en cada renglón y en cada casillero de la factura preimpresa. Sin React, para probarlo solo.
import type { Iva, Venta } from './tipos'

export interface RenglonFactura {
  codigo: string
  cantidad: string
  descripcion: string
  precio: string
  iva: Iva
  /** Importe de la columna de IVA (negativo para el descuento). */
  importe: number
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "2026-11-21" → "21 de noviembre de 2026" (la hoja dice «Fecha de emisión, …»). */
export function fechaFactura(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${a}`
}

/**
 * Los renglones del detalle. Si la venta tiene más productos que renglones la hoja, los últimos se juntan en
 * «Varios», uno por tasa de IVA, para que los importes de cada columna sigan sumando bien. El descuento va al final,
 * repartido entre las columnas en proporción.
 */
export function renglonesFactura(v: Venta, maxRenglones: number, miles: (n: number) => string): RenglonFactura[] {
  const { desc } = columnasIva(v)
  const conDescuento = ([0, 5, 10] as Iva[]).filter((iva) => desc[iva])
  const lugar = Math.max(1, maxRenglones - conDescuento.length)
  let enDetalle = v.items.length
  if (v.items.length > lugar) {
    enDetalle = lugar
    while (enDetalle > 0 && enDetalle + new Set(v.items.slice(enDetalle).map((i) => i.iva)).size > lugar) enDetalle--
  }
  const r: RenglonFactura[] = v.items.slice(0, enDetalle).map((i) => ({
    codigo: i.codigo, cantidad: String(i.cantidad), descripcion: i.nombre, precio: miles(i.precioUnitario), iva: i.iva, importe: i.subtotal,
  }))
  const resto = v.items.slice(enDetalle)
  for (const iva of [0, 5, 10] as Iva[]) {
    const de = resto.filter((i) => i.iva === iva)
    if (!de.length) continue
    r.push({
      codigo: '', cantidad: String(de.reduce((s, i) => s + i.cantidad, 0)), precio: '', iva,
      descripcion: `Varios (${de.length} productos${iva === 0 ? ', exentos' : `, IVA ${iva} %`})`,
      importe: de.reduce((s, i) => s + i.subtotal, 0),
    })
  }
  for (const iva of conDescuento) {
    r.push({ codigo: '', cantidad: '', descripcion: conDescuento.length > 1 ? `Descuento (${iva === 0 ? 'exentas' : `${iva} %`})` : 'Descuento', precio: '', iva, importe: -desc[iva] })
  }
  return r
}

/** Reparte el descuento entre las columnas de IVA en proporción, para que los valores parciales sumen el total. */
export function columnasIva(v: Venta) {
  const bruto: Record<Iva, number> = { 0: 0, 5: 0, 10: 0 }
  for (const i of v.items) bruto[i.iva] += i.subtotal
  const desc: Record<Iva, number> = { 0: 0, 5: 0, 10: 0 }
  if (v.descuento > 0 && v.subtotal > 0) {
    const tasas = [0, 5, 10] as Iva[]
    for (const iva of tasas) desc[iva] = Math.round((v.descuento * bruto[iva]) / v.subtotal)
    // Lo que sobra o falta por redondeo va a la columna más grande (nunca a una vacía).
    const mayor = tasas.reduce((a, b) => (bruto[b] > bruto[a] ? b : a))
    desc[mayor] += v.descuento - tasas.reduce<number>((s, iva) => s + desc[iva], 0)
  }
  const neto = { 0: bruto[0] - desc[0], 5: bruto[5] - desc[5], 10: bruto[10] - desc[10] } as Record<Iva, number>
  // Liquidación del IVA: el precio ya lo incluye (5 % → 1/21; 10 % → 1/11).
  const iva5 = Math.round(neto[5] / 21)
  const iva10 = Math.round(neto[10] / 11)
  return { desc, neto, iva5, iva10, totalIva: iva5 + iva10 }
}
