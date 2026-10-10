// Revisión de seguridad de la API: aislamiento por sector (A03), rutas del administrador, sesiones,
// validación de entradas, SQL con parámetros, correo escapado, exportaciones sin secretos y límites de D1.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diaPY, sumarDias } from '../src/shared/hora'
import type { LoteMP, Produccion } from '../src/shared/tipos'
import { crearApp } from '../src/server/app'
import { sha256 } from '../src/server/clave'
import { nuevaPrueba, type Prueba } from './ayuda'

const CHIPA = 'prod-chiperia-01'
const EMPANADA = 'prod-cocina-10'
const hoy = () => diaPY()
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64')

/** Pedido con el cuerpo crudo (JSON roto, cuerpos enormes). */
async function crudo(p: Prueba, token: string | null, metodo: string, ruta: string, texto: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await crearApp().fetch(new Request(`http://prueba/api${ruta}`, { method: metodo, headers, body: texto }), p.env)
  const t = await r.text()
  let body: any = t
  try {
    body = JSON.parse(t)
  } catch {
    // no JSON
  }
  return { status: r.status, body }
}

async function tareasDe(p: Prueba, areaId: string): Promise<string[]> {
  return (await p.sql('SELECT id FROM tareas_limpieza WHERE area_id = ? AND activo = 1', areaId)).map((t) => t.id)
}

async function limpieza(p: Prueba, token: string, areaId: string, extra: Record<string, unknown> = {}) {
  const marcas = (await tareasDe(p, areaId)).map((tareaId) => ({ tareaId, marca: 'X' }))
  return p.pedir(token, 'POST', '/limpiezas', { areaId, marcas, ...extra })
}

/** Datos de Chipería: lote de materia prima, amasada con stock, lectura con foto y limpieza. */
async function datosChiperia(p: Prueba) {
  const t = await p.entrar('chiperia')
  const mp = await p.pedir<LoteMP>(t, 'POST', '/lotes-mp', {
    insumo: 'Queso', proveedor: 'Lácteos', fechaIngreso: hoy(), cantidad: 10, vencimiento: sumarDias(hoy(), 30),
  })
  const prod = await p.pedir<Produccion>(t, 'POST', '/producciones', {
    turno: 'dia', lotesMP: [mp.body.id], items: [{ productoId: CHIPA, cocinado: 5, guardado: 40 }],
  })
  expect(prod.status).toBe(200)
  const lote = prod.body.lote!.codigo
  const lectura = await p.pedir(t, 'POST', '/lecturas', {
    maquinaId: 'maq-chiperia-1', momento: 'inicio', estado: 'funciona', temperatura: -20,
    observacion: 'Todo bien', foto: `data:image/jpeg;base64,${b64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))}`,
  })
  expect(lectura.status).toBe(200)
  const limp = await limpieza(p, t, 'chiperia')
  expect(limp.status).toBe(200)
  return { token: t, mp: mp.body.id as string, lote, lectura: lectura.body.id as string, limpieza: limp.body.id as string }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- A03: cada sector solo ve y carga lo suyo ----------

describe('aislamiento por sector (A03)', () => {
  it('un operador no puede pedir los listados de otro sector', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    for (const ruta of ['/productos', '/maquinas', '/areas', '/producciones', '/stock', '/movimientos', '/lecturas', '/limpiezas']) {
      const r = await p.pedir(t, 'GET', `${ruta}?sector=chiperia`)
      expect(r.status, ruta).toBe(403)
    }
  })

  it('pasando ids de otro sector no ve nada de Chipería', async () => {
    const p = await nuevaPrueba()
    const ch = await datosChiperia(p)
    const t = await p.entrar('cocina')

    const producciones = await p.pedir(t, 'GET', '/producciones')
    expect(producciones.body).toEqual([])
    for (const q of [`producto=${CHIPA}`, `lote=${ch.lote}`, 'tipo=produccion', 'sucursal=suc-centro']) {
      const r = await p.pedir(t, 'GET', `/movimientos?${q}`)
      expect(r.status).toBe(200)
      expect(r.body, q).toEqual([])
    }
    expect((await p.pedir(t, 'GET', '/lecturas?maquina=maq-chiperia-1')).body).toEqual([])
    expect((await p.pedir(t, 'GET', '/limpiezas?area=chiperia')).body).toEqual([])
    const foto = await p.pedir(t, 'GET', `/lecturas/${ch.lectura}/foto`)
    expect(foto.status).toBe(403)
    expect(JSON.stringify(foto.body)).not.toContain('data:image')

    const stock = await p.pedir(t, 'GET', '/stock')
    expect(stock.body.some((f: any) => f.productoId === CHIPA)).toBe(false)
    for (const ruta of ['/productos', '/maquinas']) {
      const r = await p.pedir(t, 'GET', `${ruta}?todos=1`)
      expect(r.body.every((x: any) => x.sector === 'cocina'), ruta).toBe(true)
    }
    const areas = await p.pedir(t, 'GET', '/areas?todos=1')
    expect(areas.body.every((a: any) => a.sectores.includes('cocina'))).toBe(true)
  })

  it('en un área compartida cada sector ve solo sus propias limpiezas', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const chiperia = await p.entrar('chiperia')
    expect((await limpieza(p, cocina, 'sanitario', { comentario: 'de cocina' })).status).toBe(200)
    const r = await p.pedir(chiperia, 'GET', '/limpiezas?area=sanitario')
    expect(r.body).toEqual([])
  })

  it('no puede cargar con productos, máquinas, áreas ni lotes de otro sector', async () => {
    const p = await nuevaPrueba()
    const ch = await datosChiperia(p)
    const t = await p.entrar('cocina')
    const antes = await p.sql('SELECT COUNT(*) AS n FROM movimientos')

    const intentos: [string, string, unknown, number][] = [
      ['POST', '/salidas', { productoId: CHIPA, cantidad: 1, lote: ch.lote }, 400],
      ['POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: CHIPA, cantidad: 1, lote: ch.lote }] }, 400],
      ['POST', '/producciones', { turno: 'dia', items: [{ productoId: CHIPA, cocinado: 1, guardado: 1 }] }, 400],
      ['POST', '/producciones', { sector: 'chiperia', turno: 'dia', items: [{ productoId: CHIPA, cocinado: 1 }] }, 403],
      ['POST', '/salidas', { sector: 'chiperia', productoId: CHIPA, cantidad: 1, lote: ch.lote }, 403],
      ['POST', '/lecturas', { maquinaId: 'maq-chiperia-1', momento: 'inicio', estado: 'funciona', temperatura: -20 }, 403],
      ['POST', '/limpiezas', { areaId: 'chiperia', marcas: (await tareasDe(p, 'chiperia')).map((tareaId) => ({ tareaId, marca: 'X' })) }, 403],
      ['POST', '/limpiezas', { areaId: 'sanitario', sector: 'chiperia', marcas: [] }, 403],
    ]
    for (const [metodo, ruta, cuerpo, estado] of intentos) {
      const r = await p.pedir(t, metodo, ruta, cuerpo)
      expect(r.status, `${metodo} ${ruta} ${JSON.stringify(cuerpo)}`).toBe(estado)
    }
    expect(await p.sql('SELECT COUNT(*) AS n FROM movimientos')).toEqual(antes)
    expect((await p.sql("SELECT COUNT(*) AS n FROM producciones WHERE usuario_id = 'usr-cocina'"))[0].n).toBe(0)
    expect((await p.sql("SELECT COUNT(*) AS n FROM lecturas WHERE usuario_id = 'usr-cocina'"))[0].n).toBe(0)
    expect((await p.sql("SELECT COUNT(*) AS n FROM limpiezas WHERE usuario_id = 'usr-cocina'"))[0].n).toBe(0)
  })

  it('lotes y trazabilidad: los otros sectores reciben 403 en todas las rutas', async () => {
    const p = await nuevaPrueba()
    const ch = await datosChiperia(p)
    for (const quien of ['cocina', 'chipitas', 'panaderia']) {
      const t = await p.entrar(quien)
      const rutas: [string, string, unknown?][] = [
        ['GET', '/lotes-mp'],
        ['POST', '/lotes-mp', { insumo: 'Harina', proveedor: 'X', fechaIngreso: hoy(), cantidad: 1, vencimiento: sumarDias(hoy(), 5) }],
        ['PATCH', `/lotes-mp/${ch.mp}`, { bloqueado: true }],
        ['GET', '/lotes-chipa'],
        ['GET', `/trazabilidad/mp/${ch.mp}`],
        ['GET', `/trazabilidad/lote/${ch.lote}`],
        ['GET', '/trazabilidad/sucursal/suc-centro'],
      ]
      for (const [metodo, ruta, cuerpo] of rutas) {
        expect((await p.pedir(t, metodo, ruta, cuerpo)).status, `${quien} ${metodo} ${ruta}`).toBe(403)
      }
    }
    expect((await p.sql('SELECT COUNT(*) AS n FROM lotes_mp'))[0].n).toBe(1)
  })
})

