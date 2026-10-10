// Backend de la demo de GitHub Pages: la misma API de Hono corre dentro del navegador sobre
// SQLite (sql.js). Los datos quedan guardados en este navegador (IndexedDB) y no viajan a ningún servidor.
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { crearApp } from '../server/app'
import type { Env } from '../server/entorno'
import { crearBaseDemo } from './base'
import type { D1SqlJs } from './d1-sqljs'
import { cargarHistorialDemo } from './historial'

const BASE_IDB = 'chipa-tia-demo'
const ALMACEN = 'base'
const CLAVE = 'sqlite'

function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const pedido = indexedDB.open(BASE_IDB, 1)
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(ALMACEN)
    pedido.onsuccess = () => ok(pedido.result)
    pedido.onerror = () => mal(pedido.error)
  })
}

async function leerGuardada(): Promise<Uint8Array | undefined> {
  try {
    const idb = await abrirIdb()
    return await new Promise((ok) => {
      const p = idb.transaction(ALMACEN).objectStore(ALMACEN).get(CLAVE)
      p.onsuccess = () => ok(p.result instanceof Uint8Array ? p.result : undefined)
      p.onerror = () => ok(undefined)
    })
  } catch {
    return undefined
  }
}

async function escribir(valor: Uint8Array | null) {
  try {
    const idb = await abrirIdb()
    await new Promise<void>((ok) => {
      const tx = idb.transaction(ALMACEN, 'readwrite')
      if (valor) tx.objectStore(ALMACEN).put(valor, CLAVE)
      else tx.objectStore(ALMACEN).delete(CLAVE)
      tx.oncomplete = () => ok()
      tx.onerror = () => ok()
    })
  } catch {
    // Sin IndexedDB (modo privado): la demo funciona igual, pero se pierde al recargar.
  }
}

let listo: Promise<{ app: ReturnType<typeof crearApp>; env: Env; d1: D1SqlJs }> | null = null
let guardando: Promise<void> | null = null
let pendiente = false
let activa: D1SqlJs | null = null

/** Guarda la base después de cada escritura; si ya hay un guardado en curso, encola uno solo más. */
function guardar(d1: D1SqlJs) {
  if (guardando) {
    pendiente = true
    return
  }
  guardando = escribir(d1.exportar()).finally(() => {
    guardando = null
    if (pendiente && activa === d1) {
      pendiente = false
      guardar(d1)
    }
  })
}

async function iniciar() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const guardada = await leerGuardada()
  let d1: D1SqlJs
  try {
    d1 = await crearBaseDemo(SQL, guardada)
    // Una base guardada por una versión vieja de la demo puede no tener tablas nuevas.
    if (guardada) await d1.prepare('SELECT 1 FROM configuracion LIMIT 1').all()
  } catch {
    d1 = await crearBaseDemo(SQL)
  }
  if (!guardada) {
    await cargarHistorialDemo(d1)
    await escribir(d1.exportar())
  }
  activa = d1
  d1.alEscribir = () => guardar(d1)
  return { app: crearApp(), env: { DB: d1, MODO_DEMO: '1' } satisfies Env, d1 }
}

/** Atiende un pedido a /api como lo haría el Worker de Cloudflare. */
export async function fetchDemo(pedido: Request): Promise<Response> {
  listo ??= iniciar()
  const { app, env } = await listo
  return app.fetch(pedido, env)
}

/** Borra todo lo cargado en este navegador y vuelve a los datos de ejemplo. */
export async function reiniciarDemo() {
  activa = null
  pendiente = false
  await guardando
  await escribir(null)
  listo = null
}
