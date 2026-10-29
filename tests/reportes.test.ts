// H01–H04: reporte del administrador por rango de fechas y sector, resumen por correo con Resend
// y tareas programadas (resumen diario, semanal los lunes, mensual el día 1, copia semanal).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tareasProgramadas } from '../src/server/programado'
import { diaPY, rangoResumen, sumarDias } from '../src/shared/hora'
import type { AreaLimpieza, Produccion, Reporte, ResumenCorreo } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10' // Empanada frita (carne)
const MARINERA = 'prod-cocina-14' // Marinera de carne
const HAMBURGUESA = 'prod-cocina-24' // Hamburguesa
const CROQUETE = 'prod-cocina-04' // Croquete de carne
const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const CHIPITAS = 'prod-chipitas-01'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

let n = 0
const id = (prefijo: string) => `${prefijo}-${++n}`

/** "AAAA-MM-DD" + hora de Paraguay (UTC−3) → ISO en UTC. */
const iso = (dia: string, hora = 10) => new Date(Date.parse(`${dia}T00:00:00-03:00`) + hora * 3_600_000).toISOString()

/** Producción cargada directo en la base (es de otro módulo). */
async function produccion(p: Prueba, o: { sector: string; dia: string; items: [string, number, number][]; usuario?: string }) {
  const pid = id('prod')
  await p.sql('INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, ?, ?, ?, ?, ?)',
    pid, o.sector, o.usuario ?? `usr-${o.sector}`, iso(o.dia), o.dia, 'dia')
  for (const [producto, cocinado, guardado] of o.items) {
    await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, ?)', pid, producto, cocinado, guardado)
    if (guardado) await mov(p, { sector: o.sector, producto, tipo: 'produccion', cantidad: guardado, dia: o.dia, produccion: pid })
  }
  return pid
}

async function mov(p: Prueba, o: {
  sector: string; producto: string; tipo: string; cantidad: number; dia: string
  lote?: string | null; sucursal?: string | null; produccion?: string | null
}) {
  await p.sql(
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
    id('mov'), o.sector, o.producto, o.lote ?? null, o.tipo, o.cantidad, o.sucursal ?? null, o.produccion ?? null,
    `usr-${o.sector}`, iso(o.dia, 11), o.dia,
  )
}

async function lectura(p: Prueba, o: { maquina: string; dia: string; hora?: number; temperatura: number | null; fuera?: boolean; estado?: string; observacion?: string }) {
  const lid = id('lec')
  await p.sql(
    `INSERT INTO lecturas (id, maquina_id, usuario_id, fecha, dia, momento, estado, temperatura, fuera_de_rango, observacion)
     VALUES (?, ?, 'usr-cocina', ?, ?, 'inicio', ?, ?, ?, ?)`,
    lid, o.maquina, iso(o.dia, o.hora ?? 7), o.dia, o.estado ?? 'funciona', o.temperatura, o.fuera ? 1 : 0, o.observacion ?? '',
  )
  return lid
}