// ---------- Solo administrador ----------

const RUTAS_ADMIN: [string, string, unknown?][] = [
  ['GET', '/usuarios'],
  ['POST', '/usuarios', { nombre: 'Intruso', usuario: 'intruso', rol: 'admin', clave: 'segura123' }],
  ['PATCH', '/usuarios/usr-admin', { activo: false }],
  ['PATCH', '/usuarios/usr-cocina', { rol: 'admin' }],
  ['POST', '/usuarios/usr-admin/clave', { clave: 'tomada123' }],
  ['PATCH', '/sectores/cocina', { nombre: 'Otro' }],
  ['POST', '/productos', { sector: 'cocina', nombre: 'Nuevo' }],
  ['PATCH', '/productos/prod-cocina-01', { activo: false }],
  ['POST', '/maquinas', { sector: 'cocina', nombre: 'Nueva', tipo: 'otra' }],
  ['PATCH', '/maquinas/maq-cocina-1', { tempMax: 50 }],
  ['POST', '/areas', { nombre: 'Nueva', sectores: ['cocina'] }],
  ['PATCH', '/areas/cocina', { activo: false }],
  ['POST', '/areas/cocina/tareas', { nombre: 'Nueva' }],
  ['PATCH', '/tareas/tarea-cocina-01', { activo: false }],
  ['POST', '/sucursales', { nombre: 'Nueva' }],
  ['PATCH', '/sucursales/suc-centro', { activo: false }],
  ['PATCH', '/producciones/cualquiera', { items: [] }],
  ['POST', '/ajustes', { tipo: 'stock_inicial', productoId: EMPANADA, cantidad: 100, motivo: 'regalo' }],
  ['POST', '/limpiezas/cualquiera/control'],
  ['GET', '/reportes'],
  ['POST', '/reportes/enviar', { periodo: 'diario' }],
  ['GET', '/config'],
  ['PATCH', '/config', { correoReportes: 'yo@malo.com' }],
  ['GET', '/exportar'],
  ['GET', '/copias'],
  ['POST', '/copias'],
  ['GET', '/copias/copias%2F2026-01-01T000000.json'],
  ['GET', '/auditoria'],
]

