// Crea los usuarios de cada rol (cuatro encargados de sector, supervisor, cajero y caja del comedor) en la base de Cloudflare D1, todos
// con la misma contraseña. Después el administrador le pone a cada uno la suya desde Usuarios.
// Uso: npm run crear-encargados -- <contraseña> [--remoto]
// Si un usuario ya existe (por id o por nombre de usuario) no se toca. Las contraseñas se cambian desde Usuarios.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashClave } from '../src/server/clave.ts'

const ENCARGADOS = [
  ['usr-chiperia', 'Encargado Chipería', 'chiperia', 'chiperia'],
  ['usr-chipitas', 'Encargado Chipitas', 'chipitas', 'chipitas'],
  ['usr-panaderia', 'Encargado Panadería', 'panaderia', 'panaderia'],
  ['usr-cocina', 'Encargado Cocina', 'cocina', 'cocina'],
  ['usr-supervisor', 'Supervisión', 'supervisor', 'supervisor'],
  ['usr-cajero', 'Caja', 'cajero', 'cajero'],
  ['usr-comedor', 'Caja Comedor', 'comedor', 'caja_comedor'],
] as const

const [clave, ...resto] = process.argv.slice(2)
if (!clave || clave.length < 4 || /^\s|\s$/.test(clave)) {
  console.error('Uso: npm run crear-encargados -- <contraseña de al menos 4 caracteres, sin espacios en los bordes> [--remoto]')
  process.exit(1)
}
const hash = await hashClave(clave)
const creado = new Date().toISOString()
const sql = ENCARGADOS.map(([id, nombre, usuario, rol]) =>
  `INSERT OR IGNORE INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en)
VALUES ('${id}', '${nombre}', '${usuario}', '${hash}', '${rol}', 1, 0, '${creado}');`).join('\n')
const archivo = join(mkdtempSync(join(tmpdir(), 'chipa-')), 'encargados.sql')
writeFileSync(archivo, sql + '\n')
execFileSync('npx', ['wrangler', 'd1', 'execute', 'chipa-tia', resto.includes('--remoto') ? '--remote' : '--local', `--file=${archivo}`], {
  stdio: 'inherit',
})
console.log('Listo: encargados de Chipería, Chipitas, Panadería y Cocina, supervisor, cajero y caja del comedor (los que ya existían quedaron igual).')
