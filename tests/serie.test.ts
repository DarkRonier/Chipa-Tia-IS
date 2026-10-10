// GET /reportes/serie: unidades por día y sector para los gráficos del Resumen (solo admin).
import { describe, expect, it } from 'vitest'
import { diaPY, sumarDias } from '../src/shared/hora'
import { SECTOR_IDS, type Reporte, type SerieReporte } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10'
const MARINERA = 'prod-cocina-14'
const CHIPA = 'prod-chiperia-01'
const CHIPITAS = 'prod-chipitas-01'

let n = 0
const id = (prefijo: string) => `${prefijo}-${++n}`
const iso = (dia: string, hora = 10) => new Date(Date.parse(`${dia}T00:00:00-03:00`) + hora * 3_600_000).toISOString()

async function produccion(p: Prueba, o: { sector: string; dia: string; items: [string, number, number][] }) {
  const pid = id('prod')
  await p.sql('INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, ?, ?, ?, ?, ?)',
    pid, o.sector, `usr-${o.sector}`, iso(o.dia), o.dia, 'dia')
  for (const [producto, cocinado, guardado] of o.items) {
    await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, ?, ?)', pid, producto, cocinado, guardado)
  }
}

async function mov(p: Prueba, o: { sector: string; producto: string; tipo: string; cantidad: number; dia: string; sucursal?: string | null }) {
  await p.sql(
    `INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?)`,
    id('mov'), o.sector, o.producto, o.tipo, o.cantidad, o.sucursal ?? null, `usr-${o.sector}`, iso(o.dia, 11), o.dia,
  )
}

/** Datos repartidos en cuatro días (el segundo, sin nada) y varios sectores. */
async function cargar(p: Prueba) {
  const hoy = diaPY()
  const d = [sumarDias(hoy, -4), sumarDias(hoy, -3), sumarDias(hoy, -2), hoy]
  // Stock para poder sacar (el libro no deja pasar a negativo); el stock inicial no es parte de la serie.
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'stock_inicial', cantidad: 100, dia: sumarDias(hoy, -30) })
  await mov(p, { sector: 'cocina', producto: MARINERA, tipo: 'stock_inicial', cantidad: 100, dia: sumarDias(hoy, -30) })
  await mov(p, { sector: 'chiperia', producto: CHIPA, tipo: 'stock_inicial', cantidad: 1000, dia: sumarDias(hoy, -30) })
  await produccion(p, { sector: 'cocina', dia: d[0], items: [[EMPANADA, 30, 8], [MARINERA, 15, 0]] })
  await produccion(p, { sector: 'cocina', dia: d[0], items: [[EMPANADA, 5, 1]] })
  await produccion(p, { sector: 'chiperia', dia: d[0], items: [[CHIPA, 200, 150]] })
  await produccion(p, { sector: 'chipitas', dia: d[2], items: [[CHIPITAS, 100, 90]] })
  await produccion(p, { sector: 'cocina', dia: d[3], items: [[EMPANADA, 10, 4]] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -2, dia: d[0], sucursal: 'suc-centro' })
  await mov(p, { sector: 'cocina', producto: MARINERA, tipo: 'envio', cantidad: -3, dia: d[0], sucursal: 'suc-ruta1' })
  await mov(p, { sector: 'chiperia', producto: CHIPA, tipo: 'envio', cantidad: -100, dia: d[2], sucursal: 'suc-ruta1' })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'salida_venta', cantidad: -4, dia: d[0] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'salida_venta', cantidad: -1, dia: d[3] })
  // No cuentan: merma, ajuste que suma, stock inicial y la entrada al frío de una producción.
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'merma', cantidad: -9, dia: d[0] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'ajuste', cantidad: 7, dia: d[0] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'stock_inicial', cantidad: 12, dia: d[0] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'produccion', cantidad: 8, dia: d[0] })
  // Fuera del rango que se pide.
  await produccion(p, { sector: 'cocina', dia: sumarDias(hoy, -20), items: [[EMPANADA, 99, 20]] })
  await mov(p, { sector: 'cocina', producto: EMPANADA, tipo: 'envio', cantidad: -7, dia: sumarDias(hoy, -20), sucursal: 'suc-centro' })
  return { hoy, d }
}

