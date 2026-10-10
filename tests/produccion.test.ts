// C01–C04 y E02–E04: registros de producción, lotes de chipa y correcciones del administrador.
import { describe, expect, it } from 'vitest'
import { diaPY } from '../src/shared/hora'
import type { Produccion } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10' // Empanada frita (carne)
const MARINERA = 'prod-cocina-14' // Marinera de carne
const HAMBURGUESA = 'prod-cocina-24' // Hamburguesa (ejemplo)
const CHIPA = 'prod-chiperia-01' // Chipa tradicional
const QUESU = 'prod-chiperia-03' // Chipa quesú

const sumarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Lote de materia prima cargado directo en la base (el módulo de lotes es otro). */
async function loteMP(p: Prueba, o: { id?: string; insumo?: string; proveedor?: string; numero?: string; vence?: string; bloqueado?: boolean } = {}) {
  const id = o.id ?? `mp-${Math.random().toString(36).slice(2)}`
  await p.sql(
    `INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
     VALUES (?, ?, ?, ?, ?, 50, 'kg', ?, ?, 'usr-admin', ?)`,
    id, o.insumo ?? 'Harina', o.proveedor ?? 'Molino Central', o.numero ?? 'H-77', diaPY(), o.vence ?? sumarDias(diaPY(), 90),
    o.bloqueado ? 1 : 0, new Date().toISOString(),
  )
  return id
}

