// Arma una base SQLite completa en memoria: migraciones + usuarios y datos de ejemplo.
// La usan la demo de GitHub Pages (en el navegador) y las pruebas automáticas (Node).
import type { SqlJsStatic } from 'sql.js'
import { hashClave } from '../server/clave'
import { D1SqlJs } from './d1-sqljs'

const MIGRACIONES = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

/** Contraseña de todos los usuarios de la demo. */
export const CLAVE_DEMO = '1234'

export const USUARIOS_DEMO = [
  { id: 'usr-chiperia', nombre: 'Encargado Chipería', usuario: 'chiperia', rol: 'chiperia' },
  { id: 'usr-chipitas', nombre: 'Encargado Chipitas', usuario: 'chipitas', rol: 'chipitas' },
  { id: 'usr-panaderia', nombre: 'Encargado Panadería', usuario: 'panaderia', rol: 'panaderia' },
  { id: 'usr-cocina', nombre: 'Encargado Cocina', usuario: 'cocina', rol: 'cocina' },
  { id: 'usr-admin', nombre: 'Administración', usuario: 'admin', rol: 'admin' },
] as const

export const SUCURSALES_DEMO = [
  { id: 'suc-centro', nombre: 'Sucursal Centro' },
  { id: 'suc-ruta1', nombre: 'Sucursal Ruta 1' },
  { id: 'suc-encarnacion', nombre: 'Sucursal Encarnación' },
] as const

// PBKDF2 es lento a propósito; en la demo todos comparten contraseña, así que se calcula una vez.
let hashDemo: Promise<string> | null = null

/** Aplica todas las migraciones en orden. */
export function migrar(d1: D1SqlJs) {
  for (const nombre of Object.keys(MIGRACIONES).sort()) d1.exec(MIGRACIONES[nombre])
}

/**
 * Base nueva con el catálogo de las planillas, los usuarios de la demo (contraseña 1234),
 * sucursales y lotes de materia prima de ejemplo. Con `guardada` reabre una base exportada.
 */
export async function crearBaseDemo(SQL: SqlJsStatic, guardada?: Uint8Array): Promise<D1SqlJs> {
  if (guardada) return new D1SqlJs(new SQL.Database(guardada))
  const d1 = new D1SqlJs(new SQL.Database())
  migrar(d1)
  hashDemo ??= hashClave(CLAVE_DEMO)
  const hash = await hashDemo
  const creado = new Date().toISOString()
  const sentencias = [
    ...USUARIOS_DEMO.map((u) =>
      d1.prepare('INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, activo, debe_cambiar_clave, creado_en) VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
        .bind(u.id, u.nombre, u.usuario, hash, u.rol, creado)),
    ...SUCURSALES_DEMO.map((s) => d1.prepare('INSERT INTO sucursales (id, nombre, activo) VALUES (?, ?, 1)').bind(s.id, s.nombre)),
  ]
  await d1.batch(sentencias)
  return d1
}