async function limpieza(p: Prueba, o: { area: string; sector: string; dia: string; marcas: string[]; controlada?: boolean }) {
  const lid = id('lim')
  await p.sql(
    `INSERT INTO limpiezas (id, area_id, sector, usuario_id, fecha, dia, comentario, controlado_por, controlado_en)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
    lid, o.area, o.sector, `usr-${o.sector}`, iso(o.dia, 15), o.dia, o.controlada ? 'usr-admin' : null, o.controlada ? iso(o.dia, 19) : null,
  )
  for (const [i, marca] of o.marcas.entries()) {
    await p.sql('INSERT INTO limpieza_marcas (limpieza_id, tarea_id, marca) VALUES (?, ?, ?)', lid, `tarea-${o.area}-${String(i + 1).padStart(2, '0')}`, marca)
  }
  return lid
}

/** Lote de chipa con su producción y lo guardado en el congelador. */
async function loteChipa(p: Prueba, codigo: string, dia: string, horno: number, congelador: number) {
  const pid = await produccion(p, { sector: 'chiperia', dia, items: [] })
  await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, ?)', pid, CHIPA, horno, congelador)
  await p.sql('INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia) VALUES (?, ?, ?, 1, ?)', `lc-${codigo}`, codigo, pid, dia)
  await mov(p, { sector: 'chiperia', producto: CHIPA, tipo: 'produccion', cantidad: congelador, dia, lote: codigo, produccion: pid })
}

/** Respuesta de Resend simulada; guarda los pedidos para revisarlos. */
function simularResend(estado = 200, cuerpo: unknown = { id: 'correo-1' }) {
  const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', f)
  return f
}
const pedidoDe = (f: ReturnType<typeof simularResend>, i = 0) => {
  const [url, init] = f.mock.calls[i]
  return { url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) }
}

describe('reporte por período (H01, H03)', () => {
  it('suma producción, stock, envíos, salidas y lotes del rango pedido', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    const ayer = sumarDias(hoy, -1)
    const viejo = sumarDias(hoy, -10)

    // Dentro del rango (ayer y hoy) y fuera (hace 10 días).
    await produccion(p, { sector: 'cocina', dia: ayer, items: [[EMPANADA, 30, 8], [MARINERA, 15, 0]] })
    await produccion(p, { sector: 'cocina', dia: hoy, items: [[EMPANADA, 10, 4], [HAMBURGUESA, 3, 0]] })
    await produccion(p, { sector: 'chipitas', dia: hoy, items: [[CHIPITAS, 100, 200]] })
    await produccion(p, { sector: 'cocina', dia: viejo, items: [[EMPANADA, 99, 20]] })
    await loteChipa(p, 'CH-1', hoy, 200, 300)
    await loteChipa(p, 'CH-0', viejo, 50, 60)
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'salida_venta', cantidad: -3, dia: hoy })
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -2, dia: hoy, sucursal: 'suc-centro' })
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -5, dia: ayer, sucursal: 'suc-centro' })
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -7, dia: viejo, sucursal: 'suc-centro' })
    await mov(p, { sector: 'chiperia', producto: CHIPA, tipo: 'envio', cantidad: -100, dia: hoy, sucursal: 'suc-ruta1', lote: 'CH-1' })
    await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'merma', cantidad: -1, dia: hoy })
    await mov(p, { sector: 'cocina', producto: CROQUETE, tipo: 'stock_inicial', cantidad: 12, dia: hoy })
    await mov(p, { sector: 'cocina', producto: CROQUETE, tipo: 'ajuste', cantidad: 2, dia: hoy })

    const r = await p.pedir<Reporte>(admin, 'GET', `/reportes?desde=${ayer}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    const rep = r.body
    expect(rep).toMatchObject({ desde: ayer, hasta: hoy })
    expect(Date.parse(rep.generadoEn)).toBeGreaterThan(Date.now() - 60_000)

    // Producción por producto, cocinado contra guardado, sin lo de hace 10 días. Ordenado por sector y producto.
    expect(rep.produccion).toEqual([
      { sector: 'chiperia', productoId: CHIPA, productoNombre: 'Chipa tradicional', cocinado: 200, guardado: 300 },
      { sector: 'chipitas', productoId: CHIPITAS, productoNombre: 'Chipitas 100 g', cocinado: 100, guardado: 200 },
      { sector: 'cocina', productoId: EMPANADA, productoNombre: 'Empanada frita (carne)', cocinado: 40, guardado: 12 },
      { sector: 'cocina', productoId: MARINERA, productoNombre: 'Marinera de carne', cocinado: 15, guardado: 0 },
      { sector: 'cocina', productoId: HAMBURGUESA, productoNombre: 'Hamburguesa', cocinado: 3, guardado: 0 },
    ])
    // Stock actual (incluye lo de antes del rango): empanadas 8+4+20 −3 −2 −5 −7 −1 = 14.
    const stock = Object.fromEntries(rep.stock.map((s) => [s.productoId, s.total]))
    expect(stock).toEqual({ [CHIPA]: 260, [CHIPITAS]: 200, [CROQUETE]: 14, [EMPANADA]: 14 })
    // Envíos por sucursal y producto, solo del rango.
    expect(rep.envios).toEqual([
      { sucursalId: 'suc-centro', sucursalNombre: 'Sucursal Centro', productoNombre: 'Empanada frita (carne)', sector: 'cocina', cantidad: 7 },
      { sucursalId: 'suc-ruta1', sucursalNombre: 'Sucursal Ruta 1', productoNombre: 'Chipa tradicional', sector: 'chiperia', cantidad: 100 },
    ])
    // Salidas del stock por tipo (en positivo); lo que suma (stock inicial, ajuste +) no es salida.
    expect(rep.salidas).toEqual([
      { sector: 'chiperia', tipo: 'envio', cantidad: 100 },
      { sector: 'cocina', tipo: 'salida_venta', cantidad: 3 },
      { sector: 'cocina', tipo: 'envio', cantidad: 7 },
      { sector: 'cocina', tipo: 'merma', cantidad: 1 },
    ])
    // Lotes de Chipería del período, con horno, congelador y lo que queda.
    expect(rep.lotesChipa.map((l) => [l.codigo, l.horno, l.congelador, l.stock])).toEqual([['CH-1', 200, 300, 200]])
    expect(rep.totales).toEqual({
      cargasProduccion: 4,
      unidadesCocinadas: 358,
      unidadesGuardadas: 512,
      unidadesEnviadas: 107,
      temperaturasFueraDeRango: 0,
      limpiezas: 0,
      limpiezasSinControlar: 0,
    })

    // Sin fechas: el día de hoy. Con solo "desde": ese día.
    const deHoy = await p.pedir<Reporte>(admin, 'GET', '/reportes')
    expect(deHoy.body).toMatchObject({ desde: hoy, hasta: hoy })
    expect(deHoy.body.totales.cargasProduccion).toBe(3)
    const soloAyer = await p.pedir<Reporte>(admin, 'GET', `/reportes?desde=${ayer}`)
    expect(soloAyer.body).toMatchObject({ desde: ayer, hasta: ayer })
    expect(soloAyer.body.totales.unidadesCocinadas).toBe(45)
  })

  it('filtra por sector', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    await produccion(p, { sector: 'cocina', dia: hoy, items: [[EMPANADA, 30, 8]] })
    await loteChipa(p, 'CH-1', hoy, 200, 300)
    await mov(p, { sector: 'chiperia', producto: CHIPA, tipo: 'envio', cantidad: -100, dia: hoy, sucursal: 'suc-ruta1', lote: 'CH-1' })
    await lectura(p, { maquina: 'maq-chiperia-1', dia: hoy, temperatura: -10, fuera: true })
    await lectura(p, { maquina: 'maq-cocina-1', dia: hoy, temperatura: 9, fuera: true })
    await limpieza(p, { area: 'chiperia', sector: 'chiperia', dia: hoy, marcas: ['X', 'X'] })

    const r = await p.pedir<Reporte>(admin, 'GET', `/reportes?desde=${hoy}&hasta=${hoy}&sector=cocina`)
    expect(r.status).toBe(200)
    expect(r.body.produccion.map((x) => x.sector)).toEqual(['cocina'])
    expect(r.body.stock.map((x) => x.sector)).toEqual(['cocina'])
    expect(r.body.envios).toEqual([])
    expect(r.body.lotesChipa).toEqual([])
    expect(r.body.temperaturasFueraDeRango.map((l) => l.maquinaId)).toEqual(['maq-cocina-1'])
    expect(r.body.limpiezas).toEqual([])
    const chiperia = await p.pedir<Reporte>(admin, 'GET', `/reportes?sector=chiperia`)
    expect(chiperia.body.lotesChipa.map((l) => l.codigo)).toEqual(['CH-1'])
    expect(chiperia.body.envios).toHaveLength(1)
    expect(chiperia.body.limpiezas).toHaveLength(1)
  })

  it('es solo para el administrador y valida las fechas', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    for (const u of ['chiperia', 'chipitas', 'panaderia', 'cocina']) {
      const t = await p.entrar(u)
      expect((await p.pedir(t, 'GET', '/reportes')).status).toBe(403)
      expect((await p.pedir(t, 'GET', `/reportes?sector=${u}`)).status).toBe(403)
      expect((await p.pedir(t, 'POST', '/reportes/enviar', { periodo: 'diario' })).status).toBe(403)
    }
    expect((await p.pedir(null, 'GET', '/reportes')).status).toBe(401)
    const hoy = diaPY()
    const alReves = await p.pedir(admin, 'GET', `/reportes?desde=${hoy}&hasta=${sumarDias(hoy, -1)}`)
    expect(alReves.status).toBe(400)
    expect(alReves.body.error.mensaje).toBe('La fecha desde no puede ser posterior a la fecha hasta.')
    expect((await p.pedir(admin, 'GET', '/reportes?desde=09/10/2026')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', '/reportes?sector=fiambreria')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', `/reportes?desde=2020-01-01&hasta=${hoy}`)).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/reportes/enviar', { periodo: 'anual' })).status).toBe(400)
  })
})

