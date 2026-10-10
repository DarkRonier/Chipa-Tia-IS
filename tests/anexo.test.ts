// Anexo del presupuesto: la planilla de comprobación de la entrega, paso por paso, contra la API real.
// Cada prueba lleva el ID de la planilla (A01 … I05) y, como dice el anexo, las cantidades encadenan:
// 38 empanadas (30 cocinadas, 8 guardadas) → stock 8 → salida de 3 → 5 → envío de 2 → 3 → envío de 10
// rechazado → merma de 1 → 2; chipas: 200 al horno y 300 al congelador → envío de 100 → quedan 200 en el lote.
// El reloj se fija en un día de trabajo (miércoles 14/10/2026, 09:00 en Paraguay) y avanza un minuto por pedido,
// así la prueba da lo mismo a cualquier hora en que corra. Lo que no pasa por la API queda como pendiente
// manual: A05 (abrirlo en Android, iPhone y computadora) e I02 (Time Travel de D1 en la cuenta de Cloudflare).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CLAVE_DEMO } from '../src/demo/base'
import { rangoResumen, sumarDias } from '../src/shared/hora'
import type {
  AreaLimpieza, Auditoria, Configuracion, Copia, Exportacion, Lectura, Limpieza, LoteChipa, LoteMP, Maquina,
  Movimiento, Produccion, Producto, Reporte, RespuestaEnvio, RespuestaLogin, ResumenCorreo, Sector, StockFila,
  Sucursal, TareaLimpieza, TrazabilidadLote, TrazabilidadMP, TrazabilidadSucursal, Usuario,
} from '../src/shared/tipos'
import { ROLES, SECTOR_IDS } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba, type Respuesta } from './ayuda'

/** Día de la prueba (miércoles) y el siguiente, cuando llega el resumen diario de las 06:00. */
const DIA = '2026-10-14'
const MANIANA = sumarDias(DIA, 1)

const EMPANADA = 'prod-cocina-10' // Empanada frita (carne)
const MARINERA = 'prod-cocina-14' // Marinera de carne
const CROQUETE = 'prod-cocina-04' // Croquete de carne
const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const PAN = 'prod-panaderia-01' // Pan felipe (ejemplo)
const HORNO_COCINA = 'maq-cocina-5' // Horno: tipo «otra», sin temperatura

// JPEG mínimo de 1×1 px (válido) como data URL: la foto ya achicada que manda el navegador.
const JPEG_1PX =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBtFFFeWeyf/9k='

// ---------- Reloj de la prueba ----------

let reloj = Date.parse(`${DIA}T09:00:00-03:00`)
const ponerReloj = (instante: number | string) => {
  reloj = typeof instante === 'number' ? instante : Date.parse(instante)
  vi.setSystemTime(reloj)
}
const ahoraIso = () => new Date(reloj).toISOString()

/**
 * "dd/mm/aaaa hh:mm" de un instante UTC con el reloj de Paraguay, calculado a mano para comparar con lo que
 * muestra el sistema (I04). Paraguay está en UTC−3 todo el año desde 2024.
 */