describe('rutas del administrador', () => {
  it('rechazan a todos los operadores con 403 y no cambian nada', async () => {
    const p = await nuevaPrueba()
    for (const quien of ['cocina', 'chiperia', 'chipitas', 'panaderia']) {
      const t = await p.entrar(quien)
      for (const [metodo, ruta, cuerpo] of RUTAS_ADMIN) {
        const r = await p.pedir(t, metodo, ruta, cuerpo)
        expect(r.status, `${quien} ${metodo} ${ruta}`).toBe(403)
      }
    }
    expect((await p.sql('SELECT COUNT(*) AS n FROM auditoria'))[0].n).toBe(0)
    expect((await p.sql('SELECT COUNT(*) AS n FROM movimientos'))[0].n).toBe(0)
    expect((await p.sql('SELECT COUNT(*) AS n FROM copias'))[0].n).toBe(0)
    expect((await p.sql("SELECT rol FROM usuarios WHERE id = 'usr-cocina'"))[0].rol).toBe('cocina')
    expect((await p.sql("SELECT activo FROM usuarios WHERE id = 'usr-admin'"))[0].activo).toBe(1)
  })

  it('sin sesión o con un token inventado todo responde 401', async () => {
    const p = await nuevaPrueba()
    const rutas: [string, string, unknown?][] = [
      ...RUTAS_ADMIN,
      ['GET', '/sectores'], ['GET', '/productos'], ['GET', '/stock?sector=cocina'], ['POST', '/salidas', {}],
      ['GET', '/lotes-mp'], ['GET', '/lecturas/x/foto'], ['POST', '/limpiezas', {}], ['GET', '/auth/yo'],
      ['POST', '/auth/logout'], ['POST', '/auth/clave', { actual: '1234', nueva: 'otra123' }], ['GET', '/no-existe'],
    ]
    for (const token of [null, 'x', 'a'.repeat(64)]) {
      for (const [metodo, ruta, cuerpo] of rutas) {
        expect((await p.pedir(token, metodo, ruta, cuerpo)).status, `${token} ${metodo} ${ruta}`).toBe(401)
      }
    }
  })
})

// ---------- Sesiones y contraseñas ----------

describe('sesiones', () => {
  it('un usuario desactivado pierde el acceso al instante, aunque su sesión siga en la base', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await p.sql("UPDATE usuarios SET activo = 0 WHERE id = 'usr-cocina'")
    expect((await p.pedir(t, 'GET', '/productos')).status).toBe(401)
    expect((await p.sql("SELECT COUNT(*) AS n FROM sesiones WHERE usuario_id = 'usr-cocina'"))[0].n).toBe(1)
    // Reactivado por la API, la sesión vieja ya fue borrada al desactivarlo por la API.
    await p.sql("UPDATE usuarios SET activo = 1 WHERE id = 'usr-cocina'")
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', { activo: false })).status).toBe(200)
    expect((await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', { activo: true })).status).toBe(200)
    expect((await p.pedir(t, 'GET', '/productos')).status).toBe(401)
  })

  it('el rol se lee en cada pedido: un cambio de rol corta lo que veía antes', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    await p.sql("UPDATE usuarios SET rol = 'panaderia' WHERE id = 'usr-cocina'")
    const r = await p.pedir(t, 'GET', '/productos')
    expect(r.body.every((x: any) => x.sector === 'panaderia')).toBe(true)
    expect((await p.pedir(t, 'GET', '/productos?sector=cocina')).status).toBe(403)
    // Un administrador que pasa a operador deja de serlo en el mismo momento.
    const a = await p.entrar('admin')
    await p.sql("UPDATE usuarios SET rol = 'cocina' WHERE id = 'usr-admin'")
    expect((await p.pedir(a, 'GET', '/usuarios')).status).toBe(403)
  })

  it('las sesiones vencen y el cierre de sesión corta solo esa sesión', async () => {
    const p = await nuevaPrueba()
    const a = await p.entrar('chipitas')
    const b = await p.entrar('chipitas')
    expect((await p.pedir(a, 'POST', '/auth/logout')).status).toBe(200)
    expect((await p.pedir(a, 'GET', '/auth/yo')).status).toBe(401)
    expect((await p.pedir(b, 'GET', '/auth/yo')).status).toBe(200)
    await p.sql('UPDATE sesiones SET vence_en = ? WHERE token_hash = ?', new Date(Date.now() - 1000).toISOString(), await sha256(b))
    expect((await p.pedir(b, 'GET', '/auth/yo')).status).toBe(401)
  })

  it('los tokens son aleatorios y en la base solo queda su hash', async () => {
    const p = await nuevaPrueba()
    const a = await p.entrar('admin')
    const b = await p.entrar('admin')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    const filas = await p.sql('SELECT token_hash, vence_en FROM sesiones')
    expect(filas.map((f) => f.token_hash).sort()).toEqual([await sha256(a), await sha256(b)].sort())
    expect(JSON.stringify(filas)).not.toContain(a)
    // Vencen a los 30 días.
    const dias = (Date.parse(filas[0].vence_en) - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(29)
    expect(dias).toBeLessThanOrEqual(30)
  })

  it('usuario inexistente y contraseña mal: mismo estado, mismo mensaje y también calcula el PBKDF2', async () => {
    const p = await nuevaPrueba()
    const derivar = vi.spyOn(crypto.subtle, 'deriveBits')
    const mal = await p.pedir(null, 'POST', '/auth/login', { usuario: 'cocina', clave: 'equivocada' })
    expect(derivar).toHaveBeenCalledTimes(1)
    const nadie = await p.pedir(null, 'POST', '/auth/login', { usuario: 'no-existe', clave: 'equivocada' })
    // Sin esto, la respuesta para un usuario que no existe llega mucho antes y delata qué usuarios hay.
    expect(derivar).toHaveBeenCalledTimes(2)
    expect(nadie.status).toBe(mal.status)
    expect(nadie.body).toEqual(mal.body)
    expect(nadie.body.error.codigo).toBe('credenciales')
  })

  it('con una contraseña inicial o restablecida solo puede cambiarla antes de usar el sistema', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const nuevo = await p.pedir(admin, 'POST', '/usuarios', { nombre: 'Rosa', usuario: 'rosa', rol: 'cocina', clave: 'inicial1' })
    expect(nuevo.status).toBe(200)
    const t = await p.entrar('rosa', 'inicial1')
    for (const [metodo, ruta, cuerpo] of [['GET', '/productos'], ['GET', '/stock'], ['POST', '/salidas', { productoId: EMPANADA, cantidad: 1 }]] as const) {
      const r = await p.pedir(t, metodo, ruta, cuerpo)
      expect(r.status, ruta).toBe(403)
      expect(r.body.error.codigo).toBe('debe_cambiar_clave')
    }
    expect((await p.pedir(t, 'GET', '/auth/yo')).body.debeCambiarClave).toBe(true)
    const cambio = await p.pedir(t, 'POST', '/auth/clave', { actual: 'inicial1', nueva: 'propia123' })
    expect(cambio.status).toBe(200)
    expect((await p.pedir(cambio.body.token, 'GET', '/productos')).status).toBe(200)

    // Lo mismo cuando el administrador la restablece.
    expect((await p.pedir(admin, 'POST', `/usuarios/${nuevo.body.id}/clave`, { clave: 'temporal9' })).status).toBe(200)
    const t2 = await p.entrar('rosa', 'temporal9')
    expect((await p.pedir(t2, 'GET', '/productos')).status).toBe(403)
    expect((await p.pedir(t2, 'POST', '/auth/logout')).status).toBe(200)
  })
})