describe('planilla de comprobación H01–H02 (encadenada desde C01)', () => {
  it('el reporte del día muestra producción, stock, envíos, lotes, la temperatura fuera de rango y la limpieza', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    const chiperia = await p.entrar('chiperia')
    const ok = <T>(r: { status: number; body: T }) => {
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      return r.body
    }

    // C01–C02: 38 empanadas (30 cocinadas, 8 guardadas), 15 marineras y 3 hamburguesas.
    ok(await p.pedir(cocina, 'POST', '/producciones', {
      turno: 'dia',
      items: [
        { productoId: EMPANADA, cocinado: 30, guardado: 8 },
        { productoId: MARINERA, cocinado: 15, guardado: 0 },
        { productoId: HAMBURGUESA, cocinado: 3, guardado: 0 },
      ],
    }))
    // D02, D03, D06, D07.
    ok(await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 3 }))
    ok(await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 2 }] }))
    ok(await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, tipo: 'merma', cantidad: 1, motivo: 'Se cayó' }))
    ok(await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: CROQUETE, tipo: 'stock_inicial', cantidad: 10, motivo: 'Stock existente' }))
    // E01–E05: lote de harina, 200 chipas al horno y 300 al congelador, envío de 100 de ese lote.
    const hoy = diaPY()
    const harina = ok(await p.pedir<{ id: string }>(chiperia, 'POST', '/lotes-mp', {
      insumo: 'Harina', proveedor: 'Molino Central', numeroLote: 'H-1', fechaIngreso: hoy, cantidad: 50, vencimiento: sumarDias(hoy, 60),
    }))
    const chipas = ok(await p.pedir<Produccion>(chiperia, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [harina.id], items: [{ productoId: CHIPA, cocinado: 200, guardado: 300 }],
    }))
    const codigo = chipas.lote!.codigo
    ok(await p.pedir(chiperia, 'POST', '/envios', { sucursalId: 'suc-ruta1', items: [{ productoId: CHIPA, lote: codigo, cantidad: 100 }] }))
    // F04: 9 °C en la heladera de 1 a 5 °C.
    ok(await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 9, observacion: 'Puerta mal cerrada' }))
    ok(await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-2', momento: 'inicio', estado: 'funciona', temperatura: -20 }))
    // F01: una máquina con fallas.
    ok(await p.pedir(cocina, 'POST', '/lecturas', { maquinaId: 'maq-cocina-5', momento: 'otro', estado: 'con_fallas', temperatura: null, observacion: 'No calienta' }))
    // G01: limpieza con 3 tareas hechas (el resto marcado "no se hizo").
    const [area] = ok(await p.pedir<AreaLimpieza[]>(cocina, 'GET', '/areas')).filter((a) => a.id === 'buffet')
    ok(await p.pedir(cocina, 'POST', '/limpiezas', {
      areaId: 'buffet', comentario: 'Prueba', marcas: area.tareas.map((t, i) => ({ tareaId: t.id, marca: i < 3 ? 'X' : '-' })),
    }))

    const rep = ok(await p.pedir<Reporte>(admin, 'GET', `/reportes?desde=${hoy}&hasta=${hoy}`))
    // H01
    expect(rep.produccion).toEqual(expect.arrayContaining([
      expect.objectContaining({ productoNombre: 'Empanada frita (carne)', cocinado: 30, guardado: 8 }),
      expect.objectContaining({ productoNombre: 'Marinera de carne', cocinado: 15, guardado: 0 }),
      expect.objectContaining({ productoNombre: 'Hamburguesa', cocinado: 3, guardado: 0 }),
      expect.objectContaining({ productoNombre: 'Chipa tradicional', cocinado: 200, guardado: 300 }),
    ]))
    expect(rep.stock).toEqual(expect.arrayContaining([
      expect.objectContaining({ productoId: EMPANADA, total: 2 }),
      expect.objectContaining({ productoId: CROQUETE, total: 10 }),
      expect.objectContaining({ productoId: CHIPA, total: 200 }),
    ]))
    expect(rep.envios).toEqual(expect.arrayContaining([
      expect.objectContaining({ sucursalId: 'suc-centro', productoNombre: 'Empanada frita (carne)', cantidad: 2 }),
      expect.objectContaining({ sucursalId: 'suc-ruta1', productoNombre: 'Chipa tradicional', cantidad: 100 }),
    ]))
    expect(rep.lotesChipa).toHaveLength(1)
    expect(rep.lotesChipa[0]).toMatchObject({ codigo, horno: 200, congelador: 300, stock: 200 })
    expect(rep.lotesChipa[0].lotesMP.map((m) => m.id)).toEqual([harina.id])
    // H02
    expect(rep.temperaturasFueraDeRango).toHaveLength(1)
    expect(rep.temperaturasFueraDeRango[0]).toMatchObject({ maquinaId: 'maq-cocina-1', temperatura: 9, fueraDeRango: true, observacion: 'Puerta mal cerrada' })
    expect(rep.maquinasConFallas.map((l) => [l.maquinaId, l.estado])).toEqual([['maq-cocina-5', 'con_fallas']])
    expect(rep.limpiezas).toEqual([
      { sector: 'cocina', areaNombre: 'Buffet', cantidad: 1, sinControlar: 1, tareasNoHechas: area.tareas.length - 3 },
    ])
    expect(rep.totales).toMatchObject({
      cargasProduccion: 2, unidadesCocinadas: 248, unidadesGuardadas: 308, unidadesEnviadas: 102,
      temperaturasFueraDeRango: 1, limpiezas: 1, limpiezasSinControlar: 1,
    })
  })

  it('cuenta las limpiezas por sector y área, las sin controlar y las tareas no hechas', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    await limpieza(p, { area: 'sanitario', sector: 'cocina', dia: hoy, marcas: ['X', '-', '-'], controlada: true })
    await limpieza(p, { area: 'sanitario', sector: 'cocina', dia: hoy, marcas: ['X', 'XX', '-'] })
    await limpieza(p, { area: 'sanitario', sector: 'chiperia', dia: hoy, marcas: ['X'] })
    await limpieza(p, { area: 'chiperia', sector: 'chiperia', dia: sumarDias(hoy, -3), marcas: ['-'] })
    const rep = (await p.pedir<Reporte>(admin, 'GET', '/reportes')).body
    expect(rep.limpiezas).toEqual([
      { sector: 'chiperia', areaNombre: 'Sanitario', cantidad: 1, sinControlar: 1, tareasNoHechas: 0 },
      { sector: 'cocina', areaNombre: 'Sanitario', cantidad: 2, sinControlar: 1, tareasNoHechas: 3 },
    ])
    expect(rep.totales).toMatchObject({ limpiezas: 3, limpiezasSinControlar: 2 })
  })
})