function relojParaguay(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3_600_000)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`
}

/** Resend simulado: guarda los correos que se mandan. */
function simularResend() {
  const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ id: 'correo-anexo' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', f)
  return f
}
const correoDe = (f: ReturnType<typeof simularResend>, i = 0) => {
  const [url, init] = f.mock.calls[i]
  return { url: String(url), body: JSON.parse(String(init!.body)) as { to: string[]; subject: string; html: string } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Anexo: planilla de comprobación de la entrega', () => {
  let p: Prueba
  /** Sesión de cada usuario de la prueba (A01). */
  const tk: Record<string, string> = {}

  // Lo que cada paso deja para los siguientes.
  let hamburguesa: Producto // B01
  let heladera: Maquina // B02
  let espejo: TareaLimpieza // B03
  let sanLorenzo: Sucursal // B04
  let registro: Produccion // C01
  let horaRegistro: string
  let envioEmpanadas: RespuestaEnvio // D03
  let harina: LoteMP // E01
  let chipas: Produccion // E02
  let lote: string // E03
  let envioChipas: RespuestaEnvio // E05
  let conFallas: Lectura // F01
  let conFoto: Lectura // F03
  let lecturaRoja: Lectura // F04
  let limpieza: Limpieza // G01
  let horaLimpieza: string
  let tareasSanitario: number
  let reporteDelDia: Reporte // H01

  /** Pedido a la API; después el reloj avanza un minuto (así cada registro tiene su hora). */
  async function pedir<T = any>(token: string | null, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {
    const r = await p.pedir<T>(token, metodo, ruta, cuerpo)
    ponerReloj(reloj + 60_000)
    return r
  }

  /** Stock en frío del sector del operador, por producto. */
  async function stock(token: string): Promise<Map<string, StockFila>> {
    const r = await pedir<StockFila[]>(token, 'GET', '/stock')
    expect(r.status).toBe(200)
    return new Map(r.body.map((f) => [f.productoId, f]))
  }
  const stockDe = async (token: string, producto: string) => (await stock(token)).get(producto)?.total ?? 0

  beforeAll(async () => {
    ponerReloj(reloj)
    p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  // ---------- A. Usuarios y accesos ----------

  it('A01 · cada persona entra con su usuario y contraseña; con la contraseña incorrecta no entra', async () => {
    for (const usuario of ['chiperia', 'chipitas', 'panaderia', 'cocina', 'admin'] as const) {
      const r = await pedir<RespuestaLogin>(null, 'POST', '/auth/login', { usuario, clave: CLAVE_DEMO })
      expect(r.status, usuario).toBe(200)
      expect(r.body.usuario).toMatchObject({ usuario, rol: usuario, activo: true })
      tk[usuario] = r.body.token
      const yo = await pedir<Usuario>(r.body.token, 'GET', '/auth/yo')
      expect(yo.body.usuario).toBe(usuario)
    }
    const mal = await pedir(null, 'POST', '/auth/login', { usuario: 'cocina', clave: '12345' })
    expect(mal.status).toBe(401)
    expect(mal.body.error.codigo).toBe('credenciales')
    // Mismo mensaje si el usuario no existe: no se revela quién tiene cuenta.
    const nadie = await pedir(null, 'POST', '/auth/login', { usuario: 'nadie', clave: CLAVE_DEMO })
    expect(nadie.status).toBe(401)
    expect(nadie.body.error.mensaje).toBe(mal.body.error.mensaje)
    expect((await pedir(null, 'GET', '/producciones')).status).toBe(401)
  })

  it('A02 · hay 5 roles: los 4 sectores y el administrador', async () => {
    const r = await pedir<Usuario[]>(tk.admin, 'GET', '/usuarios')
    expect(r.status).toBe(200)
    expect([...new Set(r.body.map((u) => u.rol))].sort()).toEqual([...ROLES].sort())
    expect(ROLES).toEqual([...SECTOR_IDS, 'admin'])
    const sectores = await pedir<Sector[]>(tk.admin, 'GET', '/sectores')
    expect(sectores.body.map((s) => s.id)).toEqual(SECTOR_IDS)
    expect((await pedir(tk.cocina, 'GET', '/usuarios')).status).toBe(403)
  })

  it('A03 · el Sector 2 (Chipitas) no ve los datos del Sector 3 (Panadería)', async () => {
    // Panadería carga algo, así hay datos del otro sector para buscar.
    const pan = await pedir<Produccion>(tk.panaderia, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: PAN, cocinado: 40, guardado: 0 }],
    })
    expect(pan.status).toBe(200)

    for (const ruta of ['/producciones', '/stock', '/movimientos', '/lecturas', '/limpiezas', '/productos', '/maquinas', '/areas']) {
      const r = await pedir(tk.chipitas, 'GET', `${ruta}?sector=panaderia`)
      expect(r.status, ruta).toBe(403)
      expect(r.body.error.codigo).toBe('prohibido')
    }
    // Sin filtro, cada listado trae solo lo suyo.
    expect((await pedir<Produccion[]>(tk.chipitas, 'GET', '/producciones')).body).toEqual([])
    const productos = await pedir<Producto[]>(tk.chipitas, 'GET', '/productos')
    expect(productos.body.length).toBeGreaterThan(0)
    expect(productos.body.every((x) => x.sector === 'chipitas')).toBe(true)
    // Tampoco puede cargar en el otro sector ni ver los lotes de Chipería.
    const ajeno = { turno: 'dia', items: [{ productoId: PAN, cocinado: 1, guardado: 0 }] }
    expect((await pedir(tk.chipitas, 'POST', '/producciones', { ...ajeno, sector: 'panaderia' })).status).toBe(403)
    expect((await pedir(tk.chipitas, 'POST', '/producciones', ajeno)).status).toBe(400)
    expect((await pedir(tk.chipitas, 'GET', '/lotes-mp')).status).toBe(403)
    // El administrador sí lo ve.
    const admin = await pedir<Produccion[]>(tk.admin, 'GET', '/producciones?sector=panaderia')
    expect(admin.body.map((x) => x.id)).toEqual([pan.body.id])
  })

  it('A04 · el administrador crea un usuario, le restablece la contraseña y lo desactiva', async () => {
    expect((await pedir(tk.cocina, 'POST', '/usuarios', { nombre: 'X', usuario: 'xx', rol: 'cocina', clave: 'inicio123' })).status).toBe(403)
    const nuevo = await pedir<Usuario>(tk.admin, 'POST', '/usuarios', {
      nombre: 'Ayudante de cocina', usuario: 'ayudante', rol: 'cocina', clave: 'inicio123',
    })
    expect(nuevo.status).toBe(200)
    expect(nuevo.body).toMatchObject({ usuario: 'ayudante', rol: 'cocina', activo: true, debeCambiarClave: true })
    const primera = await pedir<RespuestaLogin>(null, 'POST', '/auth/login', { usuario: 'ayudante', clave: 'inicio123' })
    expect(primera.status).toBe(200)

    // Contraseña restablecida: la vieja ya no entra, la nueva sí (y pide cambiarla).
    expect((await pedir(tk.admin, 'POST', `/usuarios/${nuevo.body.id}/clave`, { clave: 'nueva456' })).status).toBe(200)
    expect((await pedir(null, 'POST', '/auth/login', { usuario: 'ayudante', clave: 'inicio123' })).status).toBe(401)
    const conNueva = await pedir<RespuestaLogin>(null, 'POST', '/auth/login', { usuario: 'ayudante', clave: 'nueva456' })
    expect(conNueva.status).toBe(200)
    expect(conNueva.body.usuario.debeCambiarClave).toBe(true)
    expect((await pedir(primera.body.token, 'GET', '/auth/yo')).status).toBe(401)
    // La cambia por una propia y ya puede usar el sistema.
    const propia = await pedir<{ token: string }>(conNueva.body.token, 'POST', '/auth/clave', { actual: 'nueva456', nueva: 'propia789' })
    expect(propia.status).toBe(200)
    expect((await pedir(propia.body.token, 'GET', '/producciones')).status).toBe(200)

    // Desactivado: no puede entrar y la sesión que tenía abierta se cierra.
    const baja = await pedir<Usuario>(tk.admin, 'PATCH', `/usuarios/${nuevo.body.id}`, { activo: false })
    expect(baja.body.activo).toBe(false)
    const r = await pedir(null, 'POST', '/auth/login', { usuario: 'ayudante', clave: 'propia789' })
    expect(r.status).toBe(403)
    expect(r.body.error.codigo).toBe('usuario_inactivo')
    expect((await pedir(propia.body.token, 'GET', '/auth/yo')).status).toBe(401)
    // Nada se borra: sigue en la lista, desactivado.
    const lista = await pedir<Usuario[]>(tk.admin, 'GET', '/usuarios')
    expect(lista.body.find((u) => u.usuario === 'ayudante')).toMatchObject({ activo: false })
  })

  it.todo('A05 · abrir el sistema en un Android, un iPhone y una computadora (manual: es una web app, no se instala)')

  // ---------- B. Catálogos ----------

  it('B01 · un producto nuevo con el nombre cambiado aparece con el nombre nuevo al registrar producción', async () => {
    const alta = await pedir<Producto>(tk.admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Hamburgesa casera' })
    expect(alta.status).toBe(200)
    const r = await pedir<Producto>(tk.admin, 'PATCH', `/productos/${alta.body.id}`, { nombre: 'Hamburguesa casera' })
    expect(r.status).toBe(200)
    hamburguesa = r.body
    // La lista de la pantalla de producción de Cocina.
    const lista = await pedir<Producto[]>(tk.cocina, 'GET', '/productos')
    expect(lista.body.find((x) => x.id === hamburguesa.id)).toMatchObject({ nombre: 'Hamburguesa casera', sector: 'cocina', activo: true })
    expect(lista.body.map((x) => x.nombre)).not.toContain('Hamburgesa casera')
    expect((await pedir<Producto[]>(tk.chipitas, 'GET', '/productos')).body.some((x) => x.id === hamburguesa.id)).toBe(false)
  })

  it('B02 · una heladera de 0 °C a 5 °C aparece en su sector con ese rango', async () => {
    const r = await pedir<Maquina>(tk.admin, 'POST', '/maquinas', {
      sector: 'cocina', nombre: 'Heladera de prueba', tipo: 'heladera', tempMin: 0, tempMax: 5,
    })
    expect(r.status).toBe(200)
    heladera = r.body
    expect(heladera).toMatchObject({ sector: 'cocina', tipo: 'heladera', tempMin: 0, tempMax: 5, activo: true })
    const deCocina = await pedir<Maquina[]>(tk.cocina, 'GET', '/maquinas')
    expect(deCocina.body.find((m) => m.id === heladera.id)).toMatchObject({ nombre: 'Heladera de prueba', tempMin: 0, tempMax: 5 })
    expect((await pedir<Maquina[]>(tk.chiperia, 'GET', '/maquinas')).body.some((m) => m.id === heladera.id)).toBe(false)
  })

  it('B03 · una tarea de limpieza nueva aparece en la lista al reportar una limpieza', async () => {
    const r = await pedir<TareaLimpieza>(tk.admin, 'POST', '/areas/sanitario/tareas', { nombre: 'Espejo' })
    expect(r.status).toBe(200)
    espejo = r.body
    const areas = await pedir<AreaLimpieza[]>(tk.cocina, 'GET', '/areas')
    const sanitario = areas.body.find((a) => a.id === 'sanitario')!
    expect(sanitario.tareas.map((t) => t.nombre)).toContain('Espejo')
    expect(sanitario.tareas.at(-1)!.id).toBe(espejo.id)
  })

  it('B04 · una sucursal nueva aparece como destino al registrar un envío', async () => {
    const r = await pedir<Sucursal>(tk.admin, 'POST', '/sucursales', { nombre: 'Sucursal San Lorenzo' })
    expect(r.status).toBe(200)
    sanLorenzo = r.body
    for (const quien of ['cocina', 'chiperia']) {
      const lista = await pedir<Sucursal[]>(tk[quien], 'GET', '/sucursales')
      expect(lista.body.map((s) => s.id)).toContain(sanLorenzo.id)
    }
  })

  // ---------- C. Producción ----------

  it('C01 · 38 empanadas, 15 marineras y 3 hamburguesas quedan en un solo registro', async () => {
    horaRegistro = ahoraIso()
    const r = await pedir<Produccion>(tk.cocina, 'POST', '/producciones', {
      turno: 'dia',
      items: [
        { productoId: EMPANADA, cocinado: 30, guardado: 8 },
        { productoId: MARINERA, cocinado: 15, guardado: 0 },
        { productoId: hamburguesa.id, cocinado: 3, guardado: 0 },
      ],
    })
    expect(r.status).toBe(200)
    registro = r.body
    expect(registro.items.map((i) => [i.productoNombre, i.cocinado + i.guardado])).toEqual([
      ['Empanada frita (carne)', 38], ['Marinera de carne', 15], ['Hamburguesa casera', 3],
    ])
    const delDia = await pedir<Produccion[]>(tk.cocina, 'GET', `/producciones?desde=${DIA}&hasta=${DIA}`)
    expect(delDia.body.map((x) => x.id)).toEqual([registro.id])
  })

  it('C02 · de las 38 empanadas se guardan 30 cocinadas y 8 guardadas', async () => {
    const [leido] = (await pedir<Produccion[]>(tk.cocina, 'GET', '/producciones')).body
    expect(leido.items.find((i) => i.productoId === EMPANADA)).toMatchObject({ cocinado: 30, guardado: 8 })
  })

  it('C03 · el registro tiene fecha, hora y usuario sin cargarlos a mano', async () => {
    const [leido] = (await pedir<Produccion[]>(tk.cocina, 'GET', '/producciones')).body
    expect(leido).toMatchObject({
      id: registro.id, fecha: horaRegistro, dia: DIA, turno: 'dia', usuarioId: 'usr-cocina', usuarioNombre: 'Encargado Cocina',
    })
    expect(relojParaguay(leido.fecha)).toMatch(/^14\/10\/2026 09:\d\d$/)
  })

  it('C04 · el administrador corrige una cantidad y queda anotado quién y cuándo', async () => {
    const correccion = { items: [{ productoId: MARINERA, cocinado: 14, guardado: 0 }] }
    expect((await pedir(tk.cocina, 'PATCH', `/producciones/${registro.id}`, correccion)).status).toBe(403)
    const cuando = ahoraIso()
    const r = await pedir<Produccion>(tk.admin, 'PATCH', `/producciones/${registro.id}`, correccion)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ corregidoPor: 'usr-admin', corregidoPorNombre: 'Administración', corregidoEn: cuando })
    // Solo cambia lo que vino en la corrección: lo demás del registro queda igual.
    expect(r.body.items.map((i) => [i.productoId, i.cocinado, i.guardado])).toEqual([
      [EMPANADA, 30, 8], [MARINERA, 14, 0], [hamburguesa.id, 3, 0],
    ])
    registro = r.body
    const aud = await pedir<Auditoria[]>(tk.admin, 'GET', `/auditoria?tabla=producciones&desde=${DIA}&hasta=${DIA}`)
    expect(aud.body[0]).toMatchObject({ registroId: registro.id, accion: 'corregir', usuarioNombre: 'Administración', fecha: cuando })
    const antes = JSON.parse(aud.body[0].antes!) as { items: { productoId: string; cocinado: number }[] }
    expect(antes.items.find((i) => i.productoId === MARINERA)!.cocinado).toBe(15)
  })

  // ---------- D. Stock en frío y sucursales ----------

  it('D01 · en el stock en frío hay 8 empanadas', async () => {
    const s = await stock(tk.cocina)
    expect(s.get(EMPANADA)).toMatchObject({ productoNombre: 'Empanada frita (carne)', total: 8, lotes: [] })
    expect(s.get(MARINERA)!.total).toBe(0)
  })

  it('D02 · sacar 3 empanadas para reponer la venta deja 5', async () => {
    const r = await pedir<Movimiento>(tk.cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 3 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ tipo: 'salida_venta', cantidad: -3, lote: null, usuarioNombre: 'Encargado Cocina', dia: DIA })
    expect(await stockDe(tk.cocina, EMPANADA)).toBe(5)
  })

  it('D03 · enviar 2 empanadas a una sucursal queda registrado y deja 3', async () => {
    const r = await pedir<RespuestaEnvio>(tk.cocina, 'POST', '/envios', {
      sucursalId: sanLorenzo.id, items: [{ productoId: EMPANADA, cantidad: 2 }],
    })
    expect(r.status).toBe(200)
    envioEmpanadas = r.body
    expect(r.body.movimientos).toHaveLength(1)
    expect(r.body.movimientos[0]).toMatchObject({
      tipo: 'envio', cantidad: -2, productoNombre: 'Empanada frita (carne)', sucursalId: sanLorenzo.id,
      sucursalNombre: 'Sucursal San Lorenzo', envioId: r.body.envioId, usuarioNombre: 'Encargado Cocina', dia: DIA,
    })
    expect(await stockDe(tk.cocina, EMPANADA)).toBe(3)
  })

  it('D04 · no deja enviar 10 empanadas', async () => {
    const r = await pedir(tk.cocina, 'POST', '/envios', { sucursalId: sanLorenzo.id, items: [{ productoId: EMPANADA, cantidad: 10 }] })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('stock_insuficiente')
    expect(r.body.error.mensaje).toMatch(/hay 3 y querés sacar 10/)
    // Un envío con una línea que no alcanza no registra ninguna.
    const mixto = await pedir(tk.cocina, 'POST', '/envios', {
      sucursalId: sanLorenzo.id, items: [{ productoId: EMPANADA, cantidad: 1 }, { productoId: MARINERA, cantidad: 5 }],
    })
    expect(mixto.status).toBe(409)
    expect((await pedir(tk.cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 4 })).status).toBe(409)
    expect(await stockDe(tk.cocina, EMPANADA)).toBe(3)
    expect((await pedir<Movimiento[]>(tk.cocina, 'GET', '/movimientos?tipo=envio')).body).toHaveLength(1)
  })

  it('D05 · el historial de salidas filtrado por sucursal y fecha trae solo lo que cumple el filtro', async () => {
    const r = await pedir<Movimiento[]>(tk.cocina, 'GET', `/movimientos?sucursal=${sanLorenzo.id}&desde=${DIA}&hasta=${DIA}`)
    expect(r.body.map((m) => m.id)).toEqual([envioEmpanadas.movimientos[0].id])
    const salidas = await pedir<Movimiento[]>(tk.cocina, 'GET', `/movimientos?tipo=salida_venta,envio&desde=${DIA}&hasta=${DIA}`)
    expect(salidas.body.map((m) => [m.tipo, m.cantidad])).toEqual([['envio', -2], ['salida_venta', -3]])
    const ayer = sumarDias(DIA, -1)
    expect((await pedir(tk.cocina, 'GET', `/movimientos?desde=${ayer}&hasta=${ayer}`)).body).toEqual([])
    expect((await pedir(tk.cocina, 'GET', '/movimientos?sucursal=suc-centro')).body).toEqual([])
    expect((await pedir(tk.cocina, 'GET', `/movimientos?producto=${MARINERA}`)).body).toEqual([])
  })

  it('D06 · una merma de 1 empanada con su motivo deja 2 y figura en el historial', async () => {
    const merma = { sector: 'cocina', productoId: EMPANADA, tipo: 'merma', cantidad: 1, motivo: 'Se rompió al sacarla del frío' }
    expect((await pedir(tk.cocina, 'POST', '/ajustes', merma)).status).toBe(403)
    expect((await pedir(tk.admin, 'POST', '/ajustes', { ...merma, motivo: '' })).status).toBe(400)
    const r = await pedir<Movimiento>(tk.admin, 'POST', '/ajustes', merma)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ tipo: 'merma', cantidad: -1, motivo: merma.motivo, usuarioNombre: 'Administración' })
    expect(await stockDe(tk.cocina, EMPANADA)).toBe(2)
    const historial = await pedir<Movimiento[]>(tk.cocina, 'GET', `/movimientos?producto=${EMPANADA}`)
    expect(historial.body.map((m) => [m.tipo, m.cantidad, m.motivo])).toEqual([
      ['merma', -1, merma.motivo], ['envio', -2, null], ['salida_venta', -3, null], ['produccion', 8, null],
    ])
  })

  it('D07 · el stock inicial de otro producto aparece en el stock en frío', async () => {
    const r = await pedir<Movimiento>(tk.admin, 'POST', '/ajustes', {
      sector: 'cocina', productoId: CROQUETE, tipo: 'stock_inicial', cantidad: 20, motivo: 'Stock en frío al empezar a usar el sistema',
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ tipo: 'stock_inicial', cantidad: 20 })
    const s = await stock(tk.cocina)
    expect(s.get(CROQUETE)).toMatchObject({ productoNombre: 'Croquete de carne', total: 20 })
    expect(s.get(EMPANADA)!.total).toBe(2)
  })

  // ---------- E. Chipería y lotes ----------

  it('E01 · un lote de harina con cantidad y vencimiento queda disponible para elegir', async () => {
    const r = await pedir<LoteMP>(tk.chiperia, 'POST', '/lotes-mp', {
      insumo: 'Harina', proveedor: 'Molinos del Sur', numeroLote: 'H-1014', fechaIngreso: DIA,
      cantidad: 50, unidad: 'kg', vencimiento: sumarDias(DIA, 90),
    })
    expect(r.status).toBe(200)
    harina = r.body
    expect(harina).toMatchObject({ cantidad: 50, unidad: 'kg', bloqueado: false, disponible: true, descripcion: 'Harina · Molinos del Sur · lote H-1014' })
    const disponibles = await pedir<LoteMP[]>(tk.chiperia, 'GET', '/lotes-mp?disponibles=1')
    expect(disponibles.body.map((l) => l.id)).toContain(harina.id)
  })

  it('E02 · las chipas registradas eligiendo ese lote quedan ligadas a la harina', async () => {
    const items = [{ productoId: CHIPA, cocinado: 200, guardado: 300 }]
    expect((await pedir(tk.chiperia, 'POST', '/producciones', { turno: 'dia', items })).status).toBe(400)
    const r = await pedir<Produccion>(tk.chiperia, 'POST', '/producciones', { turno: 'dia', items, lotesMP: [harina.id] })
    expect(r.status).toBe(200)
    chipas = r.body
    expect(chipas.lote!.lotesMP).toEqual([{ id: harina.id, descripcion: harina.descripcion }])
  })

  it('E03 · esa producción de chipas tiene su propio número de lote', async () => {
    const [leida] = (await pedir<Produccion[]>(tk.chiperia, 'GET', `/producciones?desde=${DIA}&hasta=${DIA}`)).body
    expect(leida.id).toBe(chipas.id)
    expect(leida.lote).toMatchObject({ codigo: 'CH-261014-1', amasada: 1, produccionId: chipas.id })
    lote = leida.lote!.codigo
    const movs = await pedir<Movimiento[]>(tk.chiperia, 'GET', `/movimientos?lote=${lote}`)
    expect(movs.body.map((m) => [m.tipo, m.cantidad, m.produccionId])).toEqual([['produccion', 300, chipas.id]])
  })

  it('E04 · se guardan 200 chipas al horno y 300 al congelador', async () => {
    expect(chipas.items).toEqual([{ productoId: CHIPA, productoNombre: 'Chipa tradicional', cocinado: 200, guardado: 300 }])
    const lotes = await pedir<LoteChipa[]>(tk.chiperia, 'GET', `/lotes-chipa?desde=${DIA}&hasta=${DIA}`)
    expect(lotes.body.map((l) => [l.codigo, l.horno, l.congelador, l.stock])).toEqual([[lote, 200, 300, 300]])
  })

  it('E05 · enviar 100 chipas de ese lote indica el lote y el stock del lote baja a 200', async () => {
    // En Chipería el envío tiene que decir de qué lote sale.
    const sinLote = await pedir(tk.chiperia, 'POST', '/envios', { sucursalId: sanLorenzo.id, items: [{ productoId: CHIPA, cantidad: 100 }] })
    expect(sinLote.status).toBe(400)
    const r = await pedir<RespuestaEnvio>(tk.chiperia, 'POST', '/envios', {
      sucursalId: sanLorenzo.id, items: [{ productoId: CHIPA, lote, cantidad: 100 }],
    })
    expect(r.status).toBe(200)
    envioChipas = r.body
    expect(r.body.movimientos[0]).toMatchObject({ tipo: 'envio', lote, cantidad: -100, sucursalNombre: 'Sucursal San Lorenzo' })
    const s = await stock(tk.chiperia)
    expect(s.get(CHIPA)).toMatchObject({ total: 200, lotes: [{ lote, cantidad: 200 }] })
    const lotes = await pedir<LoteChipa[]>(tk.chiperia, 'GET', '/lotes-chipa')
    expect(lotes.body.find((l) => l.codigo === lote)!.stock).toBe(200)
  })

  it('E06 · la trazabilidad va de la harina al lote de chipa y la sucursal, y al revés', async () => {
    const mp = await pedir<TrazabilidadMP>(tk.chiperia, 'GET', `/trazabilidad/mp/${harina.id}`)
    expect(mp.body.lotesChipa.map((l) => l.codigo)).toEqual([lote])
    expect(mp.body.envios.map((m) => [m.sucursalNombre, m.lote, m.cantidad])).toEqual([['Sucursal San Lorenzo', lote, -100]])

    // Desde la sucursal: solo los envíos de Chipería (el de empanadas no), sus lotes y la harina.
    const suc = await pedir<TrazabilidadSucursal>(tk.chiperia, 'GET', `/trazabilidad/sucursal/${sanLorenzo.id}?desde=${DIA}&hasta=${DIA}`)
    expect(suc.body.envios.map((m) => m.id)).toEqual([envioChipas.movimientos[0].id])
    expect(suc.body.lotesChipa.map((l) => l.codigo)).toEqual([lote])
    expect(suc.body.lotesMP.map((l) => l.id)).toEqual([harina.id])

    // Desde el código del lote (escrito en minúsculas), hacia los dos lados.
    const lc = await pedir<TrazabilidadLote>(tk.chiperia, 'GET', `/trazabilidad/lote/${lote.toLowerCase()}`)
    expect(lc.body.lote.lotesMP.map((x) => x.id)).toEqual([harina.id])
    expect(lc.body.produccion!.id).toBe(chipas.id)
    expect(lc.body.envios.map((m) => m.sucursalId)).toEqual([sanLorenzo.id])

    expect((await pedir(tk.cocina, 'GET', `/trazabilidad/sucursal/${sanLorenzo.id}`)).status).toBe(403)
  })

  it('E07 · un lote de materia prima bloqueado deja de aparecer para elegir', async () => {
    expect((await pedir(tk.chiperia, 'PATCH', `/lotes-mp/${harina.id}`, { bloqueado: true })).status).toBe(403)
    const r = await pedir<LoteMP>(tk.admin, 'PATCH', `/lotes-mp/${harina.id}`, { bloqueado: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ bloqueado: true, disponible: false })
    const disponibles = await pedir<LoteMP[]>(tk.chiperia, 'GET', '/lotes-mp?disponibles=1')
    expect(disponibles.body.map((l) => l.id)).not.toContain(harina.id)
    const otra = await pedir(tk.chiperia, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: CHIPA, cocinado: 10, guardado: 0 }], lotesMP: [harina.id],
    })
    expect(otra.status).toBe(409)
    expect(otra.body.error.codigo).toBe('lote_mp_no_disponible')
    // Nada se borra: sigue en la lista completa.
    const todos = await pedir<LoteMP[]>(tk.chiperia, 'GET', '/lotes-mp')
    expect(todos.body.find((l) => l.id === harina.id)).toMatchObject({ bloqueado: true })
  })

  // ---------- F. Máquinas ----------

  it('F01 · una máquina con fallas y una observación queda registrada', async () => {
    const lectura = { maquinaId: HORNO_COCINA, momento: 'inicio', estado: 'con_fallas', temperatura: null, observacion: 'Tarda en calentar' }
    expect((await pedir(tk.chiperia, 'POST', '/lecturas', lectura)).status).toBe(403)
    const r = await pedir<Lectura>(tk.cocina, 'POST', '/lecturas', lectura)
    expect(r.status).toBe(200)
    conFallas = r.body
    expect(conFallas).toMatchObject({ maquinaNombre: 'Horno', estado: 'con_fallas', observacion: 'Tarda en calentar', dia: DIA })
    const lista = await pedir<Lectura[]>(tk.cocina, 'GET', '/lecturas?conFallas=1')
    expect(lista.body.map((l) => l.id)).toEqual([conFallas.id])
  })

  it('F02 · la heladera sin temperatura no se deja guardar', async () => {
    const r = await pedir(tk.cocina, 'POST', '/lecturas', { maquinaId: heladera.id, momento: 'inicio', estado: 'funciona', temperatura: null })
    expect(r.status).toBe(400)
    expect(r.body.error.mensaje).toMatch(/temperatura/)
    expect((await pedir(tk.cocina, 'GET', `/lecturas?maquina=${heladera.id}`)).body).toEqual([])
  })

  it('F03 · la foto se sube y se ve en el reporte', async () => {
    const r = await pedir<Lectura>(tk.cocina, 'POST', '/lecturas', {
      maquinaId: heladera.id, momento: 'inicio', estado: 'funciona', temperatura: 3, observacion: 'Foto del termómetro', foto: JPEG_1PX,
    })
    expect(r.status).toBe(200)
    conFoto = r.body
    expect(conFoto).toMatchObject({ tieneFoto: true, temperatura: 3, fueraDeRango: false })
    for (const quien of ['cocina', 'admin']) {
      const foto = await pedir<{ dataUrl: string }>(tk[quien], 'GET', `/lecturas/${conFoto.id}/foto`)
      expect(foto.body.dataUrl, quien).toBe(JPEG_1PX)
    }
    expect((await pedir(tk.chiperia, 'GET', `/lecturas/${conFoto.id}/foto`)).status).toBe(403)
  })

  it('F04 · 9 °C en la heladera de 0 °C a 5 °C marca el reporte en rojo', async () => {
    const r = await pedir<Lectura>(tk.cocina, 'POST', '/lecturas', {
      maquinaId: heladera.id, momento: 'fin', estado: 'funciona', temperatura: 9, observacion: 'Quedó la puerta abierta',
    })
    expect(r.status).toBe(200)
    lecturaRoja = r.body
    expect(lecturaRoja).toMatchObject({ temperatura: 9, fueraDeRango: true })
    const rojas = await pedir<Lectura[]>(tk.admin, 'GET', `/lecturas?fueraDeRango=1&desde=${DIA}&hasta=${DIA}`)
    expect(rojas.body.map((l) => l.id)).toEqual([lecturaRoja.id])
  })

  it('F05 · el historial de la heladera muestra fecha, usuario, temperatura, observación y foto', async () => {
    const r = await pedir<Lectura[]>(tk.cocina, 'GET', `/lecturas?maquina=${heladera.id}`)
    const vista = r.body.map((l) => ({
      fecha: l.fecha, usuario: l.usuarioNombre, temperatura: l.temperatura, observacion: l.observacion, foto: l.tieneFoto, rojo: l.fueraDeRango,
    }))
    expect(vista).toEqual([
      { fecha: lecturaRoja.fecha, usuario: 'Encargado Cocina', temperatura: 9, observacion: 'Quedó la puerta abierta', foto: false, rojo: true },
      { fecha: conFoto.fecha, usuario: 'Encargado Cocina', temperatura: 3, observacion: 'Foto del termómetro', foto: true, rojo: false },
    ])
  })

  // ---------- G. Limpieza ----------

  it('G01 · una limpieza con 3 tareas marcadas deja registradas las 3', async () => {
    const areas = await pedir<AreaLimpieza[]>(tk.cocina, 'GET', '/areas')
    const sanitario = areas.body.find((a) => a.id === 'sanitario')!
    tareasSanitario = sanitario.tareas.length
    // Como en la planilla en papel no se dejan cuadros en blanco: lo que no se hizo va con «-».
    const incompleta = await pedir(tk.cocina, 'POST', '/limpiezas', { areaId: 'sanitario', marcas: [{ tareaId: espejo.id, marca: 'X' }] })
    expect(incompleta.status).toBe(400)
    const hechas = new Map([['Piso', 'X'], ['Lavamanos', 'X'], ['Espejo', 'XX']])
    horaLimpieza = ahoraIso()
    const r = await pedir<Limpieza>(tk.cocina, 'POST', '/limpiezas', {
      areaId: 'sanitario',
      marcas: sanitario.tareas.map((t) => ({ tareaId: t.id, marca: hechas.get(t.nombre) ?? '-' })),
      comentario: 'Faltó reponer el jabón',
    })
    expect(r.status).toBe(200)
    limpieza = r.body
    expect(limpieza.marcas).toHaveLength(tareasSanitario)
    expect(limpieza.marcas.filter((m) => m.marca !== '-').map((m) => [m.tareaNombre, m.marca])).toEqual([
      ['Piso', 'X'], ['Lavamanos', 'X'], ['Espejo', 'XX'],
    ])
  })

  it('G02 · el reporte de limpieza tiene fecha, hora, sector y usuario automáticos, y el comentario', async () => {
    const [leida] = (await pedir<Limpieza[]>(tk.cocina, 'GET', '/limpiezas')).body
    expect(leida).toMatchObject({
      id: limpieza.id, areaNombre: 'Sanitario', sector: 'cocina', usuarioId: 'usr-cocina', usuarioNombre: 'Encargado Cocina',
      fecha: horaLimpieza, dia: DIA, comentario: 'Faltó reponer el jabón', controladoPor: null,
    })
  })

  it('G03 · el historial de limpiezas filtrado por sector y fecha trae las que cumplen el filtro', async () => {
    const r = await pedir<Limpieza[]>(tk.admin, 'GET', `/limpiezas?sector=cocina&desde=${DIA}&hasta=${DIA}`)
    expect(r.body.map((l) => l.id)).toEqual([limpieza.id])
    expect((await pedir(tk.admin, 'GET', `/limpiezas?sector=panaderia&desde=${DIA}&hasta=${DIA}`)).body).toEqual([])
    expect((await pedir(tk.admin, 'GET', `/limpiezas?sector=cocina&desde=${MANIANA}`)).body).toEqual([])
    expect((await pedir(tk.panaderia, 'GET', '/limpiezas')).body).toEqual([])
  })

  // ---------- H. Reportes del administrador ----------

  it('H01 · el reporte del día muestra producción, cocinado y guardado, stock, envíos y lotes de la prueba', async () => {
    expect((await pedir(tk.cocina, 'GET', `/reportes?desde=${DIA}&hasta=${DIA}`)).status).toBe(403)
    const r = await pedir<Reporte>(tk.admin, 'GET', `/reportes?desde=${DIA}&hasta=${DIA}`)
    expect(r.status).toBe(200)
    reporteDelDia = r.body
    const rep = r.body
    expect(rep.produccion.map((f) => [f.sector, f.productoNombre, f.cocinado, f.guardado])).toEqual([
      ['chiperia', 'Chipa tradicional', 200, 300],
      ['panaderia', 'Pan felipe (ejemplo)', 40, 0],
      ['cocina', 'Empanada frita (carne)', 30, 8],
      ['cocina', 'Marinera de carne', 14, 0],
      ['cocina', 'Hamburguesa casera', 3, 0],
    ])
    expect(rep.stock.map((f) => [f.sector, f.productoNombre, f.total])).toEqual([
      ['chiperia', 'Chipa tradicional', 200],
      ['cocina', 'Croquete de carne', 20],
      ['cocina', 'Empanada frita (carne)', 2],
    ])
    expect(rep.envios.map((f) => [f.sucursalNombre, f.productoNombre, f.cantidad])).toEqual([
      ['Sucursal San Lorenzo', 'Chipa tradicional', 100],
      ['Sucursal San Lorenzo', 'Empanada frita (carne)', 2],
    ])
    expect(rep.salidas.map((f) => [f.sector, f.tipo, f.cantidad])).toEqual([
      ['chiperia', 'envio', 100],
      ['cocina', 'salida_venta', 3],
      ['cocina', 'envio', 2],
      ['cocina', 'merma', 1],
    ])
    expect(rep.lotesChipa.map((l) => [l.codigo, l.horno, l.congelador, l.stock, l.lotesMP.map((m) => m.descripcion)])).toEqual([
      [lote, 200, 300, 200, [harina.descripcion]],
    ])
    expect(rep.totales).toMatchObject({
      cargasProduccion: 3, unidadesCocinadas: 287, unidadesGuardadas: 308, unidadesEnviadas: 102,
    })
  })

  it('H02 · el mismo reporte incluye la temperatura fuera de rango de F04 y la limpieza de G01', async () => {
    const rep = reporteDelDia
    expect(rep.temperaturasFueraDeRango.map((l) => [l.id, l.maquinaNombre, l.temperatura])).toEqual([
      [lecturaRoja.id, 'Heladera de prueba', 9],
    ])
    expect(rep.maquinasConFallas.map((l) => l.id)).toEqual([conFallas.id])
    expect(rep.limpiezas).toEqual([
      { sector: 'cocina', areaNombre: 'Sanitario', cantidad: 1, sinControlar: 1, tareasNoHechas: tareasSanitario - 3 },
    ])
    expect(rep.totales).toMatchObject({ temperaturasFueraDeRango: 1, limpiezas: 1, limpiezasSinControlar: 1 })
  })

  it('H03 · un reporte por rango de fechas trae los datos (el Excel se arma en el navegador con ellos)', async () => {
    const desde = sumarDias(DIA, -6)
    const r = await pedir<Reporte>(tk.admin, 'GET', `/reportes?desde=${desde}&hasta=${DIA}`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ desde, hasta: DIA })
    expect(r.body.produccion).toEqual(reporteDelDia.produccion)
    expect(r.body.totales).toEqual(reporteDelDia.totales)
    // Por sector: solo lo de Cocina, sin lotes de Chipería.
    const cocina = await pedir<Reporte>(tk.admin, 'GET', `/reportes?desde=${desde}&hasta=${DIA}&sector=cocina`)
    expect(cocina.body.produccion.every((f) => f.sector === 'cocina')).toBe(true)
    expect(cocina.body.lotesChipa).toEqual([])
    expect(cocina.body.totales.unidadesEnviadas).toBe(2)
    expect((await pedir(tk.admin, 'GET', `/reportes?desde=${DIA}&hasta=${desde}`)).status).toBe(400)
  })

  it('H04 · el resumen de prueba llega al correo del administrador con el enlace al reporte completo', async () => {
    const cfg = await pedir<Configuracion>(tk.admin, 'PATCH', '/config', { correoReportes: 'Admin@ChipaTia.com', urlPublica: 'https://chipatia.com/' })
    expect(cfg.body).toEqual({ correoReportes: 'admin@chipatia.com', urlPublica: 'https://chipatia.com' })
    const f = simularResend()
    const r = await pedir<ResumenCorreo>(tk.admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enviado: true, destino: 'admin@chipatia.com' })
    expect(f).toHaveBeenCalledTimes(1)
    const correo = correoDe(f)
    expect(correo.url).toBe('https://api.resend.com/emails')
    expect(correo.body.to).toEqual(['admin@chipatia.com'])
    // El resumen diario cubre el día anterior (el de las 06:00 de mañana traerá el de la prueba: ver I04).
    const { desde, hasta } = rangoResumen('diario', DIA)
    expect(desde).toBe(sumarDias(DIA, -1))
    expect(correo.body.html).toContain(`href="https://chipatia.com/#/admin/reportes?desde=${desde}&amp;hasta=${hasta}"`)
    // El enlace abre la pantalla de reportes, que pide este mismo reporte.
    const completo = await pedir<Reporte>(tk.admin, 'GET', `/reportes?desde=${desde}&hasta=${hasta}`)
    expect(completo.status).toBe(200)
    expect(completo.body).toMatchObject({ desde, hasta })
    expect((await pedir(tk.cocina, 'POST', '/reportes/enviar', { periodo: 'diario' })).status).toBe(403)
  })

  // ---------- I. Datos y operación ----------

  it('I01 · un dato cargado en un celular aparece en otro', async () => {
    // Otro dispositivo = otra sesión del mismo usuario contra la misma base.
    const otroCelular = (await pedir<RespuestaLogin>(null, 'POST', '/auth/login', { usuario: 'cocina', clave: CLAVE_DEMO })).body.token
    const r = await pedir<Lectura>(tk.cocina, 'POST', '/lecturas', { maquinaId: heladera.id, momento: 'otro', estado: 'funciona', temperatura: 4 })
    expect(r.status).toBe(200)
    const enElOtro = await pedir<Lectura[]>(otroCelular, 'GET', `/lecturas?maquina=${heladera.id}`)
    expect(enElOtro.body[0]).toMatchObject({ id: r.body.id, temperatura: 4 })
    const delAdmin = await pedir<Lectura[]>(tk.admin, 'GET', `/lecturas?maquina=${heladera.id}`)
    expect(delAdmin.body.map((l) => l.id)).toEqual(enElOtro.body.map((l) => l.id))
  })

  it.todo('I02 · la restauración de los últimos 7 días está activa (manual: Time Travel de D1 en la cuenta de Cloudflare)')

  it('I03 · la descarga de todos los datos trae los registros de la prueba y ninguna contraseña', async () => {
    expect((await pedir(tk.cocina, 'GET', '/exportar')).status).toBe(403)
    const r = await pedir<Exportacion>(tk.admin, 'GET', '/exportar')
    expect(r.status).toBe(200)
    const t = r.body.tablas
    const ids = (tabla: string) => t[tabla].map((f) => f.id)
    expect(ids('producciones')).toEqual(expect.arrayContaining([registro.id, chipas.id]))
    expect(t.produccion_items.filter((f) => f.produccion_id === registro.id)).toHaveLength(3)
    expect(ids('movimientos')).toEqual(expect.arrayContaining([envioEmpanadas.movimientos[0].id, envioChipas.movimientos[0].id]))
    expect(ids('lecturas')).toEqual(expect.arrayContaining([conFallas.id, conFoto.id, lecturaRoja.id]))
    expect(ids('limpiezas')).toContain(limpieza.id)
    expect(ids('lotes_mp')).toContain(harina.id)
    expect(t.lotes_chipa.map((f) => f.codigo)).toContain(lote)
    expect(t.usuarios.map((u) => u.usuario)).toEqual(expect.arrayContaining(['admin', 'cocina', 'ayudante']))
    // Sin contraseñas (ni su hash), sin sesiones y sin el contenido de las fotos.
    expect(t.usuarios.some((u) => 'clave_hash' in u)).toBe(false)
    expect(JSON.stringify(r.body)).not.toMatch(/pbkdf2\$/)
    expect(t.sesiones).toBeUndefined()
    expect(t.archivos.length).toBeGreaterThan(0)
    expect(t.archivos.some((f) => 'datos' in f)).toBe(false)
  })

  it('I04 · registros, reportes y correos van con la fecha y la hora de Paraguay', async () => {
    // A las 23:30 de Paraguay ya es el día siguiente en UTC: el registro queda en el día de Paraguay.
    ponerReloj(`${MANIANA}T02:30:00.000Z`)
    const noche = await pedir<Lectura>(tk.cocina, 'POST', '/lecturas', { maquinaId: heladera.id, momento: 'fin', estado: 'funciona', temperatura: 4 })
    expect(noche.body.fecha).toBe(`${MANIANA}T02:30:00.000Z`)
    expect(noche.body.dia).toBe(DIA)
    expect(relojParaguay(noche.body.fecha)).toBe('14/10/2026 23:30')

    // Al otro día a las 06:00 llega el resumen diario de la prueba, con las horas de Paraguay.
    ponerReloj(`${MANIANA}T09:00:00.000Z`)
    const f = simularResend()
    const r = await pedir<ResumenCorreo>(tk.admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(r.body).toMatchObject({ enviado: true, asunto: 'Chipa Tía · Resumen diario del 14/10/2026 · 1 temperatura fuera de rango' })
    const { html } = correoDe(f).body
    expect(html).toContain(relojParaguay(lecturaRoja.fecha)) // la hora de la lectura de 9 °C
    expect(relojParaguay(lecturaRoja.fecha)).toMatch(/^14\/10\/2026 (09|10|11):\d\d$/)
    expect(html).toContain('Generado el 15/10/2026 06:00 (hora de Paraguay)')
    expect(html).toContain(`href="https://chipatia.com/#/admin/reportes?desde=${DIA}&amp;hasta=${DIA}"`)
    for (const dato of ['Empanada frita (carne)', 'Hamburguesa casera', 'Sucursal San Lorenzo', lote, 'Heladera de prueba', 'Sanitario']) {
      expect(html, dato).toContain(dato)
    }

    // Datos consultables por al menos 24 meses.
    const dosAnios = await pedir<Reporte>(tk.admin, 'GET', `/reportes?desde=${sumarDias(DIA, -731)}&hasta=${DIA}`)
    expect(dosAnios.status).toBe(200)
    expect(dosAnios.body.totales.cargasProduccion).toBe(3)
    const historial = await pedir<Movimiento[]>(tk.admin, 'GET', `/movimientos?desde=${sumarDias(DIA, -731)}&hasta=${DIA}`)
    expect(historial.status).toBe(200)
  })

  it('I05 · la copia generada a mano queda guardada con la fecha del día', async () => {
    expect((await pedir(tk.cocina, 'POST', '/copias')).status).toBe(403)
    const r = await pedir<Copia>(tk.admin, 'POST', '/copias')
    expect(r.status).toBe(200)
    // El reloj de la prueba ya está en la mañana siguiente (I04): ese es «el día».
    expect(r.body).toMatchObject({ origen: 'manual', dia: MANIANA })
    expect(r.body.clave).toMatch(new RegExp(`^copias/${MANIANA}T06\\d{4}\\.json$`))
    const lista = await pedir<Copia[]>(tk.admin, 'GET', '/copias')
    expect(lista.body[0]).toEqual(r.body)
    const copia = await pedir<Exportacion>(tk.admin, 'GET', `/copias/${encodeURIComponent(r.body.clave)}`)
    expect(copia.status).toBe(200)
    expect(copia.body.tablas.producciones.map((f) => f.id)).toEqual(expect.arrayContaining([registro.id, chipas.id]))
    expect(JSON.stringify(copia.body)).not.toMatch(/pbkdf2\$/)
  })
})
