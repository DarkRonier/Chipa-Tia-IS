// Importes en guaraníes (enteros, sin decimales).

/** 120000 → "120.000". */
export function miles(n: number): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return n < 0 ? `−${s}` : s
}

/** 120000 → "Gs. 120.000". */
export const gs = (n: number) => `Gs. ${miles(n)}`

/** Lo que se escribe en un campo de importe ("120.000", "120000", "Gs 120.000") → 120000; vacío → 0. */
export function leerImporte(texto: string): number {
  const digitos = texto.replace(/\D/g, '')
  return digitos ? Number(digitos) : 0
}