// ---------- Validación de entradas ----------

describe('validación de entradas', () => {
  it('rechaza cuerpos que no son JSON o no son un objeto', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    for (const texto of ['', 'no es json', '{"cantidad": NaN}', '{"a":', 'null', '"texto"', '42']) {
      const r = await crudo(p, t, 'POST', '/salidas', texto)
      expect(r.status, texto).toBe(400)
      expect(r.body.error.codigo).toBe('datos_invalidos')
    }
  })

  it('corta los cuerpos enormes antes de leerlos (también sin sesión)', async () => {
    const p = await nuevaPrueba()
    const enorme = JSON.stringify({ usuario: 'admin', clave: 'x'.repeat(4 * 1024 * 1024) })
    const r = await crudo(p, null, 'POST', '/auth/login', enorme)
    expect(r.status).toBe(413)
    expect(r.body.error.codigo).toBe('demasiado_grande')
    // Una foto del tamaño máximo con el resto de la lectura sigue entrando.
    const t = await p.entrar('cocina')
    const foto = `data:image/jpeg;base64,${b64(new Uint8Array([0xff, 0xd8, 0xff, ...new Array(1_500_000).fill(7)]))}`
    const ok = await p.pedir(t, 'POST', '/lecturas', {
      maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3, observacion: 'ñ'.repeat(500), foto,
    })
    expect(ok.status).toBe(200)
  })

  it('rechaza textos larguísimos', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('cocina')
    const largo = 'x'.repeat(5000)
    const casos: [string, string, string, unknown][] = [
      [admin, 'POST', '/productos', { sector: 'cocina', nombre: largo }],
      [admin, 'POST', '/sucursales', { nombre: largo }],
      [admin, 'POST', '/usuarios', { nombre: largo, usuario: 'largo', rol: 'cocina', clave: 'segura123' }],
      [admin, 'POST', '/usuarios', { nombre: 'Largo', usuario: 'largo', rol: 'cocina', clave: largo }],
      [admin, 'POST', '/ajustes', { sector: 'cocina', tipo: 'stock_inicial', productoId: EMPANADA, cantidad: 1, motivo: largo }],
      [t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3, observacion: largo }],
      [t, 'POST', '/limpiezas', { areaId: 'cocina', marcas: (await tareasDe(p, 'cocina')).map((tareaId) => ({ tareaId, marca: 'X' })), comentario: largo }],
      [t, 'POST', '/salidas', { productoId: largo, cantidad: 1 }],
    ]
    for (const [token, metodo, ruta, cuerpo] of casos) {
      expect((await p.pedir(token, metodo, ruta, cuerpo)).status, ruta).toBe(400)
    }
    expect((await p.pedir(null, 'POST', '/auth/login', { usuario: largo, clave: '1234' })).status).toBe(400)
    expect((await p.pedir(t, 'GET', `/movimientos?producto=${largo}`)).status).toBe(400)
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas'))[0].n).toBe(0)
  })

  it('cantidades: solo enteros positivos dentro del rango, nunca texto, listas ni decimales', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('cocina')
    expect((await p.pedir(admin, 'POST', '/ajustes', {
      sector: 'cocina', tipo: 'stock_inicial', productoId: EMPANADA, cantidad: 50, motivo: 'Inicio',
    })).status).toBe(200)
    for (const cantidad of [-5, 0, 1.5, '3', null, [], {}, [2], true, 1e9, Number.MAX_SAFE_INTEGER + 2]) {
      expect((await p.pedir(t, 'POST', '/salidas', { productoId: EMPANADA, cantidad })).status, JSON.stringify(cantidad)).toBe(400)
      expect((await p.pedir(t, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad }] })).status).toBe(400)
      expect((await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 0, guardado: cantidad }] })).status).toBe(400)
    }
    for (const sentido of [2, 0, '1', null]) {
      expect((await p.pedir(admin, 'POST', '/ajustes', {
        sector: 'cocina', tipo: 'ajuste', productoId: EMPANADA, cantidad: 1, sentido, motivo: 'x',
      })).status).toBe(400)
    }
    for (const temperatura of ['5', [5], 1e308, -1e308]) {
      expect((await p.pedir(t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura })).status).toBe(400)
    }
    const ch = await p.entrar('chiperia')
    for (const cantidad of [-1, 0, 'mucho', [1]]) {
      expect((await p.pedir(ch, 'POST', '/lotes-mp', {
        insumo: 'Harina', proveedor: 'X', fechaIngreso: hoy(), cantidad, vencimiento: sumarDias(hoy(), 5),
      })).status).toBe(400)
    }
    // El stock quedó como estaba: 50 de la carga inicial.
    expect((await p.sql('SELECT SUM(cantidad) AS s FROM movimientos'))[0].s).toBe(50)
    expect((await p.sql('SELECT COUNT(*) AS n FROM producciones'))[0].n).toBe(0)
  })

  it('listas donde van objetos y objetos donde van listas', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('cocina')
    const ch = await p.entrar('chiperia')
    const casos: [string, string, string, unknown][] = [
      [t, 'POST', '/producciones', []],
      [t, 'POST', '/producciones', { turno: 'dia', items: 'todo' }],
      [t, 'POST', '/producciones', { turno: 'dia', items: { productoId: EMPANADA, cocinado: 1 } }],
      [t, 'POST', '/producciones', { turno: 'dia', items: [[EMPANADA, 1, 1]] }],
      [t, 'POST', '/producciones', { turno: 'dia', items: [null] }],
      [t, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: [EMPANADA], cocinado: 1 }] }],
      [t, 'POST', '/envios', { sucursalId: ['suc-centro'], items: [{ productoId: EMPANADA, cantidad: 1 }] }],
      [t, 'POST', '/envios', { sucursalId: 'suc-centro', items: [[]] }],
      [t, 'POST', '/limpiezas', { areaId: 'cocina', marcas: {} }],
      [t, 'POST', '/limpiezas', { areaId: 'cocina', marcas: [null] }],
      [t, 'POST', '/limpiezas', { areaId: ['cocina'], marcas: [] }],
      [t, 'POST', '/lecturas', { maquinaId: { id: 'maq-cocina-1' }, momento: 'inicio', estado: 'funciona', temperatura: 3 }],
      [ch, 'POST', '/producciones', { turno: 'dia', lotesMP: 'mp-1', items: [{ productoId: CHIPA, cocinado: 1 }] }],
      [ch, 'POST', '/producciones', { turno: 'dia', lotesMP: [{ id: 'mp-1' }], items: [{ productoId: CHIPA, cocinado: 1 }] }],
      [admin, 'POST', '/areas', { nombre: 'Nueva', sectores: 'cocina' }],
      [admin, 'POST', '/areas', { nombre: 'Nueva', sectores: [['cocina']] }],
      [admin, 'POST', '/productos', { sector: ['cocina'], nombre: 'Nuevo' }],
      [admin, 'PATCH', '/config', { correoReportes: ['a@b.com'] }],
    ]
    for (const [token, metodo, ruta, cuerpo] of casos) {
      expect((await p.pedir(token, metodo, ruta, cuerpo)).status, `${ruta} ${JSON.stringify(cuerpo)}`).toBe(400)
    }
  })

  it('valores desconocidos en las opciones', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('cocina')
    const casos: [string, string, string, unknown][] = [
      [t, 'POST', '/producciones', { turno: 'tarde', items: [{ productoId: EMPANADA, cocinado: 1 }] }],
      [t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'mediodia', estado: 'funciona', temperatura: 3 }],
      [t, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'roto', temperatura: 3 }],
      [t, 'POST', '/limpiezas', { areaId: 'cocina', marcas: (await tareasDe(p, 'cocina')).map((tareaId) => ({ tareaId, marca: 'Y' })) }],
      [admin, 'POST', '/ajustes', { sector: 'cocina', tipo: 'regalo', productoId: EMPANADA, cantidad: 1, motivo: 'x' }],
      [admin, 'POST', '/ajustes', { sector: 'admin', tipo: 'merma', productoId: EMPANADA, cantidad: 1, motivo: 'x' }],
      [admin, 'POST', '/usuarios', { nombre: 'X', usuario: 'equis', rol: 'superadmin', clave: 'segura123' }],
      [admin, 'POST', '/maquinas', { sector: 'cocina', nombre: 'X', tipo: 'tostadora', tempMin: 1, tempMax: 5 }],
      [admin, 'POST', '/reportes/enviar', { periodo: 'anual' }],
    ]
    for (const [token, metodo, ruta, cuerpo] of casos) {
      expect((await p.pedir(token, metodo, ruta, cuerpo)).status, `${ruta} ${JSON.stringify(cuerpo)}`).toBe(400)
    }
    expect((await p.pedir(t, 'GET', '/movimientos?tipo=robo')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', '/productos?sector=otro')).status).toBe(400)
    expect((await p.pedir(t, 'GET', '/producciones?desde=ayer')).status).toBe(400)
  })

  it('claves __proto__ y constructor no contaminan objetos ni cambian lo que se guarda', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const r = await p.pedir(admin, 'POST', '/usuarios', JSON.parse(
      '{"__proto__": {"rol": "admin", "activo": true, "debeCambiarClave": false}, "nombre": "Pepe", "usuario": "pepe", "rol": "cocina", "clave": "segura123"}',
    ))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ rol: 'cocina', debeCambiarClave: true })
    const sinCambios = await p.pedir(admin, 'PATCH', '/usuarios/usr-cocina', JSON.parse('{"__proto__": {"rol": "admin", "activo": false}}'))
    expect(sinCambios.status).toBe(400)
    await p.pedir(admin, 'PATCH', '/config', JSON.parse('{"__proto__": {"correoReportes": "malo@x.com"}, "constructor": {"prototype": {"admin": true}}}'))
    expect((await p.pedir(admin, 'GET', '/config')).body.correoReportes).toBe('')
    const t = await p.entrar('cocina')
    const prod = await p.pedir(t, 'POST', '/producciones', JSON.parse(
      `{"turno": "dia", "items": [{"__proto__": {"productoId": "${CHIPA}"}, "productoId": "${EMPANADA}", "cocinado": 1}]}`,
    ))
    expect(prod.status).toBe(200)
    expect(prod.body.items.map((i: any) => i.productoId)).toEqual([EMPANADA])
    const vacio: Record<string, unknown> = {}
    for (const k of ['rol', 'activo', 'correoReportes', 'admin', 'productoId', 'debeCambiarClave']) expect(vacio[k], k).toBeUndefined()
    expect((await p.sql("SELECT rol, activo FROM usuarios WHERE id = 'usr-cocina'"))[0]).toEqual({ rol: 'cocina', activo: 1 })
  })

  it('fotos: solo JPEG, PNG o WEBP de verdad; SVG, HTML disfrazado o base64 roto no entran', async () => {
    const p = await nuevaPrueba()
    const t = await p.entrar('cocina')
    const base = { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 }
    const html = '<html><body><script>alert(document.cookie)</script></body></html>'
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'
    const malas = [
      `data:image/svg+xml;base64,${b64(svg)}`,
      `data:text/html;base64,${b64(html)}`,
      `data:image/png;base64,${b64(html)}`,
      `data:image/jpeg;base64,${b64(svg)}`,
      `data:image/webp;base64,${b64('RIFF0000AVI LIST')}`,
      'data:image/png;base64,A=AA',
      'data:image/jpeg;base64,/9j/=',
      `data:image/jpeg;charset=utf-8;base64,${b64(new Uint8Array([0xff, 0xd8, 0xff]))}`,
      ` data:image/jpeg;base64,${b64(new Uint8Array([0xff, 0xd8, 0xff]))}`,
      'data:image/png,%89PNG',
    ]
    for (const foto of malas) {
      const r = await p.pedir(t, 'POST', '/lecturas', { ...base, foto })
      expect(r.status, foto.slice(0, 40)).toBe(400)
      expect(r.body.error.mensaje).toMatch(/foto/)
    }
    expect((await p.sql('SELECT COUNT(*) AS n FROM lecturas'))[0].n).toBe(0)
    expect((await p.sql('SELECT COUNT(*) AS n FROM archivos'))[0].n).toBe(0)

    const png = `data:image/png;base64,${b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))}`
    const webp = `data:image/webp;base64,${b64(new Uint8Array([...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]))}`
    for (const foto of [png, webp]) {
      const r = await p.pedir(t, 'POST', '/lecturas', { ...base, foto })
      expect(r.status).toBe(200)
      expect((await p.pedir(t, 'GET', `/lecturas/${r.body.id}/foto`)).body.dataUrl).toBe(foto)
    }
  })
})

