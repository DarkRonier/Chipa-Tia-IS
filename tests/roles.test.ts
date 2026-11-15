// Etapa 1 de la ampliación: los 7 roles (supervisor y cajero nuevos), incidencias de máquinas y stock obligatorio.
import { describe, expect, it } from 'vitest'
import type { Alerta } from '../src/shared/alertas'
import { PERMISOS, permisosDe, puede } from '../src/shared/permisos'
import type { AreaLimpieza, Incidencia, Producto, StockFila, Usuario } from '../src/shared/tipos'
import { ROLES } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

const EMPANADA = 'prod-cocina-10'
const COCIDO = 'prod-cocina-02'

async function limpiezaDePanaderia(p: Prueba, token: string) {
  const areas = await p.pedir<AreaLimpieza[]>(token, 'GET', '/areas')
  const area = areas.body.find((a) => a.id === 'panaderia')!
  const r = await p.pedir(token, 'POST', '/limpiezas', { areaId: area.id, marcas: area.tareas.map((t) => ({ tareaId: t.id, marca: 'X' })) })
  expect(r.status).toBe(200)
  return r.body.id as string
}

describe('tabla de permisos', () => {
  it('el administrador tiene todos los permisos, incluidos los del cajero', () => {
    expect(permisosDe('admin')).toEqual(PERMISOS)
    for (const p of permisosDe('cajero')) expect(puede('admin', p)).toBe(true)
  })

  it('los sectores siguen igual: cargan lo suyo, sin reportes, ventas ni administración; lotes solo Chipería', () => {
    for (const s of ['chiperia', 'chipitas', 'panaderia', 'cocina'] as const) {
      for (const p of ['produccion.cargar', 'stock.mover', 'maquinas.lectura', 'limpieza.cargar'] as const) expect(puede(s, p)).toBe(true)
      for (const p of ['reportes.ver', 'ventas.registrar', 'caja.operar', 'usuarios.gestionar', 'stock.ajustar', 'compras.pagar'] as const) {
        expect(puede(s, p)).toBe(false)
      }
      expect(puede(s, 'lotes.ver')).toBe(s === 'chiperia')
    }
  })

  it('el supervisor ve y controla, pero no carga producción, no mueve stock y no carga lecturas', () => {
    for (const p of ['produccion.ver', 'stock.ver', 'maquinas.ver', 'maquinas.incidencia', 'limpieza.ver', 'limpieza.controlar', 'lotes.ver', 'trazabilidad.ver', 'reportes.ver'] as const) {
      expect(puede('supervisor', p)).toBe(true)
    }
    for (const p of ['produccion.cargar', 'stock.mover', 'stock.ajustar', 'maquinas.lectura', 'limpieza.cargar', 'catalogos.editar', 'usuarios.gestionar', 'datos.gestionar', 'ie.completo', 'reportes.correo'] as const) {
      expect(puede('supervisor', p)).toBe(false)
    }
  })

  it('todos los roles tienen su fila', () => {
    for (const r of ROLES) expect(Array.isArray(permisosDe(r))).toBe(true)
  })
})

