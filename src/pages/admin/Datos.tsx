// I01–I05: descargar todos los datos en Excel, configurar los correos de resumen, copias de seguridad
// y registro de cambios del administrador (auditoría).
import { useEffect, useState, type FormEvent } from 'react'
import { esDemo, get, patch, post } from '../../cliente/api'
import { mensajeDe, useAccion, useConsulta } from '../../cliente/consultas'
import { celdaDeValor, descargarExcel, descargarTexto, negrita, type Hoja } from '../../cliente/excel'
import { Aviso, ConDatos } from '../../components/Estado'
import { diaLegible, diaPY, fechaHoraPY, sumarDias } from '../../shared/hora'
import { NOMBRE_TIPO_MOVIMIENTO, type Auditoria, type Configuracion, type Copia, type Exportacion, type TipoMovimiento } from '../../shared/tipos'
import '../../styles/reportes.css'

export default function Datos() {
  return (
    <div className="rep-pagina">
      <h1>Datos</h1>
      <Exportar />
      <ConfiguracionCorreos />
      <Copias />
      <RegistroDeCambios />
    </div>
  )
}

// ---------- I03: todos los datos en Excel ----------

/** Nombre legible de cada tabla para la pestaña del Excel y la auditoría. */
const NOMBRE_TABLA: Record<string, string> = {
  sectores: 'Sectores',
  usuarios: 'Usuarios',
  productos: 'Productos',
  maquinas: 'Máquinas',
  areas_limpieza: 'Áreas de limpieza',
  areas_sectores: 'Áreas por sector',
  tareas_limpieza: 'Tareas de limpieza',
  sucursales: 'Sucursales',
  lotes_mp: 'Lotes de materia prima',
  producciones: 'Producción',
  produccion_items: 'Producción por producto',
  lotes_chipa: 'Lotes de chipa',
  lote_chipa_mp: 'Lotes de chipa y MP',
  movimientos: 'Movimientos de stock',
  lecturas: 'Lecturas de máquinas',
  limpiezas: 'Limpiezas',
  limpieza_marcas: 'Limpiezas por tarea',
  auditoria: 'Auditoría',
  copias: 'Copias de seguridad',
  configuracion: 'Configuración',
  archivos: 'Archivos',
}

function hojasDeExportacion(e: Exportacion): Hoja[] {
  const tablas = Object.entries(e.tablas)
  const indice: Hoja = {
    nombre: 'Índice',
    arriba: [
      [negrita('Chipa Tía · Todos los datos', { fontSize: 14 })],
      ['Generado', celdaDeValor(e.generadoEn)],
      ['Fechas y horas en hora de Paraguay. Sin contraseñas, sesiones ni el contenido de fotos y copias.'],
    ],
    encabezados: ['Hoja', 'Tabla', 'Registros'],
    filas: tablas.map(([t, filas]) => [NOMBRE_TABLA[t] ?? t, t, filas.length]),
    anchos: [30, 22, 12],
  }
  return [indice, ...tablas.map(([t, filas]): Hoja => {
    const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))]
    return {
      nombre: NOMBRE_TABLA[t] ?? t,
      encabezados: columnas,
      filas: filas.map((f) => columnas.map((c) => celdaDeValor(f[c]))),
    }
  })]
}