describe('resumen por correo (H04)', () => {
  it('en la demo no envía: devuelve la vista previa con el enlace al reporte', async () => {
    const f = simularResend()
    const p = await nuevaPrueba({ MODO_DEMO: '1', RESEND_API_KEY: 're_x', CORREO_REMITENTE: 'Chipa Tía <r@chipatia.com>' })
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'admin@chipatia.com', urlPublica: 'https://usuario.github.io/Chipa-Tia-IS/' })
    const r = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(r.status).toBe(200)
    const { desde, hasta } = rangoResumen('diario', diaPY())
    expect(r.body).toMatchObject({ enviado: false, destino: 'admin@chipatia.com' })
    expect(r.body.motivo).toMatch(/demo/i)
    expect(r.body.asunto).toMatch(/^Chipa Tía · Resumen diario del \d{2}\/\d{2}\/\d{4}$/)
    expect(r.body.html).toContain(`https://usuario.github.io/Chipa-Tia-IS/#/admin/reportes?desde=${desde}&amp;hasta=${hasta}`)
    expect(f).not.toHaveBeenCalled()
  })

  it('envía con Resend al correo configurado, con el período, horas de Paraguay y el enlace', async () => {
    const f = simularResend()
    const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'Admin@ChipaTia.com.py', urlPublica: 'https://chipatia.com.py/' })).status).toBe(200)
    const { desde, hasta } = rangoResumen('semanal', diaPY())
    // Una lectura fuera de rango la semana pasada, a las 21:30 UTC = 18:30 en Paraguay.
    await lectura(p, { maquina: 'maq-cocina-1', dia: desde, hora: 18.5, temperatura: 9, fuera: true, observacion: 'Puerta <abierta>' })
    await produccion(p, { sector: 'cocina', dia: hasta, items: [[EMPANADA, 30, 8]] })

    const r = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'semanal' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enviado: true, destino: 'admin@chipatia.com.py' })
    expect(r.body.motivo).toBeUndefined()
    expect(f).toHaveBeenCalledTimes(1)
    const pedido = pedidoDe(f)
    expect(pedido.url).toBe('https://api.resend.com/emails')
    expect(pedido.headers.Authorization).toBe('Bearer re_prueba')
    expect(pedido.body.from).toBe('Chipa Tía <reportes@chipatia.com>')
    expect(pedido.body.to).toEqual(['admin@chipatia.com.py'])
    expect(pedido.body.subject).toBe(r.body.asunto)
    expect(pedido.body.subject).toMatch(/^Chipa Tía · Resumen semanal del \d{2}\/\d{2} al \d{2}\/\d{2}\/\d{4} · 1 temperatura fuera de rango$/)
    const html: string = pedido.body.html
    expect(html).toContain(`https://chipatia.com.py/#/admin/reportes?desde=${desde}&amp;hasta=${hasta}`)
    expect(html).toContain('Ver el reporte completo')
    // Hora de Paraguay (I04) y texto escapado.
    expect(html).toContain(`${desde.slice(8, 10)}/${desde.slice(5, 7)}/${desde.slice(0, 4)} 18:30`)
    expect(html).toContain('Puerta &lt;abierta&gt;')
    expect(html).not.toContain('<abierta>')
    expect(html).toContain('Empanada frita (carne)')
    expect(html).toContain('lunes')
  })

  it('manda a varios correos y avisa si Resend lo rechaza o falta configurar algo', async () => {
    const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
    const admin = await p.entrar('admin')
    let f = simularResend()
    // Sin correo configurado: no llama a Resend.
    const sinCorreo = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'mensual' })
    expect(sinCorreo.body).toMatchObject({ enviado: false, destino: '' })
    expect(sinCorreo.body.motivo).toContain('Datos → Configuración')
    expect(sinCorreo.body.html).toContain('cargá la dirección pública')
    expect(f).not.toHaveBeenCalled()

    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'a@chipatia.com; b@chipatia.com' })
    const varios = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', {})
    expect(varios.body.enviado).toBe(true)
    expect(pedidoDe(f).body.to).toEqual(['a@chipatia.com', 'b@chipatia.com'])
    expect(pedidoDe(f).body.subject).toMatch(/Resumen diario/)

    f = simularResend(422, { statusCode: 422, message: 'The from address is not verified', name: 'validation_error' })
    const rechazado = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(rechazado.status).toBe(200)
    expect(rechazado.body.enviado).toBe(false)
    expect(rechazado.body.motivo).toBe('Resend no aceptó el correo (422: The from address is not verified).')

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    const sinRed = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(sinRed.body).toMatchObject({ enviado: false })
    expect(sinRed.body.motivo).toMatch(/No se pudo conectar con Resend/)

    const sinClave = await nuevaPrueba({ CORREO_REMITENTE: 'x <x@chipatia.com>' })
    const t = await sinClave.entrar('admin')
    await sinClave.pedir(t, 'PATCH', '/config', { correoReportes: 'a@chipatia.com' })
    const r = await sinClave.pedir<ResumenCorreo>(t, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(r.body.motivo).toMatch(/RESEND_API_KEY/)
  })

  it("el resumen 'hoy' trae lo cargado hoy hasta ahora (hora de Paraguay) y no toca los demás períodos", async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-10T18:40:00Z') }) // 15:40 en Paraguay
    const f = simularResend()
    const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'admin@chipatia.com', urlPublica: 'https://chipatia.com' })
    await produccion(p, { sector: 'cocina', dia: '2026-10-10', items: [[EMPANADA, 41, 0]] })
    await produccion(p, { sector: 'cocina', dia: '2026-10-09', items: [[EMPANADA, 77, 0]] })

    const r = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'hoy' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enviado: true, destino: 'admin@chipatia.com', asunto: 'Chipa Tía · Resumen de hoy hasta las 15:40' })
    const pedido = pedidoDe(f)
    expect(pedido.body.subject).toBe('Chipa Tía · Resumen de hoy hasta las 15:40')
    const html: string = pedido.body.html
    expect(html).toContain('Resumen parcial de hoy · sábado 10/10/2026 · lo cargado hasta las 15:40')
    expect(html).toContain('https://chipatia.com/#/admin/reportes?desde=2026-10-10&amp;hasta=2026-10-10')
    expect(html).toContain('>41<')
    expect(html).not.toContain('>77<')
    expect(html).not.toContain('>118<')

    // Pasadas las 21 h en Paraguay ya es otro día en UTC: 'hoy' sigue siendo el día de Paraguay.
    vi.setSystemTime(new Date('2026-10-11T01:30:00Z')) // 22:30 del 10/10 en Paraguay
    const noche = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'hoy' })
    expect(noche.body.asunto).toBe('Chipa Tía · Resumen de hoy hasta las 22:30')
    expect(noche.body.html).toContain('desde=2026-10-10&amp;hasta=2026-10-10')

    // Los demás períodos siguen igual: diario = ayer.
    const diario = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(diario.body.asunto).toBe('Chipa Tía · Resumen diario del 09/10/2026')
  })

  it("en la demo el resumen 'hoy' devuelve la vista previa sin enviar", async () => {
    const f = simularResend()
    const p = await nuevaPrueba({ MODO_DEMO: '1', RESEND_API_KEY: 're_x', CORREO_REMITENTE: 'Chipa Tía <r@chipatia.com>' })
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'admin@chipatia.com', urlPublica: 'https://usuario.github.io/Chipa-Tia-IS/' })
    const hoy = diaPY()
    await produccion(p, { sector: 'cocina', dia: hoy, items: [[EMPANADA, 12, 0]] })
    const r = await p.pedir<ResumenCorreo>(admin, 'POST', '/reportes/enviar', { periodo: 'hoy' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enviado: false, destino: 'admin@chipatia.com' })
    expect(r.body.motivo).toMatch(/demo/i)
    expect(r.body.asunto).toMatch(/^Chipa Tía · Resumen de hoy hasta las \d{2}:\d{2}$/)
    expect(r.body.html).toContain(`https://usuario.github.io/Chipa-Tia-IS/#/admin/reportes?desde=${hoy}&amp;hasta=${hoy}`)
    expect(r.body.html).toContain('>12<')
    expect(f).not.toHaveBeenCalled()
  })

  it('el resumen mensual del día 1 cubre el mes anterior completo', async () => {
    const f = simularResend()
    const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'admin@chipatia.com', urlPublica: 'https://chipatia.com' })
    await produccion(p, { sector: 'panaderia', dia: '2026-09-30', items: [['prod-panaderia-01', 300, 0]] })
    await produccion(p, { sector: 'panaderia', dia: '2026-10-01', items: [['prod-panaderia-01', 7, 0]] })
    const r = await tareasProgramadas(p.env, new Date('2026-10-01T09:00:00Z'))
    expect(r.errores).toEqual([])
    const mensual = f.mock.calls.map((_, i) => pedidoDe(f, i).body).find((b) => /mensual/.test(b.subject))!
    expect(mensual.subject).toBe('Chipa Tía · Resumen mensual de septiembre de 2026')
    expect(mensual.html).toContain('https://chipatia.com/#/admin/reportes?desde=2026-09-01&amp;hasta=2026-09-30')
    expect(mensual.html).toContain('>300<')
    expect(mensual.html).not.toContain('>307<')
  })
})

