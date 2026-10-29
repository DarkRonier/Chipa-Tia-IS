// I01–I05: configuración de correos, exportación completa (I03), copias de seguridad (I05) y auditoría.
import { describe, expect, it } from 'vitest'
import type { BucketR2 } from '../src/server/entorno'
import { diaPY, sumarDias } from '../src/shared/hora'
import type { Auditoria, Configuracion, Copia, Exportacion } from '../src/shared/tipos'
import { nuevaPrueba, type Prueba } from './ayuda'

/** Un registro de producción cargado directo (es de otro módulo), como el de la prueba C01. */
async function produccionDePrueba(p: Prueba) {
  const dia = diaPY()
  await p.sql("INSERT INTO producciones (id, sector, usuario_id, fecha, dia, turno) VALUES ('prod-prueba', 'cocina', 'usr-cocina', ?, ?, 'dia')",
    new Date().toISOString(), dia)
  await p.sql("INSERT INTO produccion_items (produccion_id, producto_id, cocinado, guardado) VALUES ('prod-prueba', 'prod-cocina-10', 30, 8)")
  await p.sql(`INSERT INTO movimientos (id, sector, producto_id, tipo, cantidad, produccion_id, usuario_id, fecha, dia)
               VALUES ('mov-prueba', 'cocina', 'prod-cocina-10', 'produccion', 8, 'prod-prueba', 'usr-cocina', ?, ?)`, new Date().toISOString(), dia)
}