function Exportar() {
  const [estado, setEstado] = useState<{ tipo: 'armando' | 'ok' | 'error'; texto: string } | null>(null)
  const descargar = async () => {
    setEstado({ tipo: 'armando', texto: 'Juntando los datos…' })
    try {
      const datos = await get<Exportacion>('/exportar')
      setEstado({ tipo: 'armando', texto: 'Armando el Excel…' })
      const archivo = `chipa-tia-datos-${diaPY()}.xlsx`
      await descargarExcel(archivo, hojasDeExportacion(datos))
      const registros = Object.values(datos.tablas).reduce((a, f) => a + f.length, 0)
      setEstado({ tipo: 'ok', texto: `Listo: se descargó ${archivo} con ${Object.keys(datos.tablas).length} tablas y ${registros.toLocaleString('es-PY')} registros.` })
    } catch (e) {
      console.error(e)
      setEstado({ tipo: 'error', texto: mensajeDe(e) })
    }
  }
  return (
    <section className="rep-seccion">
      <h2>Todos los datos</h2>
      <div className="tarjeta">
        <p className="rep-nota">
          Un Excel con una hoja por tabla: producción, stock, lotes, temperaturas, limpiezas, catálogos, usuarios
          (sin contraseñas) y el registro de cambios. Las fechas y horas están en hora de Paraguay.
        </p>
        <button type="button" className="btn-primario" onClick={() => void descargar()} disabled={estado?.tipo === 'armando'}>
          {estado?.tipo === 'armando' ? estado.texto : 'Descargar todos los datos en Excel'}
        </button>
        {estado?.tipo === 'ok' && <Aviso tipo="ok">{estado.texto}</Aviso>}
        {estado?.tipo === 'error' && <Aviso>{estado.texto}</Aviso>}
      </div>
    </section>
  )
}

// ---------- H04: a quién llegan los resúmenes ----------

function ConfiguracionCorreos() {
  const config = useConsulta<Configuracion>('/config')
  return (
    <section className="rep-seccion">
      <h2>Resúmenes por correo</h2>
      <ConDatos consulta={config}>{(c) => <FormularioConfig actual={c} />}</ConDatos>
    </section>
  )
}