// ---------- SQL siempre con parámetros ----------

describe('SQL con parámetros', () => {
  it('comillas y SQL en filtros, ids y nombres se tratan como texto', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const t = await p.entrar('cocina')
    expect((await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 5 }] })).status).toBe(200)
    const inyeccion = ["' OR '1'='1", "x' OR 1=1 --", '1) OR (1=1', "'; DROP TABLE usuarios; --"]
    for (const s of inyeccion) {
      const q = encodeURIComponent(s)
      for (const ruta of [`/movimientos?producto=${q}`, `/movimientos?lote=${q}`, `/movimientos?sucursal=${q}`,
        `/lecturas?maquina=${q}`, `/limpiezas?area=${q}`, `/auditoria?tabla=${q}`]) {
        const r = await p.pedir(admin, 'GET', ruta)
        expect(r.status, ruta).toBe(200)
        expect(r.body, ruta).toEqual([])
      }
      for (const ruta of [`/trazabilidad/lote/${q}`, `/trazabilidad/mp/${q}`, `/trazabilidad/sucursal/${q}`, `/lecturas/${q}/foto`, `/copias/${q}`]) {
        expect((await p.pedir(admin, 'GET', ruta)).status, ruta).toBe(404)
      }
      expect((await p.pedir(admin, 'PATCH', `/productos/${q}`, { nombre: 'X' })).status).toBe(404)
      expect((await p.pedir(t, 'GET', `/producciones?sector=${q}`)).status).toBe(403)
    }
    const nombre = "Chipa'); DROP TABLE usuarios; --"
    const r = await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre })
    expect(r.status).toBe(200)
    expect((await p.sql('SELECT nombre FROM productos WHERE id = ?', r.body.id))[0].nombre).toBe(nombre)
    expect((await p.sql('SELECT COUNT(*) AS n FROM usuarios'))[0].n).toBe(5)
  })
})