describe('serie diaria por sector', () => {
  it('da los totales de cada día y sector, con todos los días del rango', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const { hoy, d } = await cargar(p)

    const r = await p.pedir<SerieReporte>(admin, 'GET', `/reportes/serie?desde=${d[0]}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    expect(r.body.desde).toBe(d[0])
    expect(r.body.hasta).toBe(hoy)
    expect(r.body.dias.map((x) => x.dia)).toEqual([d[0], d[1], sumarDias(hoy, -2), sumarDias(hoy, -1), hoy])

    const cero = { cocinado: 0, guardado: 0, enviado: 0, vendido: 0 }
    const dia = (x: string) => r.body.dias.find((y) => y.dia === x)!.sectores
    expect(Object.keys(dia(d[0])).sort()).toEqual([...SECTOR_IDS].sort())
    expect(dia(d[0])).toEqual({
      chiperia: { cocinado: 200, guardado: 150, enviado: 0, vendido: 0 },
      chipitas: cero,
      panaderia: cero,
      cocina: { cocinado: 50, guardado: 9, enviado: 5, vendido: 4 },
    })
    expect(dia(d[2])).toEqual({
      chiperia: { cocinado: 0, guardado: 0, enviado: 100, vendido: 0 },
      chipitas: { cocinado: 100, guardado: 90, enviado: 0, vendido: 0 },
      panaderia: cero,
      cocina: cero,
    })
    expect(dia(hoy).cocina).toEqual({ cocinado: 10, guardado: 4, enviado: 0, vendido: 1 })
  })

  it('los días sin datos vienen en cero, también un rango sin nada', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    const r = await p.pedir<SerieReporte>(admin, 'GET', `/reportes/serie?desde=${sumarDias(hoy, -2)}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    expect(r.body.dias).toHaveLength(3)
    for (const x of r.body.dias) {
      for (const s of SECTOR_IDS) expect(x.sectores[s]).toEqual({ cocinado: 0, guardado: 0, enviado: 0, vendido: 0 })
    }
  })

  it('sin fechas devuelve solo hoy, como /reportes', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir<SerieReporte>(admin, 'GET', '/reportes/serie')
    expect(r.status).toBe(200)
    expect(r.body.dias.map((x) => x.dia)).toEqual([diaPY()])
  })

  it('coincide con /reportes para el mismo rango', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const { hoy, d } = await cargar(p)
    const rango = `desde=${d[0]}&hasta=${hoy}`

    const serie = (await p.pedir<SerieReporte>(admin, 'GET', `/reportes/serie?${rango}`)).body
    const rep = (await p.pedir<Reporte>(admin, 'GET', `/reportes?${rango}`)).body

    const suma = (f: (s: SerieReporte['dias'][number]['sectores'][keyof SerieReporte['dias'][number]['sectores']]) => number) =>
      serie.dias.reduce((a, x) => a + SECTOR_IDS.reduce((b, s) => b + f(x.sectores[s]), 0), 0)
    expect(suma((m) => m.cocinado)).toBe(rep.totales.unidadesCocinadas)
    expect(suma((m) => m.guardado)).toBe(rep.totales.unidadesGuardadas)
    expect(suma((m) => m.enviado)).toBe(rep.totales.unidadesEnviadas)
    expect(suma((m) => m.vendido)).toBe(rep.salidas.filter((s) => s.tipo === 'salida_venta').reduce((a, s) => a + s.cantidad, 0))

    // Y por sector, con el filtro de sector del reporte.
    for (const sector of SECTOR_IDS) {
      const rs = (await p.pedir<Reporte>(admin, 'GET', `/reportes?${rango}&sector=${sector}`)).body
      const porSector = (f: (m: SerieReporte['dias'][number]['sectores'][typeof sector]) => number) =>
        serie.dias.reduce((a, x) => a + f(x.sectores[sector]), 0)
      expect(porSector((m) => m.cocinado)).toBe(rs.totales.unidadesCocinadas)
      expect(porSector((m) => m.guardado)).toBe(rs.totales.unidadesGuardadas)
      expect(porSector((m) => m.enviado)).toBe(rs.totales.unidadesEnviadas)
    }
  })

  it('usa pocas consultas aunque el rango sea largo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await cargar(p)
    const hoy = diaPY()
    const original = p.d1.prepare.bind(p.d1)
    let consultas = 0
    p.d1.prepare = ((sql: string) => {
      if (/FROM (produccion_items|movimientos)/.test(sql)) consultas++
      return original(sql)
    }) as typeof p.d1.prepare
    const r = await p.pedir<SerieReporte>(admin, 'GET', `/reportes/serie?desde=${sumarDias(hoy, -89)}&hasta=${hoy}`)
    expect(r.status).toBe(200)
    expect(r.body.dias).toHaveLength(90)
    expect(consultas).toBe(2)
  })

  it('solo el administrador la ve', async () => {
    const p = await nuevaPrueba()
    const operador = await p.entrar('cocina')
    expect((await p.pedir(operador, 'GET', '/reportes/serie')).status).toBe(403)
    expect((await p.pedir(null, 'GET', '/reportes/serie')).status).toBe(401)
  })

  it('rechaza un rango inválido con 400', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    const malos = [
      `desde=${hoy}&hasta=${sumarDias(hoy, -1)}`,
      'desde=ayer&hasta=hoy',
      'desde=2026-13-45',
      `desde=${sumarDias(hoy, -1200)}&hasta=${hoy}`,
    ]
    for (const q of malos) {
      const r = await p.pedir(admin, 'GET', `/reportes/serie?${q}`)
      expect(r.status, q).toBe(400)
    }
    // El máximo es el mismo que en /reportes: 1100 días de diferencia sí se acepta.
    expect((await p.pedir(admin, 'GET', `/reportes/serie?desde=${sumarDias(hoy, -1100)}&hasta=${hoy}`)).status).toBe(200)
  })
})