function FormularioConfig({ actual }: { actual: Configuracion }) {
  const [correo, setCorreo] = useState(actual.correoReportes)
  const [url, setUrl] = useState(actual.urlPublica)
  const [guardado, setGuardado] = useState(false)
  const guardar = useAccion((c: Partial<Configuracion>) => patch<Configuracion>('/config', c))
  const cambio = correo.trim() !== actual.correoReportes || url.trim() !== actual.urlPublica
  const [ultimo, setUltimo] = useState(actual)
  // Si la configuración cambió en otro lado y acá no se tocó nada, se muestra la nueva.
  if (ultimo.correoReportes !== actual.correoReportes || ultimo.urlPublica !== actual.urlPublica) {
    setUltimo(actual)
    if (correo.trim() === ultimo.correoReportes && url.trim() === ultimo.urlPublica) {
      setCorreo(actual.correoReportes)
      setUrl(actual.urlPublica)
    }
  }
  const estaPagina = location.href.split('#')[0].replace(/\/(index\.html)?$/, '')

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault()
    setGuardado(false)
    const r = await guardar.ejecutar({ correoReportes: correo, urlPublica: url })
    if (r) {
      // Lo que quedó guardado, ya ordenado por el servidor (minúsculas, sin barra final).
      setCorreo(r.correoReportes)
      setUrl(r.urlPublica)
      setGuardado(true)
    }
  }

  return (
    <form className="tarjeta" onSubmit={enviar}>
      <label className="campo">
        <span>Correo que recibe los resúmenes</span>
        <input
          type="text" inputMode="email" autoCapitalize="none" autoComplete="email" placeholder="administracion@chipatia.com"
          value={correo} onChange={(e) => { setCorreo(e.target.value); setGuardado(false) }}
        />
        <span className="chico suave">Para varios, separalos con coma (hasta 5).</span>
      </label>
      <label className="campo">
        <span>Dirección pública del sistema</span>
        <input
          type="url" inputMode="url" autoCapitalize="none" placeholder="https://chipatia.com"
          value={url} onChange={(e) => { setUrl(e.target.value); setGuardado(false) }}
        />
        <span className="chico suave">
          Es la que se abre en el navegador; el enlace del correo lleva al reporte completo.{' '}
          {url.trim() !== estaPagina && (
            <button type="button" className="btn-texto" onClick={() => { setUrl(estaPagina); setGuardado(false) }}>Usar la de esta página</button>
          )}
        </span>
      </label>
      {guardar.error && <Aviso>{guardar.error}</Aviso>}
      {guardado && !cambio && <Aviso tipo="ok">Guardado.</Aviso>}
      <button type="submit" className="btn-primario" disabled={guardar.enviando || !cambio}>
        {guardar.enviando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}

// ---------- I02 e I05: copias de seguridad ----------

const tamaño = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-PY')} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`

function Copias() {
  const copias = useConsulta<Copia[]>('/copias')
  const hacer = useAccion(() => post<Copia>('/copias'))
  const [hecha, setHecha] = useState<Copia | null>(null)
  const [bajando, setBajando] = useState<string | null>(null)
  const [errorBajar, setErrorBajar] = useState<string | null>(null)

  const hacerAhora = async () => {
    setHecha(null)
    const c = await hacer.ejecutar()
    if (c) setHecha(c)
  }
  const bajar = async (c: Copia) => {
    setBajando(c.clave)
    setErrorBajar(null)
    try {
      const datos = await get<unknown>(`/copias/${encodeURIComponent(c.clave)}`)
      descargarTexto(`chipa-tia-${c.clave.replace(/^copias\//, 'copia-')}`, JSON.stringify(datos, null, 1))
    } catch (e) {
      setErrorBajar(mensajeDe(e))
    } finally {
      setBajando(null)
    }
  }

  return (
    <section className="rep-seccion">
      <h2>Copias de seguridad</h2>
      <div className="tarjeta">
        <p className="rep-nota">
          <strong>Últimos 7 días:</strong> Cloudflare guarda cada cambio y la base se puede volver a cualquier minuto
          de la última semana (D1 Time Travel; los pasos están en la guía de puesta en línea, docs/despliegue.md).
        </p>
        <p className="rep-nota">
          <strong>Copia semanal:</strong> todos los lunes a las 06:00 se guarda aparte una copia completa, para errores
          que se descubran más tarde. También podés hacer una ahora y bajarla.
          {esDemo && ' En la demo las copias quedan en este navegador.'}
        </p>
        <button type="button" className="btn-secundario" onClick={() => void hacerAhora()} disabled={hacer.enviando}>
          {hacer.enviando ? 'Haciendo la copia…' : 'Hacer copia ahora'}
        </button>
        {hacer.error && <Aviso>{hacer.error}</Aviso>}
        {hecha && <Aviso tipo="ok">Copia guardada: {fechaHoraPY(hecha.fecha)} · {tamaño(hecha.bytes)}.</Aviso>}
        {errorBajar && <Aviso>{errorBajar}</Aviso>}
        <ConDatos consulta={copias}>
          {(lista) => lista.length === 0 ? <p className="suave">Todavía no hay copias.</p> : (
            <ul className="rep-copias" aria-label="Copias guardadas">
              {lista.map((c) => (
                <li key={c.clave}>
                  <div>
                    <strong>{fechaHoraPY(c.fecha)}</strong>
                    <div className="rep-muted">
                      <span className={`rep-etiqueta${c.origen === 'automatica' ? ' rep-verde' : ''}`}>
                        {c.origen === 'automatica' ? 'Semanal automática' : 'Hecha a mano'}
                      </span>{' '}
                      {tamaño(c.bytes)}
                    </div>
                  </div>
                  <button type="button" className="btn-secundario" onClick={() => void bajar(c)} disabled={bajando !== null}
                    aria-label={`Descargar la copia del ${fechaHoraPY(c.fecha)}`}>
                    {bajando === c.clave ? 'Bajando…' : 'Descargar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ConDatos>
      </div>
    </section>
  )
}

// ---------- Registro de cambios (auditoría) ----------

const ACCION: Record<string, string> = {
  crear: 'Creó',
  editar: 'Editó',
  desactivar: 'Desactivó',
  activar: 'Reactivó',
  corregir: 'Corrigió',
  ajustar: 'Registró un ajuste en',
  bloquear: 'Bloqueó',
  desbloquear: 'Desbloqueó',
  controlar: 'Dio el visto bueno a',
  restablecer_clave: 'Restableció la contraseña de',
}
const QUE: Record<string, string> = {
  producciones: 'un registro de producción',
  movimientos: 'el stock',
  lotes_mp: 'un lote de materia prima',
  limpiezas: 'una limpieza',
  usuarios: 'un usuario',
  productos: 'un producto',
  maquinas: 'una máquina',
  areas_limpieza: 'un área de limpieza',
  tareas_limpieza: 'una tarea de limpieza',
  sucursales: 'una sucursal',
  sectores: 'un sector',
  configuracion: 'la configuración',
  copias: 'una copia de seguridad',
}
const FILTRO_TABLAS = ['producciones', 'movimientos', 'lotes_mp', 'limpiezas', 'usuarios', 'productos', 'maquinas', 'areas_limpieza', 'tareas_limpieza', 'sucursales', 'sectores', 'configuracion', 'copias']
const CAMPO: Record<string, string> = {
  correoReportes: 'Correo de reportes', urlPublica: 'Dirección pública', nombre: 'Nombre', usuario: 'Usuario', rol: 'Rol',
  activo: 'Activo', debeCambiarClave: 'Debe cambiar la contraseña', unidad: 'Unidad', numero: 'N°', tipo: 'Tipo',
  tempMin: 'T° mínima', tempMax: 'T° máxima', codigo: 'Código', sectores: 'Sectores', pideNumero: 'Pide N° de equipo',
  bloqueado: 'Bloqueado', lote: 'Lote', producto: 'Producto', stock: 'Stock', cantidad: 'Cantidad', motivo: 'Motivo',
  sector: 'Sector', controladoEn: 'Controlado el', corregidoEn: 'Corregido el', clave: 'Archivo', bytes: 'Tamaño',
  origen: 'Origen', fecha: 'Fecha', dia: 'Día', creadoEn: 'Creado el', cocinado: 'cocinado', guardado: 'guardado',
}
/** Identificadores internos: no le dicen nada a quien lee (quién lo hizo ya figura arriba). */
const OCULTOS = /^(id|.*Id|controladoPor|corregidoPor|corregidoPorNombre|controladoPorNombre)$/

function leerJson(v: string | null): unknown {
  if (v === null) return undefined
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Un valor guardado, en palabras: fechas en hora de Paraguay, sí/no, "vacío". */
function valor(k: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return 'vacío'
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (k === 'bytes' && typeof v === 'number') return tamaño(v)
  if (k === 'tipo' && typeof v === 'string' && v in NOMBRE_TIPO_MOVIMIENTO) return NOMBRE_TIPO_MOVIMIENTO[v as TipoMovimiento]
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fechaHoraPY(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return diaLegible(v)
  if (typeof v === 'number') return v.toLocaleString('es-PY')
  const t = typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ') : JSON.stringify(v)
  return t.length > 140 ? `${t.slice(0, 140)}…` : t
}

/** Corrección de producción: qué cambió en cada producto. */
function cambiosDeItems(antes: unknown, despues: unknown): string[] | null {
  type Item = { productoId?: string; productoNombre?: string; cocinado?: number; guardado?: number }
  if (!Array.isArray(antes) || !Array.isArray(despues)) return null
  const a = antes as Item[]
  const d = despues as Item[]
  const ids = [...new Set([...a, ...d].map((i) => i.productoId))]
  return ids.flatMap((id) => {
    const x = a.find((i) => i.productoId === id)
    const y = d.find((i) => i.productoId === id)
    const nombre = y?.productoNombre ?? x?.productoNombre ?? id
    const partes = (['cocinado', 'guardado'] as const)
      .filter((c) => (x?.[c] ?? 0) !== (y?.[c] ?? 0))
      .map((c) => `${c} ${x?.[c] ?? 0} → ${y?.[c] ?? 0}`)
    return partes.length ? [`${nombre}: ${partes.join(', ')}`] : []
  })
}

/** Qué cambió: "campo: antes → después" para los campos distintos; al crear, lo principal. */
function cambios(a: Auditoria): string[] {
  const antes = leerJson(a.antes)
  const despues = leerJson(a.despues)
  const etiqueta = (k: string) => CAMPO[k] ?? k
  if (esObjeto(antes) && esObjeto(despues)) {
    return [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
      .filter((k) => !OCULTOS.test(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .flatMap((k) => {
        if (k === 'items') return cambiosDeItems(antes[k], despues[k]) ?? [`${etiqueta(k)}: ${valor(k, despues[k])}`]
        return [antes[k] === undefined
          ? `${etiqueta(k)}: ${valor(k, despues[k])}`
          : `${etiqueta(k)}: ${valor(k, antes[k])} → ${valor(k, despues[k])}`]
      })
  }
  if (esObjeto(despues)) {
    return Object.entries(despues).filter(([k]) => !OCULTOS.test(k)).slice(0, 6).map(([k, v]) => `${etiqueta(k)}: ${valor(k, v)}`)
  }
  if (despues !== undefined || antes !== undefined) return [`${valor('', antes)} → ${valor('', despues)}`]
  return []
}

/** Nombre del registro tocado, si lo trae: «Empanada frita», «Queso · Proveedor · lote 12». */
function nombreDe(a: Auditoria): string | null {
  for (const v of [leerJson(a.despues), leerJson(a.antes)]) {
    if (!esObjeto(v)) continue
    for (const k of ['nombre', 'producto', 'lote', 'usuario']) if (typeof v[k] === 'string' && v[k]) return v[k] as string
  }
  return null
}

function RegistroDeCambios() {
  const hoy = diaPY()
  const [tabla, setTabla] = useState('')
  const [desde, setDesde] = useState(() => sumarDias(hoy, -30))
  const [hasta, setHasta] = useState(hoy)
  const rangoMal = !!desde && !!hasta && desde > hasta
  const consulta = useConsulta<Auditoria[]>(rangoMal ? null : '/auditoria', { tabla, desde, hasta })
  const [cuantos, setCuantos] = useState(30)
  useEffect(() => setCuantos(30), [tabla, desde, hasta])

  return (
    <section className="rep-seccion">
      <h2>Registro de cambios</h2>
      <p className="rep-nota">Correcciones, ajustes, bloqueos y cambios de catálogos y usuarios hechos por el administrador.</p>
      <div className="tarjeta rep-fechas">
        <label className="campo"><span>Desde</span><input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo rep-sector"><span>Qué</span>
          <select value={tabla} onChange={(e) => setTabla(e.target.value)}>
            <option value="">Todo</option>
            {FILTRO_TABLAS.map((t) => <option key={t} value={t}>{NOMBRE_TABLA[t] ?? t}</option>)}
          </select>
        </label>
      </div>
      {rangoMal ? <Aviso>La fecha desde no puede ser posterior a la fecha hasta.</Aviso> : (
        <ConDatos consulta={consulta}>
          {(lista) => lista.length === 0 ? <p className="suave">No hay cambios con esos filtros.</p> : (
            <>
              <div className="rep-auditoria">
                {lista.slice(0, cuantos).map((a) => {
                  const detalle = cambios(a)
                  return (
                    <article key={a.id} className="rep-cambio">
                      <span className="rep-muted">{fechaHoraPY(a.fecha)} · {a.usuarioNombre}</span>
                      <strong>{ACCION[a.accion] ?? a.accion} {QUE[a.tabla] ?? a.tabla}{nombreDe(a) ? ` «${nombreDe(a)}»` : ''}</strong>
                      {detalle.length > 0 && <ul>{detalle.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                      {(a.antes || a.despues) && (
                        <details>
                          <summary>Ver el detalle completo</summary>
                          <pre>{[a.antes && `Antes: ${JSON.stringify(leerJson(a.antes), null, 1)}`, a.despues && `Después: ${JSON.stringify(leerJson(a.despues), null, 1)}`].filter(Boolean).join('\n\n')}</pre>
                        </details>
                      )}
                    </article>
                  )
                })}
              </div>
              {lista.length > cuantos && (
                <button type="button" className="btn-secundario" onClick={() => setCuantos((n) => n + 50)}>
                  Ver más ({lista.length - cuantos} {lista.length - cuantos === 1 ? 'queda' : 'quedan'})
                </button>
              )}
            </>
          )}
        </ConDatos>
      )}
    </section>
  )
}
