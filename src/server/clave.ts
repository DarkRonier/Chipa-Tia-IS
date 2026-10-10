// Contraseñas con PBKDF2-SHA256 (Web Crypto). Workers limita PBKDF2 a 100.000 iteraciones.
const ITERACIONES = 100_000

const aHex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const deHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)))

async function derivar(clave: string, sal: Uint8Array, iteraciones: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones }, base, 256)
}

/** Devuelve "pbkdf2$iteraciones$sal$hash". */
export async function hashClave(clave: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERACIONES}$${aHex(sal)}$${aHex(await derivar(clave, sal, ITERACIONES))}`
}

export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const [alg, it, sal, hash] = guardado.split('$')
  if (alg !== 'pbkdf2' || !sal || !hash) return false
  const calculado = aHex(await derivar(clave, deHex(sal), Number(it)))
  // Comparación de tiempo constante.
  let dif = calculado.length ^ hash.length
  for (let i = 0; i < Math.min(calculado.length, hash.length); i++) dif |= calculado.charCodeAt(i) ^ hash.charCodeAt(i)
  return dif === 0
}

export async function sha256(texto: string): Promise<string> {
  return aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
}

export function tokenAleatorio(): string {
  return aHex(crypto.getRandomValues(new Uint8Array(32)))
}

export const CLAVE_MINIMA = 6

/**
 * Hash que no corresponde a ninguna contraseña. El login lo verifica cuando el usuario no existe: así tarda
 * lo mismo que con una contraseña equivocada y el tiempo de respuesta no delata qué usuarios hay.
 */
export const HASH_DE_RELLENO = `pbkdf2$${ITERACIONES}$${'0'.repeat(32)}$${'0'.repeat(64)}`