// ---------- Correo del resumen ----------

describe('correo del resumen (H04)', () => {
  it('escapa todo lo que escriben los usuarios: productos, sucursales, áreas, sectores y observaciones', async () => {
    const p = await nuevaPrueba({ MODO_DEMO: '1' })
    const admin = await p.entrar('admin')
    const malo = (s: string) => `<script>alert("${s}")</script>`
    expect((await p.pedir(admin, 'PATCH', '/sectores/cocina', { nombre: '<i>Cocina</i>' })).status).toBe(200)
    const producto = await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre: malo('producto') })
    const sucursal = await p.pedir(admin, 'POST', '/sucursales', { nombre: '<img src=x onerror=alert(1)>' })
    const area = await p.pedir(admin, 'POST', '/areas', { nombre: '<svg onload=alert(2)>', sectores: ['cocina'] })
    expect((await p.pedir(admin, 'POST', `/areas/${area.body.id}/tareas`, { nombre: '<b>Piso</b>' })).status).toBe(200)

    const t = await p.entrar('cocina')
    expect((await p.pedir(t, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: producto.body.id, cocinado: 2, guardado: 10 }] })).status).toBe(200)
    expect((await p.pedir(t, 'POST', '/envios', { sucursalId: sucursal.body.id, items: [{ productoId: producto.body.id, cantidad: 3 }] })).status).toBe(200)
    expect((await p.pedir(t, 'POST', '/lecturas', {
      maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'con_fallas', temperatura: 20,
      observacion: malo('observacion'), mantenimiento: '<a href="javascript:alert(3)">x</a>', mantenimientoPor: '"><iframe src=//malo>',
    })).status).toBe(200)
    expect((await limpieza(p, t, area.body.id)).status).toBe(200)
    // El resumen diario es del día anterior.
    const ayer = sumarDias(hoy(), -1)
    for (const tabla of ['producciones', 'movimientos', 'lecturas', 'limpiezas']) await p.sql(`UPDATE ${tabla} SET dia = ?`, ayer)

    const r = await p.pedir(admin, 'POST', '/reportes/enviar', { periodo: 'diario' })
    expect(r.status).toBe(200)
    const html: string = r.body.html
    for (const crudoMalo of ['<script', '<img', '<svg', '<iframe', '<i>', '<b>', 'href="javascript']) {
      expect(html, crudoMalo).not.toContain(crudoMalo)
    }
    for (const escapado of [
      '&lt;script&gt;alert(&quot;producto&quot;)&lt;/script&gt;', '&lt;img src=x onerror=alert(1)&gt;', '&lt;svg onload=alert(2)&gt;',
      '&lt;i&gt;Cocina&lt;/i&gt;', '&lt;script&gt;alert(&quot;observacion&quot;)&lt;/script&gt;', '&quot;&gt;&lt;iframe src=//malo&gt;',
    ]) {
      expect(html, escapado).toContain(escapado)
    }
    expect(r.body.asunto).not.toMatch(/[<>]/)
  })

  it('la dirección pública del enlace solo acepta http o https', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    for (const urlPublica of ['javascript:alert(1)', 'data:text/html,<script>', 'https://user:pass@malo.com', 'vbscript:x']) {
      expect((await p.pedir(admin, 'PATCH', '/config', { urlPublica })).status, urlPublica).toBe(400)
    }
    const ok = await p.pedir(admin, 'PATCH', '/config', { urlPublica: 'https://chipatia.com/"><script>?x=1#y' })
    expect(ok.status).toBe(200)
    expect(ok.body.urlPublica).not.toMatch(/[<>"]/)
  })
})

