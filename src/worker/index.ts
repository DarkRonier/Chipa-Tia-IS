// Punto de entrada en Cloudflare Workers: /api/* va a la API de Hono; el resto son los archivos
// de la app (dist/) que sirve Workers Assets. El cron dispara resúmenes y copias.
import { crearApp } from '../server/app'
import type { Env } from '../server/entorno'
import { tareasProgramadas } from '../server/programado'

interface EnvWorker extends Env {
  ASSETS: { fetch(pedido: Request): Promise<Response> }
}

interface Programacion {
  scheduledTime: number
  cron: string
}

interface Contexto {
  waitUntil(p: Promise<unknown>): void
}

const app = crearApp()

export default {
  fetch(pedido: Request, env: EnvWorker, ctx: Contexto) {
    const url = new URL(pedido.url)
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') return app.fetch(pedido, env, ctx as never)
    return env.ASSETS.fetch(pedido)
  },
  scheduled(evento: Programacion, env: EnvWorker, ctx: Contexto) {
    ctx.waitUntil(tareasProgramadas(env, new Date(evento.scheduledTime)))
  },
}