describe('supervisor', () => {
  it('el administrador crea un supervisor y un cajero; entran con su rol', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    for (const rol of ['supervisor', 'cajero']) {
      const r = await p.pedir<Usuario>(admin, 'POST', '/usuarios', { nombre: `Nuevo ${rol}`, usuario: `nuevo.${rol}`, rol, clave: 'clave-segura' })
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ rol, debeCambiarClave: false })
      const t = await p.entrar(`nuevo.${rol}`, 'clave-segura')
      expect((await p.pedir<Usuario>(t, 'GET', '/auth/yo')).body.rol).toBe(rol)
    }
  })

  it('ve producción, stock, salidas, máquinas, limpieza, lotes, trazabilidad y reportes de todos los sectores', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    await p.pedir(cocina, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 10, guardado: 5 }] })
    const sup = await p.entrar('supervisor')
    const prod = await p.pedir(sup, 'GET', '/producciones')
    expect(prod.status).toBe(200)
    expect(prod.body).toHaveLength(1)
    for (const ruta of [
      '/stock?sector=cocina', '/stock/alertas', '/movimientos?sector=cocina', '/lecturas', '/incidencias', '/limpiezas',
      '/limpieza/alertas', '/lotes-mp', '/lotes-chipa', '/lotes/alertas', '/reportes', '/reportes/serie', '/alertas',
    ]) {
      expect((await p.pedir(sup, 'GET', ruta)).status, ruta).toBe(200)
    }
    const stock = await p.pedir<StockFila[]>(sup, 'GET', '/stock?sector=cocina')
    expect(stock.body.find((f) => f.productoId === EMPANADA)?.total).toBe(5)
  })

  it('no carga producción, no mueve ni ajusta stock, no carga lecturas ni limpieza y no corrige', async () => {
    const p = await nuevaPrueba()
    const cocina = await p.entrar('cocina')
    const carga = await p.pedir(cocina, 'POST', '/producciones', { turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 10, guardado: 5 }] })
    const sup = await p.entrar('supervisor')
    const intentos: [string, string, unknown][] = [
      ['POST', '/producciones', { sector: 'cocina', turno: 'dia', items: [{ productoId: EMPANADA, cocinado: 1, guardado: 1 }] }],
      ['PATCH', `/producciones/${carga.body.id}`, { items: [{ productoId: EMPANADA, cocinado: 1, guardado: 1 }] }],
      ['POST', '/salidas', { sector: 'cocina', productoId: EMPANADA, cantidad: 1 }],
      ['POST', '/envios', { sector: 'cocina', sucursalId: 'suc-centro', items: [{ productoId: EMPANADA, cantidad: 1 }] }],
      ['POST', '/reasignaciones', { sector: 'cocina', productoId: EMPANADA, cantidad: 1, desde: 'reposicion' }],
      ['POST', '/ajustes', { sector: 'cocina', productoId: EMPANADA, tipo: 'merma', cantidad: 1, motivo: 'x' }],
      ['POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 }],
      ['POST', '/limpiezas', { areaId: 'panaderia', sector: 'panaderia', marcas: [] }],
      ['POST', '/lotes-mp', { insumo: 'Queso', proveedor: 'X', fechaIngreso: '2026-11-01', cantidad: 1, vencimiento: '2026-12-01' }],
      ['POST', '/productos', { sector: 'cocina', nombre: 'Nuevo' }],
      ['PATCH', `/productos/${COCIDO}`, { stockObligatorio: false }],
      ['GET', '/usuarios', undefined],
      ['GET', '/config', undefined],
      ['GET', '/exportar', undefined],
      ['GET', '/auditoria', undefined],
      ['POST', '/reportes/enviar', { periodo: 'diario' }],
    ]
    for (const [metodo, ruta, cuerpo] of intentos) {
      expect((await p.pedir(sup, metodo, ruta, cuerpo)).status, `${metodo} ${ruta}`).toBe(403)
    }
    const lectura = await p.pedir(sup, 'POST', '/lecturas', { maquinaId: 'maq-cocina-1', momento: 'inicio', estado: 'funciona', temperatura: 3 })
    expect(lectura.body.error.mensaje).toMatch(/falla o incidencia/)
    // Nada quedó cargado.
    expect(await p.sql("SELECT id FROM movimientos WHERE usuario_id = 'usr-supervisor'")).toEqual([])
  })

  it('da el visto bueno de la limpieza', async () => {
    const p = await nuevaPrueba()
    const id = await limpiezaDePanaderia(p, await p.entrar('panaderia'))
    const sup = await p.entrar('supervisor')
    const r = await p.pedir(sup, 'POST', `/limpiezas/${id}/control`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ controladoPor: 'usr-supervisor', controladoPorNombre: 'Supervisión' })
    // Un sector sigue sin poder hacerlo.
    const otro = await limpiezaDePanaderia(p, await p.entrar('panaderia'))
    expect((await p.pedir(await p.entrar('panaderia'), 'POST', `/limpiezas/${otro}/control`)).status).toBe(403)
  })
})