async function stock(p: Prueba, sector: string, producto: string, lote?: string) {
  const [f] = await p.sql(
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM movimientos WHERE sector = ? AND producto_id = ? ${lote ? 'AND lote = ?' : ''}`,
    ...[sector, producto, ...(lote ? [lote] : [])],
  )
  return f.total as number
}

/** Registro del anexo C01–C02: 38 empanadas (30 cocinadas, 8 guardadas), 15 marineras y 3 hamburguesas. */
async function registrarAnexo(p: Prueba, token: string) {
  return p.pedir<Produccion>(token, 'POST', '/producciones', {
    turno: 'dia',
    items: [
      { productoId: EMPANADA, cocinado: 30, guardado: 8 },
      { productoId: MARINERA, cocinado: 15, guardado: 0 },
      { productoId: HAMBURGUESA, cocinado: 3, guardado: 0 },
      { productoId: 'prod-cocina-01', cocinado: 0, guardado: 0 },
    ],
  })
}

describe('registrar producción (C01–C03)', () => {
  it('guarda un solo registro con los tres productos y sus dos cantidades (C01, C02)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const r = await registrarAnexo(p, t)
    expect(r.status).toBe(200)
    expect(r.body.sector).toBe('cocina')
    expect(r.body.turno).toBe('dia')
    expect(r.body.lote).toBeNull()
    // Lo que vino en 0 y 0 no se registra.
    expect(r.body.items).toEqual([
      { productoId: EMPANADA, productoNombre: 'Empanada frita (carne)', cocinado: 30, guardado: 8 },
      { productoId: MARINERA, productoNombre: 'Marinera de carne', cocinado: 15, guardado: 0 },
      { productoId: HAMBURGUESA, productoNombre: 'Hamburguesa (ejemplo)', cocinado: 3, guardado: 0 },
    ])
    const lista = await p.pedir<Produccion[]>(t, 'GET', '/producciones')
    expect(lista.body).toHaveLength(1)
    expect(lista.body[0].items.reduce((s, i) => s + i.cocinado + i.guardado, 0)).toBe(56)
    expect(await p.sql('SELECT COUNT(*) AS n FROM producciones')).toEqual([{ n: 1 }])
  })

  it('pone fecha, hora y usuario solo, sin aceptar los del pedido (C03)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const antes = Date.now()
    const r = await p.pedir<Produccion>(t, 'POST', '/producciones', {
      turno: 'noche', fecha: '2020-01-01T00:00:00Z', usuarioId: 'usr-admin',
      items: [{ productoId: EMPANADA, cocinado: 5, guardado: 0 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.usuarioId).toBe('usr-cocina')
    expect(r.body.usuarioNombre).toBe('Encargado Cocina')
    expect(Date.parse(r.body.fecha)).toBeGreaterThanOrEqual(antes - 1000)
    expect(Date.parse(r.body.fecha)).toBeLessThanOrEqual(Date.now() + 1000)
    expect(r.body.dia).toBe(diaPY(r.body.fecha))
    expect(r.body.turno).toBe('noche')
    expect(r.body.corregidoPor).toBeNull()
  })

  it('suma al stock en frío solo lo guardado, sin lote fuera de Chipería (D01)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const r = await registrarAnexo(p, t)
    const movs = await p.sql('SELECT * FROM movimientos ORDER BY producto_id')
    expect(movs).toHaveLength(1)
    expect(movs[0]).toMatchObject({
      sector: 'cocina', producto_id: EMPANADA, tipo: 'produccion', cantidad: 8, lote: null,
      produccion_id: r.body.id, usuario_id: 'usr-cocina', dia: r.body.dia,
    })
    expect(await stock(p, 'cocina', EMPANADA)).toBe(8)
  })

  it('valida turno, cantidades y productos', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const enviar = (cuerpo: unknown) => p.pedir(t, 'POST', '/producciones', cuerpo)
    const item = { productoId: EMPANADA, cocinado: 1, guardado: 1 }
    const casos: [unknown, RegExp][] = [
      [{ items: [item] }, /turno/],
      [{ turno: 'tarde', items: [item] }, /turno/i],
      [{ turno: 'dia' }, /Cargá al menos una cantidad/],
      [{ turno: 'dia', items: [] }, /Cargá al menos una cantidad/],
      [{ turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 0, guardado: 0 }] }, /Cargá al menos una cantidad/],
      [{ turno: 'dia', items: [{ productoId: EMPANADA, cocinado: -1, guardado: 3 }] }, /cocinada/],
      [{ turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1.5, guardado: 3 }] }, /entero/],
      [{ turno: 'dia', items: [{ productoId: EMPANADA, cocinado: '4', guardado: 3 }] }, /entero/],
      [{ turno: 'dia', items: [item, item] }, /una sola vez/],
      [{ turno: 'dia', items: [{ productoId: 'no-existe', cocinado: 1, guardado: 0 }] }, /no existe/],
      [{ turno: 'dia', items: [{ productoId: CHIPA, cocinado: 1, guardado: 0 }] }, /no es un producto de este sector/],
    ]
    for (const [cuerpo, mensaje] of casos) {
      const r = await enviar(cuerpo)
      expect(r.status, JSON.stringify(cuerpo)).toBe(400)
      expect(r.body.error.codigo).toBe('datos_invalidos')
      expect(r.body.error.mensaje).toMatch(mensaje)
    }
    await p.sql("UPDATE productos SET activo = 0 WHERE id = ?", MARINERA)
    const inactivo = await enviar({ turno: 'dia', items: [{ productoId: MARINERA, cocinado: 1, guardado: 0 }] })
    expect(inactivo.status).toBe(400)
    expect(inactivo.body.error.mensaje).toMatch(/desactivado/)
    expect(await p.sql('SELECT COUNT(*) AS n FROM producciones')).toEqual([{ n: 0 }])
    expect(await p.sql('SELECT COUNT(*) AS n FROM movimientos')).toEqual([{ n: 0 }])
  })

  it('pide sesión', async () => {
    const p = await nuevaPrueba()
    expect((await p.pedir(null, 'GET', '/producciones')).status).toBe(401)
    expect((await p.pedir(null, 'POST', '/producciones', { turno: 'dia', items: [] })).status).toBe(401)
  })
})

describe('sector de cada usuario (A03)', () => {
  it('un operador carga y ve solo su sector', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const chipitas = await p.entrar('chipitas')
    await registrarAnexo(p, cocina)
    const propia = await p.pedir<Produccion>(chipitas, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: 'prod-chipitas-01', cocinado: 10, guardado: 5 }],
    })
    expect(propia.status).toBe(200)
    expect(propia.body.sector).toBe('chipitas')

    const otra = await p.pedir(chipitas, 'POST', '/producciones', {
      sector: 'cocina', turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 0 }],
    })
    expect(otra.status).toBe(403)
    // Tampoco puede meter un producto de otro sector en el suyo.
    const ajeno = await p.pedir(chipitas, 'POST', '/producciones', {
      turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 0 }],
    })
    expect(ajeno.status).toBe(400)

    const lista = await p.pedir<Produccion[]>(chipitas, 'GET', '/producciones')
    expect(lista.body.map((x) => x.sector)).toEqual(['chipitas'])
    expect((await p.pedir(chipitas, 'GET', '/producciones?sector=cocina')).status).toBe(403)
    expect((await p.pedir(chipitas, 'GET', '/producciones?sector=chipitas')).status).toBe(200)
  })

  it('el administrador ve todos los sectores o uno y carga indicando el sector', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await registrarAnexo(p, await p.entrar('cocina'))
    await p.pedir(await p.entrar('panaderia'), 'POST', '/producciones', {
      turno: 'noche', items: [{ productoId: 'prod-panaderia-01', cocinado: 40, guardado: 0 }],
    })
    expect((await p.pedir<Produccion[]>(admin, 'GET', '/producciones')).body).toHaveLength(2)
    const soloCocina = await p.pedir<Produccion[]>(admin, 'GET', '/producciones?sector=cocina')
    expect(soloCocina.body.map((x) => x.sector)).toEqual(['cocina'])
    expect((await p.pedir(admin, 'GET', '/producciones?sector=otro')).status).toBe(400)

    const sinSector = await p.pedir(admin, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 0 }] })
    expect(sinSector.status).toBe(400)
    const conSector = await p.pedir<Produccion>(admin, 'POST', '/producciones', {
      sector: 'cocina', turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 2 }],
    })
    expect(conSector.status).toBe(200)
    expect(conSector.body).toMatchObject({ sector: 'cocina', usuarioId: 'usr-admin', usuarioNombre: 'Administración' })
  })

  it('filtra por días en hora de Paraguay, el más nuevo primero', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const hoy = diaPY()
    const ayer = sumarDias(hoy, -1)
    await p.sql(
      "INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES ('vieja', 'cocina', 'usr-cocina', ?, ?, 'noche')",
      `${ayer}T23:00:00.000Z`, ayer,
    )
    await p.sql("INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES ('vieja', ?, 4, 0)", MARINERA)
    const nueva = await registrarAnexo(p, t)

    const todas = await p.pedir<Produccion[]>(t, 'GET', '/producciones')
    expect(todas.body.map((x) => x.id)).toEqual([nueva.body.id, 'vieja'])
    const deHoy = await p.pedir<Produccion[]>(t, 'GET', `/producciones?desde=${hoy}&hasta=${hoy}`)
    expect(deHoy.body.map((x) => x.id)).toEqual([nueva.body.id])
    const deAyer = await p.pedir<Produccion[]>(t, 'GET', `/producciones?desde=${ayer}&hasta=${ayer}`)
    expect(deAyer.body.map((x) => x.id)).toEqual(['vieja'])
    expect(deAyer.body[0].items).toEqual([{ productoId: MARINERA, productoNombre: 'Marinera de carne', cocinado: 4, guardado: 0 }])
    expect((await p.pedir(t, 'GET', '/producciones?desde=10-10-2026')).status).toBe(400)
    expect((await p.pedir(t, 'GET', `/producciones?desde=${hoy}&hasta=${ayer}`)).status).toBe(400)
  })
})

describe('Chipería: lotes de materia prima y de chipa (E02–E04)', () => {
  it('liga la producción al lote de harina, crea su lote y guarda horno y congelador (anexo E02–E04)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const harina = await loteMP(p, { insumo: 'Harina', proveedor: 'Molino Central', numero: 'H-77' })
    const r = await p.pedir<Produccion>(t, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [harina], items: [{ productoId: CHIPA, cocinado: 200, guardado: 300 }],
    })
    expect(r.status).toBe(200)
    const codigo = `CH-${diaPY().slice(2).replaceAll('-', '')}-1`
    expect(r.body.items).toEqual([{ productoId: CHIPA, productoNombre: 'Chipa tradicional', cocinado: 200, guardado: 300 }])
    expect(r.body.lote).toMatchObject({
      codigo, amasada: 1, dia: diaPY(), produccionId: r.body.id, horno: 200, congelador: 300, stock: 300,
      lotesMP: [{ id: harina, descripcion: 'Harina · Molino Central · lote H-77' }],
    })
    expect(await p.sql('SELECT lote_mp_id FROM lote_chipa_mp')).toEqual([{ lote_mp_id: harina }])
    const movs = await p.sql('SELECT tipo, cantidad, lote, produccion_id FROM movimientos')
    expect(movs).toEqual([{ tipo: 'produccion', cantidad: 300, lote: codigo, produccion_id: r.body.id }])
    expect(await stock(p, 'chiperia', CHIPA, codigo)).toBe(300)
  })

  it('numera las amasadas del día y pone el lote en cada movimiento', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const queso = await loteMP(p, { insumo: 'Queso', proveedor: 'Lácteos Tatiana', numero: '' })
    const almidon = await loteMP(p, { insumo: 'Almidón', proveedor: 'Codipsa', numero: '0612' })
    const prefijo = `CH-${diaPY().slice(2).replaceAll('-', '')}-`
    const codigos: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await p.pedir<Produccion>(t, 'POST', '/producciones', {
        turno: 'noche', lotesMP: [queso, almidon, queso],
        items: [{ productoId: CHIPA, cocinado: 10, guardado: 20 }, { productoId: QUESU, cocinado: 0, guardado: 5 }],
      })
      expect(r.status).toBe(200)
      expect(r.body.lote!.amasada).toBe(i + 1)
      expect(r.body.lote!.lotesMP.map((l) => l.id).sort()).toEqual([queso, almidon].sort())
      expect(r.body.lote!.lotesMP.find((l) => l.id === queso)!.descripcion).toMatch(/^Queso · Lácteos Tatiana · ingreso \d\d\/\d\d\/\d{4}$/)
      codigos.push(r.body.lote!.codigo)
    }
    expect(codigos).toEqual([`${prefijo}1`, `${prefijo}2`, `${prefijo}3`])
    const movs = await p.sql("SELECT lote, producto_id, cantidad FROM movimientos WHERE lote = ? ORDER BY producto_id", codigos[1])
    expect(movs).toEqual([
      { lote: codigos[1], producto_id: CHIPA, cantidad: 20 },
      { lote: codigos[1], producto_id: QUESU, cantidad: 5 },
    ])
    const lista = await p.pedir<Produccion[]>(t, 'GET', '/producciones')
    expect(lista.body.map((x) => x.lote?.codigo)).toEqual([...codigos].reverse())
  })

  it('exige al menos un lote de materia prima disponible (E02, E07)', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('chiperia')
    const items = [{ productoId: CHIPA, cocinado: 1, guardado: 1 }]
    const sinLotes = await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items })
    expect(sinLotes.status).toBe(400)
    expect(sinLotes.body.error.mensaje).toMatch(/lotes de materia prima/)
    expect((await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items, lotesMP: [] })).status).toBe(400)

    const bueno = await loteMP(p)
    const bloqueado = await loteMP(p, { insumo: 'Queso', bloqueado: true })
    const vencido = await loteMP(p, { insumo: 'Almidón', vence: sumarDias(diaPY(), -1) })
    for (const [lotes, texto] of [[[bueno, bloqueado], /bloqueado/], [[vencido], /vencido/], [[bueno, 'no-existe'], /ya no existe/]] as const) {
      const r = await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items, lotesMP: lotes })
      expect(r.status).toBe(409)
      expect(r.body.error.codigo).toBe('lote_mp_no_disponible')
      expect(r.body.error.mensaje).toMatch(texto)
    }
    expect(await p.sql('SELECT COUNT(*) AS n FROM producciones')).toEqual([{ n: 0 }])
    expect(await p.sql('SELECT COUNT(*) AS n FROM lotes_chipa')).toEqual([{ n: 0 }])

    // Vence hoy: todavía se puede usar.
    const venceHoy = await loteMP(p, { vence: diaPY() })
    expect((await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items, lotesMP: [venceHoy] })).status).toBe(200)
  })

  it('el administrador también carga Chipería con lote; los otros sectores no crean lotes', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const mp = await loteMP(p)
    const r = await p.pedir<Produccion>(admin, 'POST', '/producciones', {
      sector: 'chiperia', turno: 'dia', lotesMP: [mp], items: [{ productoId: CHIPA, cocinado: 5, guardado: 0 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.lote?.amasada).toBe(1)
    expect(r.body.lote?.congelador).toBe(0)
    // Sin guardado no hay movimiento de stock.
    expect(await p.sql('SELECT COUNT(*) AS n FROM movimientos')).toEqual([{ n: 0 }])

    const cocina = await p.pedir<Produccion>(admin, 'POST', '/producciones', {
      sector: 'cocina', turno: 'dia', lotesMP: [mp], items: [{ productoId: EMPANADA, cocinado: 5, guardado: 2 }],
    })
    expect(cocina.status).toBe(200)
    expect(cocina.body.lote).toBeNull()
    expect(await p.sql('SELECT COUNT(*) AS n FROM lotes_chipa')).toEqual([{ n: 1 }])
  })
})

describe('corrección del administrador (C04)', () => {
  it('corrige cantidades, ajusta el stock y anota quién y cuándo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const original = await registrarAnexo(p, await p.entrar('cocina'))
    const antes = Date.now()
    const r = await p.pedir<Produccion>(admin, 'PATCH', `/producciones/${original.body.id}`, {
      items: [{ productoId: EMPANADA, cocinado: 32, guardado: 6 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.corregidoPor).toBe('usr-admin')
    expect(r.body.corregidoPorNombre).toBe('Administración')
    expect(Date.parse(r.body.corregidoEn!)).toBeGreaterThanOrEqual(antes - 1000)
    // El autor y la fecha original no cambian; lo que no vino en el pedido queda igual.
    expect(r.body).toMatchObject({ usuarioId: 'usr-cocina', fecha: original.body.fecha })
    expect(r.body.items).toEqual([
      { productoId: EMPANADA, productoNombre: 'Empanada frita (carne)', cocinado: 32, guardado: 6 },
      { productoId: MARINERA, productoNombre: 'Marinera de carne', cocinado: 15, guardado: 0 },
      { productoId: HAMBURGUESA, productoNombre: 'Hamburguesa (ejemplo)', cocinado: 3, guardado: 0 },
    ])

    const ajustes = await p.sql("SELECT * FROM movimientos WHERE tipo = 'ajuste'")
    expect(ajustes).toHaveLength(1)
    expect(ajustes[0]).toMatchObject({
      sector: 'cocina', producto_id: EMPANADA, cantidad: -2, lote: null, motivo: 'Corrección de producción',
      produccion_id: original.body.id, usuario_id: 'usr-admin',
    })
    expect(await stock(p, 'cocina', EMPANADA)).toBe(6)

    const [aud] = await p.sql("SELECT * FROM auditoria WHERE tabla = 'producciones'")
    expect(aud).toMatchObject({ registro_id: original.body.id, accion: 'corregir', usuario_id: 'usr-admin' })
    expect(JSON.parse(aud.antes).items[0]).toMatchObject({ productoId: EMPANADA, cocinado: 30, guardado: 8 })
    expect(JSON.parse(aud.despues).items[0]).toMatchObject({ productoId: EMPANADA, cocinado: 32, guardado: 6 })

    // Subir lo guardado suma al stock; cambiar solo lo cocinado no mueve el stock.
    await p.pedir(admin, 'PATCH', `/producciones/${original.body.id}`, { items: [{ productoId: EMPANADA, cocinado: 32, guardado: 9 }] })
    await p.pedir(admin, 'PATCH', `/producciones/${original.body.id}`, { items: [{ productoId: MARINERA, cocinado: 14, guardado: 0 }] })
    expect(await stock(p, 'cocina', EMPANADA)).toBe(9)
    expect(await p.sql("SELECT cantidad FROM movimientos WHERE tipo = 'ajuste' ORDER BY fecha, cantidad")).toEqual([{ cantidad: -2 }, { cantidad: 3 }])
    expect(await p.sql("SELECT COUNT(*) AS n FROM auditoria WHERE tabla = 'producciones'")).toEqual([{ n: 3 }])
  })

  it('agrega un producto olvidado y lo suma al stock', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const original = await registrarAnexo(p, await p.entrar('cocina'))
    const r = await p.pedir<Produccion>(admin, 'PATCH', `/producciones/${original.body.id}`, {
      items: [{ productoId: 'prod-cocina-16', cocinado: 0, guardado: 4 }],
    })
    expect(r.status).toBe(200)
    expect(r.body.items.map((i) => i.productoId)).toContain('prod-cocina-16')
    expect(await stock(p, 'cocina', 'prod-cocina-16')).toBe(4)
    // Pero no uno de otro sector.
    const ajeno = await p.pedir(admin, 'PATCH', `/producciones/${original.body.id}`, { items: [{ productoId: CHIPA, cocinado: 1, guardado: 0 }] })
    expect(ajeno.status).toBe(400)
  })

  it('en Chipería el ajuste va al lote de esa producción', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const mp = await loteMP(p)
    const r = await p.pedir<Produccion>(await p.entrar('chiperia'), 'POST', '/producciones', {
      turno: 'dia', lotesMP: [mp], items: [{ productoId: CHIPA, cocinado: 200, guardado: 300 }],
    })
    const codigo = r.body.lote!.codigo
    const c = await p.pedir<Produccion>(admin, 'PATCH', `/producciones/${r.body.id}`, {
      items: [{ productoId: CHIPA, cocinado: 210, guardado: 290 }],
    })
    expect(c.status).toBe(200)
    expect(c.body.lote).toMatchObject({ codigo, horno: 210, congelador: 290, stock: 290 })
    expect(await p.sql("SELECT lote, cantidad FROM movimientos WHERE tipo = 'ajuste'")).toEqual([{ lote: codigo, cantidad: -10 }])
  })

  it('no deja bajar lo guardado si ese stock ya salió, y no cambia nada (409)', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const original = await registrarAnexo(p, await p.entrar('cocina'))
    // Salen 5 de las 8 empanadas guardadas (lo carga el módulo de stock; acá, directo en la base).
    await p.sql(
      "INSERT INTO movimientos (id, sector, producto_id, tipo, cantidad, usuario_id, fecha, dia) VALUES ('s1', 'cocina', ?, 'salida_venta', -5, 'usr-cocina', ?, ?)",
      EMPANADA, new Date().toISOString(), diaPY(),
    )
    const r = await p.pedir(admin, 'PATCH', `/producciones/${original.body.id}`, {
      items: [{ productoId: EMPANADA, cocinado: 30, guardado: 2 }, { productoId: MARINERA, cocinado: 20, guardado: 0 }],
    })
    expect(r.status).toBe(409)
    expect(r.body.error.codigo).toBe('stock_insuficiente')
    const despues = await p.pedir<Produccion[]>(admin, 'GET', '/producciones')
    expect(despues.body[0].items).toEqual(original.body.items)
    expect(despues.body[0].corregidoPor).toBeNull()
    expect(await p.sql("SELECT COUNT(*) AS n FROM movimientos WHERE tipo = 'ajuste'")).toEqual([{ n: 0 }])
    expect(await p.sql('SELECT COUNT(*) AS n FROM auditoria')).toEqual([{ n: 0 }])
    // Bajar hasta lo que queda sí se puede.
    const ok = await p.pedir(admin, 'PATCH', `/producciones/${original.body.id}`, { items: [{ productoId: EMPANADA, cocinado: 30, guardado: 5 }] })
    expect(ok.status).toBe(200)
    expect(await stock(p, 'cocina', EMPANADA)).toBe(0)
  })

  it('solo el administrador corrige, y valida el pedido', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    const original = await registrarAnexo(p, cocina)
    const ruta = `/producciones/${original.body.id}`
    const op = await p.pedir(cocina, 'PATCH', ruta, { items: [{ productoId: EMPANADA, cocinado: 1, guardado: 1 }] })
    expect(op.status).toBe(403)
    expect(op.body.error.codigo).toBe('prohibido')

    expect((await p.pedir(admin, 'PATCH', '/producciones/no-existe', { items: [{ productoId: EMPANADA, cocinado: 1, guardado: 1 }] })).status).toBe(404)
    const sinCambios = await p.pedir(admin, 'PATCH', ruta, { items: [{ productoId: EMPANADA, cocinado: 30, guardado: 8 }] })
    expect(sinCambios.status).toBe(400)
    expect(sinCambios.body.error.mensaje).toMatch(/No hay cambios/)
    const vacio = await p.pedir(admin, 'PATCH', ruta, {
      items: [EMPANADA, MARINERA, HAMBURGUESA].map((productoId) => ({ productoId, cocinado: 0, guardado: 0 })),
    })
    expect(vacio.status).toBe(400)
    expect(vacio.body.error.mensaje).toMatch(/al menos una cantidad/)
    expect((await p.pedir(admin, 'PATCH', ruta, { items: [{ productoId: EMPANADA, cocinado: -3, guardado: 1 }] })).status).toBe(400)
    expect((await p.pedir(admin, 'PATCH', ruta, {})).status).toBe(400)

    // Un producto que se desactivó después igual se puede corregir en un registro viejo.
    await p.sql('UPDATE productos SET activo = 0 WHERE id = ?', EMPANADA)
    const viejo = await p.pedir(admin, 'PATCH', ruta, { items: [{ productoId: EMPANADA, cocinado: 31, guardado: 8 }] })
    expect(viejo.status).toBe(200)
  })
})