describe('tareas programadas (cron 06:00 de Paraguay)', () => {
  async function preparar() {
    const f = simularResend()
    const p = await nuevaPrueba({ RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'Chipa Tía <reportes@chipatia.com>' })
    await p.sql("INSERT INTO configuracion (clave, valor) VALUES ('correoReportes', 'admin@chipatia.com'), ('urlPublica', 'https://chipatia.com')")
    const asuntos = () => f.mock.calls.map((_, i) => pedidoDe(f, i).body.subject as string)
    return { f, p, asuntos }
  }

  it('un día común manda solo el resumen diario de ayer', async () => {
    const { p, asuntos } = await preparar()
    const r = await tareasProgramadas(p.env, new Date('2026-10-14T09:00:00Z')) // miércoles
    expect(r.dia).toBe('2026-10-14')
    expect(asuntos()).toEqual(['Chipa Tía · Resumen diario del 13/10/2026'])
    expect(r.hechas).toEqual(['resumen diario: enviado a admin@chipatia.com', 'fotos viejas: 0 de máquinas y 0 de limpieza borradas (más de 90 días)'])
    expect(await p.sql('SELECT * FROM copias')).toEqual([])
  })

  it('los lunes agrega el semanal y la copia automática de toda la base (I05)', async () => {
    const { p, asuntos } = await preparar()
    const r = await tareasProgramadas(p.env, new Date('2026-10-12T09:00:00Z')) // lunes
    expect(asuntos()).toEqual([
      'Chipa Tía · Resumen diario del 11/10/2026',
      'Chipa Tía · Resumen semanal del 05/10 al 11/10/2026',
    ])
    const copias = await p.sql('SELECT * FROM copias')
    expect(copias).toHaveLength(1)
    expect(copias[0]).toMatchObject({ origen: 'automatica' })
    expect(copias[0].clave).toMatch(/^copias\/\d{4}-\d{2}-\d{2}T\d{6}\.json$/)
    expect(r.hechas).toContain(`copia semanal: ${copias[0].clave}`)
    const [archivo] = await p.sql('SELECT tipo, bytes FROM archivos WHERE clave = ?', copias[0].clave)
    expect(archivo).toMatchObject({ tipo: 'application/json', bytes: copias[0].bytes })
  })

  it('el día 1 agrega el mensual; si cae lunes, también el semanal y la copia', async () => {
    const { p, asuntos } = await preparar()
    await tareasProgramadas(p.env, new Date('2026-11-01T09:00:00Z')) // domingo 1
    expect(asuntos()).toEqual([
      'Chipa Tía · Resumen diario del 31/10/2026',
      'Chipa Tía · Resumen mensual de octubre de 2026',
    ])
    expect(await p.sql('SELECT * FROM copias')).toEqual([])
    await tareasProgramadas(p.env, new Date('2026-06-01T09:00:00Z')) // lunes 1
    expect(asuntos().slice(2)).toEqual([
      'Chipa Tía · Resumen diario del 31/05/2026',
      'Chipa Tía · Resumen semanal del 25/05 al 31/05/2026',
      'Chipa Tía · Resumen mensual de mayo de 2026',
    ])
    expect(await p.sql('SELECT origen FROM copias')).toEqual([{ origen: 'automatica' }])
  })

  it('calcula el día en hora de Paraguay, no en UTC', async () => {
    const { p, asuntos } = await preparar()
    // 02:00 UTC del martes 13 = 23:00 del lunes 12 en Paraguay.
    const r = await tareasProgramadas(p.env, new Date('2026-10-13T02:00:00Z'))
    expect(r.dia).toBe('2026-10-12')
    expect(asuntos()).toHaveLength(2)
    expect(asuntos()[1]).toMatch(/semanal/)
  })

  it('nunca lanza: si falla el correo igual hace la copia, y lo anota', async () => {
    const { p } = await preparar()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await tareasProgramadas(p.env, new Date('2026-10-12T09:00:00Z'))
    expect(r.hechas.some((h) => h.startsWith('resumen diario: no enviado'))).toBe(true)
    expect(await p.sql('SELECT origen FROM copias')).toEqual([{ origen: 'automatica' }])

    // Una base que falla tampoco hace lanzar.
    const rota = { ...p.env, DB: { prepare: () => { throw new Error('D1 caída') }, batch: async () => { throw new Error('D1 caída') } } }
    const r2 = await tareasProgramadas(rota, new Date('2026-10-12T09:00:00Z'))
    expect(r2.errores).toHaveLength(4)
    expect(error).toHaveBeenCalled()
    await expect(tareasProgramadas(p.env, new Date('fecha mala'))).resolves.toMatchObject({ errores: ['fecha inválida'] })
  })
})
