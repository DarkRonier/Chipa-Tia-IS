// Regenera migrations/0002_catalogo.sql con el catálogo inicial de src/server/semilla.ts.
// Uso: npm run catalogo
import { writeFileSync } from 'node:fs'
import { aSqlLiteral, catalogoInicial } from '../src/server/semilla.ts'

const sql = [
  '-- Catálogo inicial (generado con `npm run catalogo` desde src/server/semilla.ts; no editar a mano).',
  '-- Productos, máquinas y áreas de limpieza salen de las planillas en papel. El administrador los edita desde el sistema.',
  ...catalogoInicial().map(aSqlLiteral),
  '',
].join('\n')
writeFileSync(new URL('../migrations/0002_catalogo.sql', import.meta.url), sql)
console.log('migrations/0002_catalogo.sql actualizado')