describe('incidencias de máquinas', () => {
  it('el supervisor reporta una falla: queda abierta, avisa al sector y se marca como resuelta', async () => {
    const p = await nuevaPrueba()
    const sup = await p.entrar('supervisor')
    const r = await p.pedir<Incidencia>(sup, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'falla', descripcion: 'No enfría bien' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      maquinaId: 'maq-cocina-1', sector: 'cocina', tipo: 'falla', descripcion: 'No enfría bien',
      usuarioId: 'usr-supervisor', usuarioNombre: 'Supervisión', resueltaEn: null,
    })
    // No es una lectura: no carga estado ni temperatura.
    expect(await p.sql('SELECT id FROM lecturas')).toEqual([])

    // El sector la ve y le aparece como aviso; otro sector no.
    const cocina = await p.entrar('cocina')
    expect((await p.pedir<Incidencia[]>(cocina, 'GET', '/incidencias')).body).toHaveLength(1)
    const avisos = await p.pedir<Alerta[]>(cocina, 'GET', '/alertas')
    expect(avisos.body).toContainEqual(expect.objectContaining({ tipo: 'incidencia_maquina', sector: 'cocina', enlace: '/maquinas?maquina=maq-cocina-1' }))
    const chipitas = await p.entrar('chipitas')
    expect((await p.pedir<Incidencia[]>(chipitas, 'GET', '/incidencias')).body).toEqual([])
    expect((await p.pedir(chipitas, 'GET', '/incidencias?sector=cocina')).status).toBe(403)

    // El sector no reporta ni resuelve incidencias (carga lecturas, como siempre).
    expect((await p.pedir(cocina, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'falla', descripcion: 'x' })).status).toBe(403)
    expect((await p.pedir(cocina, 'POST', `/incidencias/${r.body.id}/resolver`, {})).status).toBe(403)

    const resuelta = await p.pedir<Incidencia>(sup, 'POST', `/incidencias/${r.body.id}/resolver`, { resolucion: 'Vino el técnico' })
    expect(resuelta.status).toBe(200)
    expect(resuelta.body).toMatchObject({ resueltaPor: 'usr-supervisor', resolucion: 'Vino el técnico' })
    expect(resuelta.body.resueltaEn).toEqual(expect.any(String))
    expect((await p.pedir(sup, 'POST', `/incidencias/${r.body.id}/resolver`, {})).status).toBe(409)
    expect((await p.pedir<Alerta[]>(cocina, 'GET', '/alertas')).body.filter((a) => a.tipo === 'incidencia_maquina')).toEqual([])
    expect((await p.pedir<Incidencia[]>(sup, 'GET', '/incidencias?abiertas=1')).body).toEqual([])
    // Queda en la auditoría.
    expect(await p.sql("SELECT accion FROM auditoria WHERE tabla = 'incidencias' ORDER BY fecha")).toEqual([{ accion: 'crear' }, { accion: 'resolver' }])
  })

  it('valida los datos y el administrador también puede reportar', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    expect((await p.pedir(admin, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'otra', descripcion: 'x' })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'falla', descripcion: '  ' })).status).toBe(400)
    expect((await p.pedir(admin, 'POST', '/incidencias', { maquinaId: 'no-existe', tipo: 'falla', descripcion: 'x' })).status).toBe(404)
    expect((await p.pedir(admin, 'POST', '/incidencias', { maquinaId: 'maq-cocina-1', tipo: 'incidencia', descripcion: 'Burlete roto' })).status).toBe(200)
  })
})

describe('cajero', () => {
  it('entra pero todavía no ve producción, stock, máquinas, limpieza, lotes ni reportes', async () => {
    const p = await nuevaPrueba()
    const caja = await p.entrar('cajero')
    expect((await p.pedir<Usuario>(caja, 'GET', '/auth/yo')).body.rol).toBe('cajero')
    for (const ruta of [
      '/producciones', '/stock?sector=cocina', '/movimientos', '/lecturas', '/incidencias', '/limpiezas', '/lotes-mp',
      '/trazabilidad/lote/CH-1', '/reportes', '/usuarios',
    ]) {
      expect((await p.pedir(caja, 'GET', ruta)).status, ruta).toBe(403)
    }
    expect((await p.pedir(caja, 'POST', '/salidas', { sector: 'cocina', productoId: EMPANADA, cantidad: 1 })).status).toBe(403)
    // Sin avisos que no le corresponden; el catálogo sí (lo va a necesitar para vender).
    expect((await p.pedir(caja, 'GET', '/alertas')).body).toEqual([])
    expect((await p.pedir<Producto[]>(caja, 'GET', '/productos')).body.length).toBeGreaterThan(0)
  })
})

