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

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
  'ochocientos', 'novecientos']

/** 0–999 en palabras ("ciento veintitrés"). */
function hastaMil(n: number): string {
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  const resto = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` y ${UNIDADES[r % 10]}` : ''}`
  return [CENTENAS[c], resto].filter(Boolean).join(' ')
}

/** "uno" pasa a "un" delante de mil y millones ("veintiún mil", "un millón"). */
const apocope = (t: string) => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')

/** 125300 → "ciento veinticinco mil trescientos". Para el total en letras de la factura. */
export function enLetras(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'cero'
  const millones = Math.floor(n / 1_000_000)
  const miles_ = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (millones) partes.push(millones === 1 ? 'un millón' : `${apocope(enLetras(millones))} millones`)
  if (miles_) partes.push(miles_ === 1 ? 'mil' : `${apocope(hastaMil(miles_))} mil`)
  if (resto) partes.push(hastaMil(resto))
  return partes.join(' ')
}