describe('configuración de los correos', () => {
  it('guarda el correo y la dirección pública normalizados, con auditoría', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    expect((await p.pedir<Configuracion>(admin, 'GET', '/config')).body).toEqual({ correoReportes: '', urlPublica: '' })

    const r = await p.pedir<Configuracion>(admin, 'PATCH', '/config', {
      correoReportes: ' Administracion@ChipaTia.com.py ', urlPublica: 'https://chipatia.com.py/#/admin',
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ correoReportes: 'administracion@chipatia.com.py', urlPublica: 'https://chipatia.com.py' })
    expect((await p.pedir(admin, 'GET', '/config')).body).toEqual(r.body)

    // Solo un campo: el otro queda; varios correos separados por coma; http y subcarpetas (GitHub Pages).
    const r2 = await p.pedir<Configuracion>(admin, 'PATCH', '/config', { urlPublica: 'http://localhost:5173/Chipa-Tia-IS/?x=1' })
    expect(r2.body).toEqual({ correoReportes: 'administracion@chipatia.com.py', urlPublica: 'http://localhost:5173/Chipa-Tia-IS' })
    const r3 = await p.pedir<Configuracion>(admin, 'PATCH', '/config', { correoReportes: 'a@chipatia.com,b@chipatia.com; a@chipatia.com' })
    expect(r3.body.correoReportes).toBe('a@chipatia.com, b@chipatia.com')
    // Vacío = sin correo.
    expect((await p.pedir<Configuracion>(admin, 'PATCH', '/config', { correoReportes: '' })).body.correoReportes).toBe('')

    const aud = await p.sql("SELECT registro_id, accion, usuario_id, antes, despues FROM auditoria WHERE tabla = 'configuracion' ORDER BY fecha, rowid")
    expect(aud.map((a) => a.registro_id)).toEqual(['correoReportes', 'urlPublica', 'urlPublica', 'correoReportes', 'correoReportes'])
    expect(aud[0]).toMatchObject({ accion: 'editar', usuario_id: 'usr-admin', antes: '{"correoReportes":""}' })
    expect(JSON.parse(aud[1].despues)).toEqual({ urlPublica: 'https://chipatia.com.py' })
    // Sin cambios no se audita nada.
    await p.pedir(admin, 'PATCH', '/config', { urlPublica: 'http://localhost:5173/Chipa-Tia-IS' })
    expect(await p.sql("SELECT * FROM auditoria WHERE tabla = 'configuracion'")).toHaveLength(5)
  })

  it('rechaza correos y direcciones mal escritos', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const mal = async (cuerpo: unknown) => {
      const r = await p.pedir(admin, 'PATCH', '/config', cuerpo)
      expect(r.status).toBe(400)
      return r.body.error.mensaje as string
    }
    expect(await mal({ correoReportes: 'administracion' })).toBe('Revisá el correo «administracion»: tiene que ser como nombre@dominio.com.')
    expect(await mal({ correoReportes: 'a@b' })).toMatch(/Revisá el correo/)
    expect(await mal({ correoReportes: 42 })).toMatch(/correo/)
    expect(await mal({ correoReportes: 'a@x.com b@x.com c@x.com d@x.com e@x.com f@x.com' })).toBe('Cargá hasta 5 correos.')
    expect(await mal({ urlPublica: 'chipatia.com' })).toMatch(/https:\/\//)
    expect(await mal({ urlPublica: 'ftp://chipatia.com' })).toMatch(/https:\/\//)
    expect(await mal({ urlPublica: 'javascript:alert(1)' })).toMatch(/https:\/\//)
    expect(await mal({ urlPublica: 'https://yo:clave@chipatia.com' })).toMatch(/usuario/)
    expect((await p.pedir(admin, 'PATCH', '/config', 'no es json')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', '/config')).body).toEqual({ correoReportes: '', urlPublica: '' })
  })
})

describe('datos solo para el administrador', () => {
  it('los operadores reciben 403 y sin sesión 401', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const copia = await p.pedir<Copia>(admin, 'POST', '/copias')
    for (const u of ['chiperia', 'chipitas', 'panaderia', 'cocina']) {
      const t = await p.entrar(u)
      for (const [m, ruta, cuerpo] of [
        ['GET', '/config'], ['PATCH', '/config', { correoReportes: 'x@y.com' }], ['GET', '/exportar'], ['GET', '/copias'],
        ['POST', '/copias'], ['GET', `/copias/${encodeURIComponent(copia.body.clave)}`], ['GET', '/auditoria'],
      ] as [string, string, unknown?][]) {
        const r = await p.pedir(t, m, ruta, cuerpo)
        expect(r.status, `${u} ${m} ${ruta}`).toBe(403)
      }
      expect((await p.pedir(null, 'GET', '/exportar')).status).toBe(401)
    }
    expect(await p.sql('SELECT * FROM copias')).toHaveLength(1)
    expect((await p.pedir(admin, 'GET', '/config')).body.correoReportes).toBe('')
  })
})

describe('descargar todos los datos (I03)', () => {
  it('trae todas las tablas con los registros, sin contraseñas, sesiones ni archivos', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await produccionDePrueba(p)
    await p.sql("INSERT INTO archivos (clave, tipo, datos, bytes, creado_en) VALUES ('fotos/x.jpg', 'image/jpeg', 'QUJD', 3, '2026-10-10T10:00:00.000Z')")
    const r = await p.pedir<Exportacion>(admin, 'GET', '/exportar')
    expect(r.status).toBe(200)
    const { tablas } = r.body
    expect(Date.parse(r.body.generadoEn)).toBeGreaterThan(Date.now() - 60_000)
    expect(Object.keys(tablas)).toEqual([
      'sectores', 'usuarios', 'productos', 'maquinas', 'areas_limpieza', 'areas_sectores', 'tareas_limpieza', 'sucursales',
      'lotes_mp', 'producciones', 'produccion_items', 'lotes_chipa', 'lote_chipa_mp', 'movimientos', 'lecturas',
      'limpiezas', 'limpieza_marcas', 'auditoria', 'copias', 'configuracion', 'archivos',
    ])
    expect(tablas.sesiones).toBeUndefined()
    // Los registros de la prueba.
    expect(tablas.producciones).toEqual([expect.objectContaining({ id: 'prod-prueba', sector: 'cocina', usuario_id: 'usr-cocina' })])
    expect(tablas.produccion_items).toEqual([{ produccion_id: 'prod-prueba', producto_id: 'prod-cocina-10', cocinado: 30, guardado: 8 }])
    expect(tablas.movimientos).toHaveLength(1)
    expect(tablas.productos.length).toBeGreaterThan(40)
    // Usuarios sin el hash de la contraseña.
    expect(tablas.usuarios).toHaveLength(5)
    expect(tablas.usuarios[0]).toEqual(expect.objectContaining({ usuario: 'chiperia', rol: 'chiperia' }))
    for (const u of tablas.usuarios) expect(Object.keys(u)).not.toContain('clave_hash')
    expect(JSON.stringify(r.body)).not.toMatch(/pbkdf2/)
    // Archivos: solo los datos de referencia, no el contenido.
    expect(tablas.archivos).toEqual([{ clave: 'fotos/x.jpg', tipo: 'image/jpeg', bytes: 3, creado_en: '2026-10-10T10:00:00.000Z' }])
  })
})

describe('copias de seguridad (I05)', () => {
  it('genera a mano la copia con la fecha del día y se puede bajar', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await produccionDePrueba(p)
    const r = await p.pedir<Copia>(admin, 'POST', '/copias')
    expect(r.status).toBe(200)
    const hoy = diaPY()
    expect(r.body).toMatchObject({ origen: 'manual', dia: hoy })
    expect(r.body.clave).toMatch(new RegExp(`^copias/${hoy}T\\d{6}\\.json$`))
    expect(r.body.bytes).toBeGreaterThan(1000)
    expect(Date.parse(r.body.fecha)).toBeGreaterThan(Date.now() - 60_000)

    const lista = await p.pedir<Copia[]>(admin, 'GET', '/copias')
    expect(lista.body).toEqual([r.body])

    // Se baja con la clave codificada o tal cual.
    const bajada = await p.pedir(admin, 'GET', `/copias/${encodeURIComponent(r.body.clave)}`)
    expect(bajada.status).toBe(200)
    expect(bajada.body.copia).toEqual({ clave: r.body.clave, origen: 'manual' })
    expect(bajada.body.tablas.produccion_items).toEqual([{ produccion_id: 'prod-prueba', producto_id: 'prod-cocina-10', cocinado: 30, guardado: 8 }])
    expect(bajada.body.tablas.sesiones).toBeUndefined()
    for (const u of bajada.body.tablas.usuarios) expect(u.clave_hash).toBeUndefined()
    expect((await p.pedir(admin, 'GET', `/${r.body.clave}`)).body).toEqual(bajada.body)
    expect((await p.pedir(admin, 'GET', `/copias/${r.body.clave.slice('copias/'.length)}`)).body).toEqual(bajada.body)

    // Queda anotado quién la hizo.
    const [aud] = await p.sql("SELECT * FROM auditoria WHERE tabla = 'copias'")
    expect(aud).toMatchObject({ registro_id: r.body.clave, accion: 'crear', usuario_id: 'usr-admin' })

    // Dos copias seguidas no se pisan; la lista muestra la más nueva primero.
    const otra = await p.pedir<Copia>(admin, 'POST', '/copias')
    expect(otra.body.clave).not.toBe(r.body.clave)
    const dos = await p.pedir<Copia[]>(admin, 'GET', '/copias')
    expect(dos.body.map((c) => c.clave)).toEqual([otra.body.clave, r.body.clave])
    // La copia nueva no lleva adentro el contenido de la anterior.
    const segunda = await p.pedir(admin, 'GET', `/copias/${encodeURIComponent(otra.body.clave)}`)
    expect(segunda.body.tablas.copias).toHaveLength(1)
    expect(segunda.body.tablas.archivos.every((a: Record<string, unknown>) => !('datos' in a))).toBe(true)
  })

  it('no entrega archivos que no son copias ni copias que no existen', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    await p.sql("INSERT INTO archivos (clave, tipo, datos, bytes, creado_en) VALUES ('fotos/x.jpg', 'image/jpeg', 'QUJD', 3, '2026-10-10T10:00:00.000Z')")
    expect((await p.pedir(admin, 'GET', `/copias/${encodeURIComponent('fotos/x.jpg')}`)).status).toBe(404)
    expect((await p.pedir(admin, 'GET', '/copias/copias%2F2020-01-01T000000.json')).status).toBe(404)
    expect((await p.pedir(admin, 'GET', '/copias/%E0%A4%A')).status).toBe(404)
    // Fila sin archivo (por ejemplo, borrado a mano del bucket).
    await p.sql("INSERT INTO copias (clave, fecha, dia, bytes, origen) VALUES ('copias/2026-01-05T060000.json', '2026-01-05T09:00:00.000Z', '2026-01-05', 10, 'automatica')")
    const sinArchivo = await p.pedir(admin, 'GET', `/copias/${encodeURIComponent('copias/2026-01-05T060000.json')}`)
    expect(sinArchivo.status).toBe(404)
    expect(sinArchivo.body.error.mensaje).toMatch(/Hacé una copia nueva/)
  })

  it('en Cloudflare la guarda en R2', async () => {
    const guardados = new Map<string, { datos: Uint8Array; tipo?: string }>()
    const r2: BucketR2 = {
      async put(clave, datos, op) {
        guardados.set(clave, { datos: datos as Uint8Array, tipo: op?.httpMetadata?.contentType })
      },
      async get(clave) {
        const g = guardados.get(clave)
        return g ? { arrayBuffer: async () => g.datos.slice().buffer, httpMetadata: { contentType: g.tipo } } : null
      },
      async delete(clave) {
        for (const k of [clave].flat()) guardados.delete(k)
      },
    }
    const p = await nuevaPrueba({ ARCHIVOS: r2 })
    const admin = await p.entrar('admin')
    const r = await p.pedir<Copia>(admin, 'POST', '/copias')
    expect(guardados.get(r.body.clave)?.tipo).toBe('application/json')
    expect(await p.sql('SELECT * FROM archivos')).toEqual([])
    const bajada = await p.pedir(admin, 'GET', `/copias/${encodeURIComponent(r.body.clave)}`)
    expect(bajada.body.tablas.sectores).toHaveLength(4)
  })
})