// ---------- Exportaciones y copias sin secretos ----------

describe('exportación, copias y usuarios sin contraseñas ni sesiones', () => {
  it('ni la exportación, ni la copia, ni /usuarios, ni la auditoría llevan hashes o tokens', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.entrar('cocina')
    expect((await p.pedir(admin, 'POST', '/usuarios', { nombre: 'Rosa', usuario: 'rosa', rol: 'cocina', clave: 'secreta99' })).status).toBe(200)
    expect((await p.pedir(admin, 'POST', '/usuarios/usr-panaderia/clave', { clave: 'temporal9' })).status).toBe(200)
    const tokens = (await p.sql('SELECT token_hash FROM sesiones')).map((s) => s.token_hash as string)
    const hashes = (await p.sql('SELECT clave_hash FROM usuarios')).map((u) => u.clave_hash as string)
    expect(tokens.length).toBeGreaterThan(0)

    const sinSecretos = (texto: string, donde: string) => {
      expect(texto, donde).not.toContain('pbkdf2$')
      expect(texto, donde).not.toContain('clave_hash')
      expect(texto, donde).not.toContain('token_hash')
      expect(texto, donde).not.toContain('secreta99')
      expect(texto, donde).not.toContain('temporal9')
      for (const s of [admin, ...tokens, ...hashes]) expect(texto.includes(s), donde).toBe(false)
    }
    const exportacion = await p.pedir(admin, 'GET', '/exportar')
    expect(exportacion.status).toBe(200)
    expect(Object.keys(exportacion.body.tablas)).not.toContain('sesiones')
    expect(exportacion.body.tablas.usuarios.length).toBe(6)
    sinSecretos(JSON.stringify(exportacion.body), 'exportar')

    const copia = await p.pedir(admin, 'POST', '/copias')
    const archivo = await p.pedir(admin, 'GET', `/copias/${encodeURIComponent(copia.body.clave)}`)
    expect(archivo.status).toBe(200)
    sinSecretos(JSON.stringify(archivo.body), 'copia')

    sinSecretos(JSON.stringify((await p.pedir(admin, 'GET', '/usuarios')).body), 'usuarios')
    sinSecretos(JSON.stringify((await p.pedir(admin, 'GET', '/auditoria')).body), 'auditoria')
    const login = await p.pedir(null, 'POST', '/auth/login', { usuario: 'cocina', clave: '1234' })
    expect(Object.keys(login.body.usuario)).not.toContain('claveHash')
    expect(JSON.stringify(login.body.usuario)).not.toContain('pbkdf2')
  })
})

