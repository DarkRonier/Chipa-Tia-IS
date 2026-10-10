// La API completa. Corre igual en Cloudflare Workers, en el navegador (demo) y en las pruebas.
import { Hono } from 'hono'
import type { ErrorRespuesta } from '../shared/tipos'
import type { Entorno } from './entorno'
import { ErrorApi, esStockInsuficiente } from './errores'
import { rutasAuth } from './rutas/auth'
import { rutasCatalogos } from './rutas/catalogos'
import { rutasDatos } from './rutas/datos'
import { rutasLimpieza } from './rutas/limpieza'
import { rutasLotes } from './rutas/lotes'
import { rutasMaquinas } from './rutas/maquinas'
import { rutasProduccion } from './rutas/produccion'
import { rutasReportes } from './rutas/reportes'
import { rutasStock } from './rutas/stock'
import { rutasUsuarios } from './rutas/usuarios'
import { conClavePropia, conSesion } from './sesion'

export function crearApp() {
  const app = new Hono<Entorno>().basePath('/api')

  app.onError((e, c) => {
    if (e instanceof ErrorApi) {
      return c.json<ErrorRespuesta>({ error: { codigo: e.codigo, mensaje: e.message } }, e.estado)
    }
    if (esStockInsuficiente(e)) {
      return c.json<ErrorRespuesta>(
        { error: { codigo: 'stock_insuficiente', mensaje: 'No hay stock suficiente para esa salida.' } },
        409,
      )
    }
    console.error(e)
    return c.json<ErrorRespuesta>({ error: { codigo: 'error_interno', mensaje: 'Ocurrió un error inesperado. Probá de nuevo.' } }, 500)
  })
  app.notFound((c) => c.json<ErrorRespuesta>({ error: { codigo: 'no_encontrado', mensaje: 'Ruta desconocida.' } }, 404))

  app.get('/salud', (c) => c.json({ ok: true }))
  app.route('/auth', rutasAuth)

  // Todo lo demás requiere sesión y una contraseña propia (no la inicial ni una restablecida).
  app.use('*', conSesion, conClavePropia)
  app.route('/', rutasUsuarios)
  app.route('/', rutasCatalogos)
  app.route('/', rutasProduccion)
  app.route('/', rutasStock)
  app.route('/', rutasLotes)
  app.route('/', rutasMaquinas)
  app.route('/', rutasLimpieza)
  app.route('/', rutasReportes)
  app.route('/', rutasDatos)
  return app
}

export type App = ReturnType<typeof crearApp>