describe('stock obligatorio', () => {
  it('todos los productos que ya existían quedan con stock obligatorio y uno nuevo también, salvo que se indique', async () => {
    const p = await nuevaPrueba()
    expect(await p.sql('SELECT id FROM productos WHERE stock_obligatorio <> 1')).toEqual([])
    const admin = await p.entrar('admin')
    const nuevo = await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Azúcar', unidad: 'kg', stockObligatorio: false })
    expect(nuevo.body.stockObligatorio).toBe(false)
    expect((await p.pedir<Producto>(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Pastel' })).body.stockObligatorio).toBe(true)
    expect((await p.pedir(admin, 'POST', '/productos', { sector: 'cocina', nombre: 'Otro', stockObligatorio: 'no' })).status).toBe(400)
  })

  it('con stock obligatorio frena la salida que no alcanza; sin él, queda en negativo y no frena', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const cocina = await p.entrar('cocina')
    // Obligatorio (como hasta ahora): no hay nada, no sale.
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: EMPANADA, cantidad: 1 })).status).toBe(409)

    // El cocido no lleva stock obligatorio: sin nada cargado aparece «sin cargar».
    const cambio = await p.pedir<Producto>(admin, 'PATCH', `/productos/${COCIDO}`, { stockObligatorio: false })
    expect(cambio.status).toBe(200)
    expect(cambio.body.stockObligatorio).toBe(false)
    let fila = (await p.pedir<StockFila[]>(cocina, 'GET', '/stock')).body.find((f) => f.productoId === COCIDO)!
    expect(fila).toMatchObject({ obligatorio: false, conMovimientos: false, total: 0 })
    expect((await p.pedir<StockFila[]>(cocina, 'GET', '/stock')).body.find((f) => f.productoId === EMPANADA))
      .toMatchObject({ obligatorio: true, conMovimientos: false })

    // Sale igual: el stock queda en negativo, y un envío tampoco frena.
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: COCIDO, cantidad: 3 })).status).toBe(200)
    expect((await p.pedir(cocina, 'POST', '/envios', { sucursalId: 'suc-centro', items: [{ productoId: COCIDO, cantidad: 2 }] })).status).toBe(200)
    fila = (await p.pedir<StockFila[]>(cocina, 'GET', '/stock')).body.find((f) => f.productoId === COCIDO)!
    expect(fila).toMatchObject({ obligatorio: false, conMovimientos: true, total: -5, reposicion: -3, distribucion: -2 })
    // Una merma del administrador tampoco frena.
    expect((await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: COCIDO, tipo: 'merma', cantidad: 1, motivo: 'Se volcó' })).status).toBe(200)

    // Volver a marcarlo obligatorio con el stock en negativo no se puede: primero hay que corregirlo.
    const mal = await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { stockObligatorio: true })
    expect(mal.status).toBe(409)
    expect(mal.body.error.codigo).toBe('stock_negativo')
    expect(mal.body.error.mensaje).toMatch(/Cocido con leche/)
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: COCIDO, tipo: 'ajuste', sentido: 1, cantidad: 4, motivo: 'Conteo', finalidad: 'reposicion' })
    await p.pedir(admin, 'POST', '/ajustes', { sector: 'cocina', productoId: COCIDO, tipo: 'ajuste', sentido: 1, cantidad: 2, motivo: 'Conteo', finalidad: 'distribucion' })
    const ok = await p.pedir<Producto>(admin, 'PATCH', `/productos/${COCIDO}`, { stockObligatorio: true })
    expect(ok.status).toBe(200)
    expect(ok.body.stockObligatorio).toBe(true)
    // Ahora sí frena otra vez.
    expect((await p.pedir(cocina, 'POST', '/salidas', { productoId: COCIDO, cantidad: 1 })).status).toBe(409)
  })

  it('el aviso de stock mínimo también funciona con stock en negativo', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.pedir(admin, 'PATCH', `/productos/${COCIDO}`, { stockObligatorio: false, stockMinimo: 2 })
    const cocina = await p.entrar('cocina')
    await p.pedir(cocina, 'POST', '/salidas', { productoId: COCIDO, cantidad: 3 })
    const avisos = await p.pedir<Alerta[]>(cocina, 'GET', '/stock/alertas')
    expect(avisos.body).toEqual([expect.objectContaining({ tipo: 'stock_minimo', texto: 'Cocido con leche: no queda nada en frío (mínimo 2).' })])
  })
})