// ---------- Límites de Cloudflare D1 ----------

/** Hace fallar cualquier consulta con más de 100 parámetros, como D1. Devuelve el máximo usado. */
function comoD1(p: Prueba): () => number {
  const original = p.d1.prepare.bind(p.d1)
  let maximo = 0
  p.d1.prepare = (sql: string) => {
    const s = original(sql)
    const atar = s.bind.bind(s)
    s.bind = (...valores) => {
      maximo = Math.max(maximo, valores.length)
      if (valores.length > 100) throw new Error(`D1: ${valores.length} parámetros en una consulta (máximo 100)`)
      return atar(...valores)
    }
    return s
  }
  return () => maximo
}

describe('límites de D1', () => {
  it('listados con cientos de registros nunca pasan de 100 parámetros por consulta', async () => {
    const p = await nuevaPrueba()
    const ayer = sumarDias(hoy(), -1)
    const fecha = new Date().toISOString()
    await p.sql(`INSERT INTO lotes_mp (id, insumo, proveedor, numero_lote, fecha_ingreso, cantidad, unidad, vencimiento, bloqueado, usuario_id, creado_en)
                 VALUES ('mp-1', 'Queso', 'X', '1', ?, 1, 'kg', ?, 0, 'usr-chiperia', ?)`, ayer, sumarDias(hoy(), 30), fecha)
    for (let i = 1; i <= 230; i++) {
      const sector = i % 2 ? 'chiperia' : 'cocina'
      const producto = sector === 'chiperia' ? CHIPA : EMPANADA
      await p.sql("INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES (?, ?, 'usr-admin', ?, ?, 'dia')", `p${i}`, sector, fecha, ayer)
      await p.sql('INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES (?, ?, 1, 2)', `p${i}`, producto)
      const lote = sector === 'chiperia' ? `CH-X-${i}` : null
      if (lote) {
        await p.sql('INSERT INTO lotes_chipa (id, codigo, produccion_id, amasada, dia) VALUES (?, ?, ?, ?, ?)', `l${i}`, lote, `p${i}`, i, ayer)
        await p.sql("INSERT INTO lote_chipa_mp (lote_chipa_id, lote_mp_id) VALUES (?, 'mp-1')", `l${i}`)
      }
      await p.sql(`INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, usuario_id, fecha, dia, produccion_id)
                   VALUES (?, ?, ?, ?, 'produccion', 2, 'usr-admin', ?, ?, ?)`, `m${i}`, sector, producto, lote, fecha, ayer, `p${i}`)
      await p.sql(`INSERT INTO movimientos (id, sector, producto_id, lote, tipo, cantidad, sucursal_id, envio_id, usuario_id, fecha, dia)
                   VALUES (?, ?, ?, ?, 'envio', -1, 'suc-centro', ?, 'usr-admin', ?, ?)`, `e${i}`, sector, producto, lote, `env${i}`, fecha, ayer)
      await p.sql("INSERT INTO limpiezas (id, area_id, sector, usuario_id, fecha, dia, comentario) VALUES (?, 'sanitario', ?, 'usr-admin', ?, ?, '')", `lim${i}`, sector, fecha, ayer)
      await p.sql("INSERT INTO limpieza_marcas (limpieza_id, tarea_id, marca) SELECT ?, id, 'X' FROM tareas_limpieza WHERE area_id = 'sanitario'", `lim${i}`)
    }
    const maximo = comoD1(p)
    const admin = await p.entrar('admin')
    const ch = await p.entrar('chiperia')
    const pedidos: [string, string][] = [
      [admin, '/producciones'], [admin, '/limpiezas'], [admin, `/reportes?desde=${ayer}&hasta=${ayer}`],
      [ch, '/lotes-chipa'], [ch, '/trazabilidad/mp/mp-1'], [ch, `/trazabilidad/sucursal/suc-centro?desde=${ayer}`],
    ]
    for (const [token, ruta] of pedidos) {
      const r = await p.pedir(token, 'GET', ruta)
      expect(r.status, `${ruta} ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200)
    }
    expect((await p.pedir(admin, 'GET', '/producciones')).body).toHaveLength(230)
    expect((await p.pedir(ch, 'GET', '/trazabilidad/mp/mp-1')).body.envios).toHaveLength(115)
    // Las listas de ids viajan como un único parámetro JSON (json_each), así que ninguna consulta se acerca al límite.
    expect(maximo()).toBeGreaterThan(0)
    expect(maximo()).toBeLessThanOrEqual(100)
  }, 60_000)
})
