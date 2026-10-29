// Historial de ejemplo para la demo: dos semanas de trabajo de los cuatro sectores, cargado a través de la
// misma API que usan las pantallas y después corrido a su día y hora (hora de Paraguay). Así los reportes,
// la trazabilidad y los historiales muestran datos desde el primer ingreso.
import { diaPY, sumarDias, diaDeSemana } from '../shared/hora'
import type { AreaLimpieza, Marca, Momento, Produccion, StockFila } from '../shared/tipos'
import { crearApp } from '../server/app'
import type { Env } from '../server/entorno'
import { CLAVE_DEMO } from './base'
import type { D1SqlJs } from './d1-sqljs'

const DIAS = 14

/** Números pseudoaleatorios repetibles, para que la demo sea siempre igual. */
function azar(semilla: number) {
  return () => {
    semilla |= 0
    semilla = (semilla + 0x6d2b79f5) | 0
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "2026-10-09" + 7.5 h en Paraguay (UTC−3) → ISO en UTC. */
const fechaISO = (dia: string, horas: number) =>
  new Date(Date.parse(`${dia}T00:00:00-03:00`) + Math.round(horas * 3600) * 1000).toISOString()

export async function cargarHistorialDemo(d1: D1SqlJs): Promise<void> {
  const app = crearApp()
  const env: Env = { DB: d1, MODO_DEMO: '1' }
  const r = azar(20261009)
  const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))

  async function pedir<T>(token: string, metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const res = await app.fetch(
      new Request(`http://demo.local/api${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      }),
      env,
    )
    const datos = await res.json()
    if (!res.ok) throw new Error(`${metodo} ${ruta}: ${JSON.stringify(datos)}`)
    return datos as T
  }

  async function entrar(usuario: string): Promise<string> {
    const res = await app.fetch(
      new Request('http://demo.local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, clave: CLAVE_DEMO }),
      }),
      env,
    )
    return ((await res.json()) as { token: string }).token
  }

  const sql = (consulta: string, ...params: (string | number | null)[]) => d1.db.run(consulta, params)

  /**
   * Corre una acción de la API y lleva al día y hora indicados todo lo que creó.
   * Lo nuevo se reconoce porque su fecha es posterior a la marca tomada antes de la acción.
   * Lo de hoy que todavía no pasó (por la hora) no se carga: devuelve null.
   */
  async function el<T>(dia: string, horas: number, accion: () => Promise<T>): Promise<T | null> {
    const fecha = fechaISO(dia, horas)
    if (fecha > new Date(Date.now() - 60_000).toISOString()) return null
    const marca = new Date(Date.now() - 1).toISOString()
    const res = await accion()
    for (const tabla of ['producciones', 'movimientos', 'lecturas', 'limpiezas']) {
      sql(`UPDATE ${tabla} SET fecha = ?, dia = ? WHERE fecha >= ?`, fecha, dia, marca)
    }
    sql('UPDATE limpiezas SET controlado_en = ? WHERE controlado_en >= ?', fecha, marca)
    sql('UPDATE producciones SET corregido_en = ? WHERE corregido_en >= ?', fecha, marca)
    // La auditoría guarda también fechas dentro del antes/después (por ejemplo, cuándo se controló).
    const nuevas = d1.db.exec('SELECT id, antes, despues FROM auditoria WHERE fecha >= ?', [marca])[0]?.values ?? []
    const correr = (texto: unknown) =>
      typeof texto === 'string' ? texto.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, (f) => (f >= marca ? fecha : f)) : texto
    for (const [id, antes, despues] of nuevas) {
      sql('UPDATE auditoria SET fecha = ?, antes = ?, despues = ? WHERE id = ?', fecha, correr(antes) as string | null, correr(despues) as string | null, id as string)
    }
    sql('UPDATE lotes_mp SET creado_en = ? WHERE creado_en >= ?', fecha, marca)
    return res
  }

  /** El lote se numeró con la fecha de hoy: se renombra con la del día que corresponde. */
  function renombrarLote(p: Produccion | null, dia: string): string | null {
    if (!p?.lote) return null
    const amasada = (d1.db.exec('SELECT COALESCE(MAX(amasada), 0) + 1 FROM lotes_chipa WHERE dia = ? AND id <> ?', [dia, p.lote.id])[0]
      ?.values[0][0] as number) ?? 1
    const codigo = `CH-${dia.slice(2).replaceAll('-', '')}-${amasada}`
    sql('UPDATE lotes_chipa SET codigo = ?, dia = ?, amasada = ? WHERE id = ?', codigo, dia, amasada, p.lote.id)
    sql('UPDATE movimientos SET lote = ? WHERE lote = ?', codigo, p.lote.codigo)
    return codigo
  }

  const t = {
    admin: await entrar('admin'),
    chiperia: await entrar('chiperia'),
    chipitas: await entrar('chipitas'),
    panaderia: await entrar('panaderia'),
    cocina: await entrar('cocina'),
  }
  const hoy = diaPY()
  const inicio = sumarDias(hoy, -DIAS)

  // ---------- Arranque: configuración, stock inicial (D07) y materia prima (E01) ----------
  const url = typeof location === 'undefined' ? 'https://darkronier.github.io/Chipa-Tia-IS' : location.href.split('#')[0].replace(/\/$/, '')
  await pedir(t.admin, 'PATCH', '/config', { correoReportes: 'administracion@chipatia.com.py', urlPublica: url }).catch(() => undefined)
  await el(inicio, 6, async () => {
    for (const [productoId, cantidad] of [['prod-cocina-10', 24], ['prod-cocina-15', 10], ['prod-cocina-04', 18]] as const) {
      await pedir(t.admin, 'POST', '/ajustes', { sector: 'cocina', productoId, tipo: 'stock_inicial', cantidad, motivo: 'Stock existente al empezar a usar el sistema' })
    }
  })
  // C08: algunos productos con stock mínimo, para que el aviso se vea en la demo.
  for (const [productoId, stockMinimo] of [['prod-cocina-10', 15], ['prod-cocina-04', 12], ['prod-chipitas-01', 400]] as const) {
    await pedir(t.admin, 'PATCH', `/productos/${productoId}`, { stockMinimo })
  }
  const nuevoLoteMP = async (insumo: string, proveedor: string, numeroLote: string, dia: string, cantidad: number, vence: number) =>
    (await el(dia, 6.5, () => pedir<{ id: string }>(t.chiperia, 'POST', '/lotes-mp', {
      insumo, proveedor, numeroLote, fechaIngreso: dia, cantidad, unidad: 'kg', vencimiento: sumarDias(hoy, vence),
    })))!
  const queso1 = await nuevoLoteMP('Queso Paraguay', 'Lácteos Tatiana', '', inicio, 120, 20)
  const almidon = await nuevoLoteMP('Almidón de mandioca', 'Codipsa', 'A-1206', inicio, 500, 120)
  const harina = await nuevoLoteMP('Harina de trigo', 'Molinos del Sur', 'H-0921', inicio, 200, 90)
  const queso2 = await nuevoLoteMP('Queso Paraguay', 'Lácteos Tatiana', '', sumarDias(inicio, 7), 120, 27)
  // Vence en pocos días y no se usa: sale en las alertas de vencimiento (E10).
  await nuevoLoteMP('Leche en polvo', 'Lácteos Tatiana', 'LP-310', sumarDias(hoy, -2), 25, 3)
  const quesoMalo = await nuevoLoteMP('Queso Paraguay', 'Lácteos San Juan', 'SJ-88', sumarDias(inicio, 9), 40, 15)
  await el(sumarDias(inicio, 10), 9, () => pedir(t.admin, 'PATCH', `/lotes-mp/${quesoMalo.id}`, { bloqueado: true }))
  // Un lote ya vencido, que no se puede elegir (E07).
  sql(`INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
       VALUES ('mp-demo-vencido', 'Grasa vacuna', 'Frigorífico Itapúa', 'G-77', ?, 30, 'kg', ?, 0, 'usr-chiperia', ?)`,
  sumarDias(inicio, -20), sumarDias(hoy, -3), fechaISO(sumarDias(inicio, -20), 7))

  const areas = new Map<string, AreaLimpieza[]>()
  for (const s of ['chiperia', 'chipitas', 'panaderia', 'cocina'] as const) {
    areas.set(s, await pedir<AreaLimpieza[]>(t[s], 'GET', '/areas'))
  }

  // ---------- Cada día ----------
  for (let n = DIAS - 1; n >= 0; n--) {
    const dia = sumarDias(hoy, -n)
    const lunes = diaDeSemana(dia) === 0
    const quesoDelDia = n > 7 ? queso1.id : queso2.id

    // Chipería: dos amasadas (E02–E04), envío por lote (E05) y salida a venta.
    const amasada1 = await el(dia, 5.5, () => pedir<Produccion>(t.chiperia, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [{ id: quesoDelDia, cantidad: 3 }, { id: almidon.id, cantidad: 5 }],
      items: [
        { productoId: 'prod-chiperia-01', cocinado: entre(180, 240), guardado: entre(140, 200), finalidad: 'distribucion' },
        { productoId: 'prod-chiperia-03', cocinado: entre(80, 120), guardado: entre(60, 90) },
        { productoId: 'prod-chiperia-09', cocinado: entre(40, 60), guardado: 0 },
      ],
    }))
    const lote1 = renombrarLote(amasada1, dia)
    const amasada2 = await el(dia, 9, () => pedir<Produccion>(t.chiperia, 'POST', '/producciones', {
      turno: 'dia', lotesMP: [{ id: quesoDelDia, cantidad: 3 }, { id: almidon.id, cantidad: 5 }, { id: harina.id, cantidad: 8 }],
      items: [
        { productoId: 'prod-chiperia-02', cocinado: entre(100, 140), guardado: entre(80, 110), finalidad: 'distribucion' },
        { productoId: 'prod-chiperia-05', cocinado: entre(30, 50), guardado: entre(20, 40) },
      ],
    }))
    const lote2 = renombrarLote(amasada2, dia)
    if (lote1 && lote2) {
      await el(dia, 10.5, () => pedir(t.chiperia, 'POST', '/envios', {
        sucursalId: n % 2 ? 'suc-ruta1' : 'suc-centro',
        items: [
          { productoId: 'prod-chiperia-01', lote: lote1, cantidad: 100 },
          { productoId: 'prod-chiperia-02', lote: lote2, cantidad: 50 },
        ],
      }))
      await el(dia, 14, () => pedir(t.chiperia, 'POST', '/salidas', { productoId: 'prod-chiperia-03', lote: lote1, cantidad: 30 }))
    }

    // Cocina: turno día y noche (C01–C02), salida a venta (D02) y envíos (D03).
    await el(dia, 6, () => pedir(t.cocina, 'POST', '/producciones', {
      turno: 'dia',
      items: [
        { productoId: 'prod-cocina-10', cocinado: entre(28, 40), guardado: entre(8, 14), finalidad: 'distribucion' },
        { productoId: 'prod-cocina-15', cocinado: entre(12, 18), guardado: entre(4, 8), finalidad: 'distribucion' },
        { productoId: 'prod-cocina-16', cocinado: entre(15, 25), guardado: 0 },
        { productoId: 'prod-cocina-19', cocinado: entre(10, 16), guardado: 0 },
        { productoId: 'prod-cocina-25', cocinado: entre(30, 45), guardado: 0 },
      ],
    }))
    await el(dia, 17, () => pedir(t.cocina, 'POST', '/producciones', {
      turno: 'noche',
      items: [
        { productoId: 'prod-cocina-04', cocinado: entre(20, 30), guardado: entre(6, 10) },
        { productoId: 'prod-cocina-07', cocinado: entre(15, 25), guardado: entre(4, 8) },
      ],
    }))
    await el(dia, 11, () => pedir(t.cocina, 'POST', '/salidas', { productoId: 'prod-cocina-04', cantidad: entre(3, 6) }))
    await el(dia, 12, () => pedir(t.cocina, 'POST', '/envios', {
      sucursalId: ['suc-centro', 'suc-ruta1', 'suc-encarnacion'][n % 3],
      items: [
        { productoId: 'prod-cocina-10', cantidad: entre(4, 6) },
        { productoId: 'prod-cocina-15', cantidad: entre(2, 4) },
      ],
    }))

    // Chipitas y Panadería.
    await el(dia, 7, () => pedir(t.chipitas, 'POST', '/producciones', {
      turno: 'dia',
      items: [
        { productoId: 'prod-chipitas-01', cocinado: entre(150, 250), guardado: entre(250, 350), finalidad: 'distribucion' },
        { productoId: 'prod-chipitas-02', cocinado: entre(40, 80), guardado: entre(80, 120), finalidad: 'distribucion' },
      ],
    }))
    await el(dia, 13, () => pedir(t.chipitas, 'POST', '/envios', {
      sucursalId: n % 2 ? 'suc-encarnacion' : 'suc-centro',
      items: [{ productoId: 'prod-chipitas-01', cantidad: entre(150, 220) }, { productoId: 'prod-chipitas-02', cantidad: entre(40, 70) }],
    }))
    await el(dia, 4.5, () => pedir(t.panaderia, 'POST', '/producciones', {
      turno: 'dia',
      items: [
        { productoId: 'prod-panaderia-01', cocinado: entre(300, 450), guardado: 0 },
        { productoId: 'prod-panaderia-02', cocinado: entre(80, 120), guardado: entre(20, 40), finalidad: 'distribucion' },
        { productoId: 'prod-panaderia-03', cocinado: entre(50, 80), guardado: entre(30, 50) },
      ],
    }))
    await el(dia, 8, () => pedir(t.panaderia, 'POST', '/envios', {
      sucursalId: 'suc-ruta1',
      items: [{ productoId: 'prod-panaderia-02', cantidad: entre(10, 20) }],
    }))

    // Temperaturas: inicio y fin de jornada en los equipos fríos; buffet con T° inicial e intermedia (F01–F04).
    const lecturas: [string, string, Momento, number, number][] = [
      ['cocina', 'maq-cocina-1', 'inicio', 2, 4], ['cocina', 'maq-cocina-2', 'inicio', -21, -18], ['cocina', 'maq-cocina-3', 'inicio', -22, -18],
      ['cocina', 'maq-cocina-4', 'inicio', -24, -19], ['cocina', 'maq-cocina-6', 'inicial', 3, 7], ['cocina', 'maq-cocina-7', 'inicial', 65, 72],
      ['chiperia', 'maq-chiperia-1', 'inicio', -22, -18], ['chiperia', 'maq-chiperia-2', 'inicio', -25, -19],
    ]
    for (const [i, [sector, maquinaId, momento, min, max]] of lecturas.entries()) {
      for (const [k, m] of [[0, momento], [1, momento === 'inicial' ? 'intermedia' : 'fin']] as const) {
        let temperatura = entre(min * 10, max * 10) / 10
        // Algunos días un equipo queda fuera de rango (F04).
        const fuera = (n === 3 && i === 0 && k === 1) || (n === 8 && i === 1 && k === 0) || (n === 5 && i === 5 && k === 1) || (n === 1 && i === 6 && k === 1)
        if (fuera) temperatura = i === 0 ? 9 : i === 5 ? 58 : -14
        await el(dia, k ? 18 : 5.2 + i * 0.05, () => pedir(t[sector as 'cocina'], 'POST', '/lecturas', {
          maquinaId, momento: m, estado: 'funciona', temperatura,
          observacion: fuera ? 'Se avisó al encargado y se revisó la puerta.' : '',
        }))
      }
    }
    if (n === 6) {
      await el(dia, 10, () => pedir(t.cocina, 'POST', '/lecturas', {
        maquinaId: 'maq-cocina-5', momento: 'otro', estado: 'con_fallas', temperatura: null,
        observacion: 'Una resistencia no calienta; tarda el doble en cocinar.',
        mantenimiento: 'Cambio de resistencia', mantenimientoPor: 'Electro Bogado (técnico)',
      }))
    }

    // Limpieza por área (G01–G02), con algunas tareas sin hacer y la profunda de los lunes.
    const porSector: [keyof typeof t, string[]][] = [
      ['chiperia', ['chiperia']], ['chipitas', ['chipitas']], ['panaderia', ['panaderia']],
      ['cocina', n % 2 ? ['cocina', 'lavadero'] : ['cocina', 'buffet']],
    ]
    for (const [sector, ids] of porSector) {
      for (const areaId of ids) {
        const area = areas.get(sector)!.find((a) => a.id === areaId)
        if (!area) continue
        const marcas = area.tareas.filter((x) => x.activo).map((x, j) => {
          const marca: Marca = lunes && j % 3 === 0 ? 'XX' : r() < 0.06 ? '-' : 'X'
          return { tareaId: x.id, marca, numero: x.pideNumero ? String(1 + (j % 2)) : null }
        })
        const lim = await el(dia, 15.5, () => pedir<{ id: string }>(t[sector], 'POST', '/limpiezas', {
          areaId, marcas, comentario: marcas.some((m) => m.marca === '-') ? 'Faltó producto de limpieza.' : '',
        }))
        // El supervisor controla las planillas de días anteriores (G03).
        if (lim && n >= 2) await el(dia, 19, () => pedir(t.admin, 'POST', `/limpiezas/${lim.id}/control`))
      }
    }

    // Administración: una merma y un vencimiento (D06), y una corrección de producción (C04).
    if (n === 4) {
      await el(dia, 16, () => pedir(t.admin, 'POST', '/ajustes', {
        sector: 'cocina', productoId: 'prod-cocina-10', tipo: 'merma', cantidad: 2, motivo: 'Se rompieron al sacarlas del freezer',
      }))
      const stockChipa = await pedir<StockFila[]>(t.admin, 'GET', '/stock?sector=chiperia')
      const viejo = stockChipa.find((s) => s.productoId === 'prod-chiperia-02')?.lotes.find((l) => l.distribucion > 0)
      if (viejo) {
        await el(dia, 16.2, () => pedir(t.admin, 'POST', '/ajustes', {
          sector: 'chiperia', productoId: 'prod-chiperia-02', lote: viejo.lote, tipo: 'vencimiento', finalidad: 'distribucion',
          cantidad: Math.min(10, viejo.distribucion), motivo: 'Pasó la fecha de consumo en el congelador',
        }))
      }
    }
    if (n === 2) {
      const [ultima] = await pedir<Produccion[]>(t.admin, 'GET', `/producciones?sector=cocina&desde=${dia}&hasta=${dia}`)
      const item = ultima?.items[0]
      if (item) {
        await el(dia, 20, () => pedir(t.admin, 'PATCH', `/producciones/${ultima.id}`, {
          items: [{ productoId: item.productoId, cocinado: item.cocinado + 2, guardado: item.guardado }],
        }))
      }
    }
  }

  // Las sesiones abiertas para cargar el historial no se usan más.
  sql('DELETE FROM sesiones')
}
