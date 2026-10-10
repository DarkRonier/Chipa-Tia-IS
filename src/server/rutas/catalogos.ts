// B01–B05: sectores, productos, máquinas, áreas y tareas de limpieza, sucursales.
import { Hono } from 'hono'
import type { Sector } from '../../shared/tipos'
import { todas } from '../db'
import type { Entorno } from '../entorno'

export const rutasCatalogos = new Hono<Entorno>()

rutasCatalogos.get('/sectores', async (c) => {
  const filas = await todas<{ id: Sector['id']; nombre: string; con_lotes: number }>(
    c.env.DB, 'SELECT id, nombre, con_lotes FROM sectores ORDER BY orden',
  )
  return c.json<Sector[]>(filas.map((f) => ({ id: f.id, nombre: f.nombre, conLotes: !!f.con_lotes })))
})
