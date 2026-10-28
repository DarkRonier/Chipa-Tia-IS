// Prepara la cuenta de Cloudflare para publicar: crea la base D1 `chipa-tia` y el bucket R2 `chipa-tia-archivos`
// si todavía no existen, y escribe el id de la base en wrangler.jsonc (solo en esta copia, para el deploy).
// Lo usa el workflow .github/workflows/cloudflare.yml; necesita CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID.
// Uso: node scripts/preparar-cloudflare.ts
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = 'chipa-tia'
const BUCKET = 'chipa-tia-archivos'

const wrangler = (...args: string[]) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

function idDeLaBase(): string | null {
  const salida = wrangler('d1', 'list', '--json')
  const lista = JSON.parse(salida.slice(salida.indexOf('['))) as { name: string; uuid: string }[]
  return lista.find((b) => b.name === BASE)?.uuid ?? null
}

let id = idDeLaBase()
if (!id) {
  console.log(`Creando la base D1 ${BASE}…`)
  wrangler('d1', 'create', BASE)
  id = idDeLaBase()
  if (!id) throw new Error(`No se pudo crear la base ${BASE}.`)
}
console.log(`Base D1 ${BASE}: ${id}`)

try {
  wrangler('r2', 'bucket', 'create', BUCKET)
  console.log(`Bucket R2 ${BUCKET} creado.`)
} catch {
  // Ya existe (o R2 todavía no está activado en la cuenta: el deploy lo va a decir).
  console.log(`Bucket R2 ${BUCKET}: ya existe.`)
}

const config = readFileSync('wrangler.jsonc', 'utf8')
writeFileSync('wrangler.jsonc', config.replace(/"database_id": "[^"]*"/, `"database_id": "${id}"`))