describe('auditoría', () => {
  it('lista los cambios con el nombre de quién los hizo y filtra por tabla y día de Paraguay', async () => {
    const p = await nuevaPrueba()
    const admin = await p.entrar('admin')
    const hoy = diaPY()
    const ayer = sumarDias(hoy, -1)
    await p.pedir(admin, 'PATCH', '/config', { correoReportes: 'admin@chipatia.com' })
    // 01:00 UTC de hoy (UTC) es todavía el día anterior en Paraguay.
    await p.sql(`INSERT INTO auditoria (id, tabla, registro_id, accion, usuario_id, fecha, antes, despues)
                 VALUES ('a-noche', 'productos', 'prod-cocina-10', 'editar', 'usr-admin', ?, '{"nombre":"Empanada"}', '{"nombre":"Empanada frita"}')`,
    `${hoy}T01:00:00.000Z`)
    await p.sql(`INSERT INTO auditoria (id, tabla, registro_id, accion, usuario_id, fecha) VALUES ('a-vieja', 'usuarios', 'usr-cocina', 'crear', 'usr-admin', ?)`,
      `${sumarDias(hoy, -40)}T15:00:00.000Z`)

    const todo = await p.pedir<Auditoria[]>(admin, 'GET', '/auditoria')
    expect(todo.status).toBe(200)
    expect(todo.body.map((a) => a.id).slice(1)).toEqual(['a-noche', 'a-vieja'])
    expect(todo.body[0]).toMatchObject({ tabla: 'configuracion', registroId: 'correoReportes', accion: 'editar', usuarioId: 'usr-admin', usuarioNombre: 'Administración' })
    expect(todo.body[1]).toMatchObject({ antes: '{"nombre":"Empanada"}', despues: '{"nombre":"Empanada frita"}' })

    const ids = async (q: string) => (await p.pedir<Auditoria[]>(admin, 'GET', `/auditoria${q}`)).body.map((a) => a.id)
    expect(await ids('?tabla=productos')).toEqual(['a-noche'])
    expect(await ids(`?desde=${ayer}&hasta=${ayer}`)).toEqual(['a-noche'])
    expect((await ids(`?desde=${hoy}`))).toEqual([todo.body[0].id])
    expect(await ids(`?hasta=${sumarDias(hoy, -2)}`)).toEqual(['a-vieja'])
    expect(await ids('?tabla=lecturas')).toEqual([])
    expect((await p.pedir(admin, 'GET', '/auditoria?desde=ayer')).status).toBe(400)
    expect((await p.pedir(admin, 'GET', `/auditoria?desde=${hoy}&hasta=${ayer}`)).status).toBe(400)
  })
})
