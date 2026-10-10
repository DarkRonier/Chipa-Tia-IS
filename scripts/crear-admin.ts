// Crea o reinicia el usuario administrador en la base de Cloudflare D1 (producción).
// Uso: npm run crear-admin -- <contraseña> [--remoto]
// Sin --remoto escribe en la base local de desarrollo (wrangler dev). El sistema pide cambiarla al entrar.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashClave } from '../src/server/clave.ts'

const [clave, ...resto] = process.argv.slice(2)
if (!clave || clave.length < 6) {
  console.error('Uso: npm run crear-admin -- <contraseña de al menos 6 caracteres> [--remoto]')
  process.exit(1)
}
const hash = await hashClave(clave)
const sql = `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en)
VALUES ('usr-admin', 'Administración', 'admin', '${hash}', 'admin', 1, 1, '${new Date().toISOString()}')
ON CONFLICT(id) DO UPDATE SET clave_hash = excluded.clave_hash, activo = 1, debe_cambiar_clave = 1;
DELETE FROM sesiones WHERE usuario_id = 'usr-admin';
`
const archivo = join(mkdtempSync(join(tmpdir(), 'chipa-')), 'admin.sql')
writeFileSync(archivo, sql)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'chipa-tia', resto.includes('--remoto') ? '--remote' : '--local', `--file=${archivo}`], {
  stdio: 'inherit',
})
console.log('Listo: usuario "admin" con la contraseña indicada (se pide cambiarla al entrar).')
