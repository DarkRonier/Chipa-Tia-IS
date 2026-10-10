// H04: resumen por correo (diario, semanal y mensual; y 'hoy' para la prueba, con lo cargado hasta ahora) con enlace al reporte completo. Se envía con Resend.
// Todas las fechas y horas van en hora de Paraguay (I04). En la demo, o si falta configurar algo,
// no se envía nada: se devuelve la vista previa y el motivo.
import { diaDeSemana, diaLegible, fechaHoraPY, rangoResumen } from '../shared/hora'
import type { PeriodoResumen, Reporte, ResumenCorreo, SectorId } from '../shared/tipos'
import { NOMBRE_ESTADO, NOMBRE_TIPO_MOVIMIENTO } from '../shared/tipos'
import { todas } from './db'
import type { Env } from './entorno'
import { armarReporte } from './reporte'
import { leerConfiguracion } from './rutas/datos'

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const NOMBRE_PERIODO: Record<PeriodoResumen, string> = { hoy: 'de hoy', diario: 'diario', semanal: 'semanal', mensual: 'mensual' }

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const grados = (t: number | null) => (t === null ? 'sin temperatura' : `${String(t).replace('.', ',')} °C`)
const conDia = (dia: string) => `${DIAS[diaDeSemana(dia)]} ${diaLegible(dia)}`

/** "viernes 09/10/2026", "del lunes 28/09/2026 al domingo 04/10/2026" o "septiembre de 2026". */
export function textoPeriodo(periodo: PeriodoResumen, desde: string, hasta: string): string {
  if (periodo === 'mensual' && desde.endsWith('-01') && desde.slice(0, 7) === hasta.slice(0, 7)) {
    return `${MESES[Number(desde.slice(5, 7)) - 1]} de ${desde.slice(0, 4)}`
  }
  return desde === hasta ? conDia(desde) : `del ${conDia(desde)} al ${conDia(hasta)}`
}

/** Enlace al reporte completo del período (la app usa rutas con #). */
export function enlaceReporte(urlPublica: string, desde: string, hasta: string): string | null {
  if (!urlPublica) return null
  return `${urlPublica.replace(/\/+$/, '')}/#/admin/reportes?desde=${desde}&hasta=${hasta}`
}

/** Hora de corte del resumen de hoy ("15:40"), en hora de Paraguay. */
const horaDeCorte = (r: Reporte) => fechaHoraPY(r.generadoEn).slice(-5)

export function asuntoResumen(periodo: PeriodoResumen, r: Reporte): string {
  const cuando = periodo === 'hoy'
    ? `hasta las ${horaDeCorte(r)}`
    : periodo === 'diario'
      ? `del ${diaLegible(r.desde)}`
      : periodo === 'semanal'
        ? `del ${r.desde.slice(0, 4) === r.hasta.slice(0, 4) ? diaLegible(r.desde).slice(0, 5) : diaLegible(r.desde)} al ${diaLegible(r.hasta)}`
        : `de ${textoPeriodo('mensual', r.desde, r.hasta)}`
  const alertas = r.totales.temperaturasFueraDeRango
  const extra = alertas ? ` · ${alertas} ${alertas === 1 ? 'temperatura fuera de rango' : 'temperaturas fuera de rango'}` : ''
  return `Chipa Tía · Resumen ${NOMBRE_PERIODO[periodo]} ${cuando}${extra}`
}

// ---------- HTML del correo (estilos en línea, tablas: así se ve bien en Gmail y Outlook) ----------

const C = { marca: '#8a4b12', texto: '#2b1d0e', suave: '#75644f', borde: '#e4d8c6', fondo: '#faf6f0', rojo: '#c62828', rojoFondo: '#fdecea' }
const td = (alinear: 'left' | 'right' = 'left', extra = '') =>
  `style="padding:6px 5px;border-bottom:1px solid ${C.borde};text-align:${alinear};vertical-align:top;${extra}"`
const th = (alinear: 'left' | 'right' = 'left') =>
  `style="padding:6px 5px;border-bottom:2px solid ${C.borde};text-align:${alinear};font-size:12px;color:${C.suave};font-weight:600"`

function tabla(cabeza: [string, 'left' | 'right'][], filas: string[][], rojas = false): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 8px">
<tr>${cabeza.map(([t, a]) => `<th ${th(a)}>${esc(t)}</th>`).join('')}</tr>
${filas.map((f) => `<tr>${f.map((v, i) => `<td ${td(cabeza[i][1], rojas ? `color:${C.rojo};background:${C.rojoFondo};` : '')}>${v}</td>`).join('')}</tr>`).join('\n')}
</table>`
}

const titulo = (t: string, rojo = false) =>
  `<h2 style="font-size:16px;margin:22px 0 8px;color:${rojo ? C.rojo : C.texto}">${esc(t)}</h2>`
const nada = (t: string) => `<p style="margin:0 0 8px;color:${C.suave};font-size:14px">${esc(t)}</p>`

export function htmlResumen(o: {
  periodo: PeriodoResumen
  reporte: Reporte
  sectores: Record<string, string>
  enlace: string | null
}): string {
  const { reporte: r, enlace } = o
  const sector = (id: SectorId) => esc(o.sectores[id] ?? id)
  const t = r.totales
  const cifras: [string, string, boolean][] = [
    [miles(t.cargasProduccion), 'cargas de producción', false],
    [miles(t.unidadesCocinadas), 'unidades cocinadas (venta)', false],
    [miles(t.unidadesGuardadas), 'unidades guardadas en frío', false],
    [miles(t.unidadesEnviadas), 'unidades enviadas a sucursales', false],
    [miles(t.temperaturasFueraDeRango), 'temperaturas fuera de rango', t.temperaturasFueraDeRango > 0],
    [`${miles(t.limpiezas)}`, `limpiezas (${miles(t.limpiezasSinControlar)} sin controlar)`, false],
  ]
  const celdaCifra = ([n, txt, alerta]: [string, string, boolean]) =>
    `<td width="50%" style="padding:4px"><div style="border:1px solid ${alerta ? C.rojo : C.borde};border-radius:8px;padding:10px;background:${alerta ? C.rojoFondo : '#ffffff'};color:${alerta ? C.rojo : C.texto}">
<div style="font-size:22px;font-weight:700">${n}</div><div style="font-size:12px;color:${alerta ? C.rojo : C.suave}">${esc(txt)}</div></div></td>`

  const partes: string[] = []
  partes.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${[0, 2, 4]
    .map((i) => `<tr>${celdaCifra(cifras[i])}${celdaCifra(cifras[i + 1])}</tr>`).join('')}</table>`)

  // Alertas primero: es lo que hay que mirar.
  if (r.temperaturasFueraDeRango.length) {
    partes.push(titulo('Temperaturas fuera de rango', true))
    partes.push(tabla([['Fecha y hora', 'left'], ['Máquina', 'left'], ['Temperatura', 'right']],
      r.temperaturasFueraDeRango.map((l) => [
        esc(fechaHoraPY(l.fecha)),
        `${esc(l.maquinaNombre)} (N° ${l.maquinaNumero}) · ${sector(l.sector)}${l.observacion ? `<br><span style="font-size:12px">${esc(l.observacion)}</span>` : ''}`,
        esc(grados(l.temperatura)),
      ]), true))
  }
  if (r.maquinasConFallas.length) {
    partes.push(titulo('Máquinas con fallas', true))
    partes.push(tabla([['Fecha y hora', 'left'], ['Máquina', 'left'], ['Estado', 'left']],
      r.maquinasConFallas.map((l) => [
        esc(fechaHoraPY(l.fecha)),
        `${esc(l.maquinaNombre)} (N° ${l.maquinaNumero}) · ${sector(l.sector)}${l.observacion ? `<br><span style="font-size:12px">${esc(l.observacion)}</span>` : ''}${l.mantenimiento ? `<br><span style="font-size:12px">Mantenimiento: ${esc(l.mantenimiento)}${l.mantenimientoPor ? ` · ${esc(l.mantenimientoPor)}` : ''}</span>` : ''}`,
        esc(NOMBRE_ESTADO[l.estado]),
      ])))
  }

  partes.push(titulo('Producción por producto'))
  partes.push(r.produccion.length
    ? tabla([['Producto', 'left'], ['Cocinado', 'right'], ['Guardado', 'right']],
      r.produccion.map((p) => [`${esc(p.productoNombre)}<br><span style="font-size:12px;color:${C.suave}">${sector(p.sector)}</span>`, miles(p.cocinado), miles(p.guardado)]))
    : nada('No se cargó producción en el período.'))

  partes.push(titulo('Envíos por sucursal'))
  const porSucursal = new Map<string, { nombre: string; total: number; detalle: string[] }>()
  for (const e of r.envios) {
    const s = porSucursal.get(e.sucursalId) ?? { nombre: e.sucursalNombre, total: 0, detalle: [] }
    s.total += e.cantidad
    s.detalle.push(`${esc(e.productoNombre)}: ${miles(e.cantidad)}`)
    porSucursal.set(e.sucursalId, s)
  }
  partes.push(porSucursal.size
    ? tabla([['Sucursal', 'left'], ['Unidades', 'right']],
      [...porSucursal.values()].map((s) => [`${esc(s.nombre)}<br><span style="font-size:12px;color:${C.suave}">${s.detalle.join(' · ')}</span>`, miles(s.total)]))
    : nada('No hubo envíos en el período.'))

  if (r.lotesChipa.length) {
    const max = 15
    partes.push(titulo('Lotes de Chipería'))
    partes.push(tabla([['Lote', 'left'], ['Horno', 'right'], ['Congelador', 'right'], ['Queda', 'right']],
      r.lotesChipa.slice(0, max).map((l) => [esc(l.codigo), miles(l.horno), miles(l.congelador), miles(l.stock)])))
    if (r.lotesChipa.length > max) partes.push(nada(`Y ${r.lotesChipa.length - max} lotes más en el reporte completo.`))
  }

  const salidas = r.salidas.filter((s) => s.tipo === 'merma' || s.tipo === 'vencimiento')
  if (salidas.length) {
    partes.push(titulo('Mermas y vencimientos'))
    partes.push(tabla([['Sector', 'left'], ['Tipo', 'left'], ['Unidades', 'right']],
      salidas.map((s) => [sector(s.sector), esc(NOMBRE_TIPO_MOVIMIENTO[s.tipo]), miles(s.cantidad)])))
  }

  partes.push(titulo('Limpiezas'))
  partes.push(r.limpiezas.length
    ? tabla([['Área', 'left'], ['Reportes', 'right'], ['Sin controlar', 'right'], ['Tareas sin hacer', 'right']],
      r.limpiezas.map((l) => [`${esc(l.areaNombre)}<br><span style="font-size:12px;color:${C.suave}">${sector(l.sector)}</span>`,
        miles(l.cantidad), miles(l.sinControlar), miles(l.tareasNoHechas)]))
    : nada('No se reportaron limpiezas en el período.'))

  const boton = enlace
    ? `<p style="margin:24px 0 8px;text-align:center"><a href="${esc(enlace)}" style="display:inline-block;background:${C.marca};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Ver el reporte completo</a></p>
<p style="margin:0 0 8px;text-align:center;font-size:12px;color:${C.suave}">Si el botón no abre, copiá esta dirección: ${esc(enlace)}</p>`
    : nada('Para que el correo traiga el enlace al reporte completo, cargá la dirección pública en Datos → Configuración.')

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(asuntoResumen(o.periodo, r))}</title></head>
<body style="margin:0;padding:0;background:${C.fondo};font-family:Arial,Helvetica,sans-serif;color:${C.texto}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo}"><tr><td align="center" style="padding:12px 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid ${C.borde};border-radius:12px">
<tr><td style="background:${C.marca};color:#ffffff;padding:16px 14px;border-radius:12px 12px 0 0">
<div style="font-size:20px;font-weight:700">Chipa Tía</div>
<div style="font-size:14px">${o.periodo === 'hoy'
    ? `Resumen parcial de hoy · ${esc(textoPeriodo('hoy', r.desde, r.hasta))} · lo cargado hasta las ${horaDeCorte(r)}`
    : `Resumen ${NOMBRE_PERIODO[o.periodo]} · ${esc(textoPeriodo(o.periodo, r.desde, r.hasta))}`}</div>
</td></tr>
<tr><td style="padding:16px 12px">
<p style="margin:0 0 12px;font-size:13px;color:${C.suave}">Todos los sectores · fechas y horas de Paraguay</p>
${partes.join('\n')}
${boton}
<p style="margin:20px 0 0;font-size:12px;color:${C.suave}">Generado el ${esc(fechaHoraPY(r.generadoEn))} (hora de Paraguay) por el sistema de producción de Chipa Tía.</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

// ---------- Armado y envío ----------

/** Arma el resumen del período que corresponde a `hoy` (día de Paraguay), sin enviarlo. 'hoy' cubre solo el día de hoy, hasta ahora. */
export async function prepararResumen(env: Env, periodo: PeriodoResumen, hoy: string) {
  const { desde, hasta } = periodo === 'hoy' ? { desde: hoy, hasta: hoy } : rangoResumen(periodo, hoy)
  const [config, reporte, sectores] = await Promise.all([
    leerConfiguracion(env.DB),
    armarReporte(env.DB, { desde, hasta, sector: null }),
    todas<{ id: string; nombre: string }>(env.DB, 'SELECT id, nombre FROM sectores ORDER BY orden'),
  ])
  const enlace = enlaceReporte(config.urlPublica, desde, hasta)
  return {
    destino: config.correoReportes,
    asunto: asuntoResumen(periodo, reporte),
    html: htmlResumen({ periodo, reporte, sectores: Object.fromEntries(sectores.map((s) => [s.id, s.nombre])), enlace }),
    enlace,
    reporte,
  }
}

/** Arma y envía el resumen. Nunca lanza por un problema de envío: lo devuelve en `motivo`. */
export async function enviarResumen(env: Env, periodo: PeriodoResumen, hoy: string): Promise<ResumenCorreo> {
  const r = await prepararResumen(env, periodo, hoy)
  const base = { destino: r.destino, asunto: r.asunto, html: r.html }
  const motivo = env.MODO_DEMO
    ? 'Es la demo: no se envían correos. Así se vería el resumen.'
    : !r.destino
      ? 'Falta el correo que recibe los resúmenes: cargalo en Datos → Configuración.'
      : !env.RESEND_API_KEY
        ? 'Falta la clave de Resend (RESEND_API_KEY) en Cloudflare. Ver docs/despliegue.md.'
        : !env.CORREO_REMITENTE
          ? 'Falta el remitente de los correos (CORREO_REMITENTE en wrangler.jsonc).'
          : null
  if (motivo) return { enviado: false, ...base, motivo }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.CORREO_REMITENTE,
        to: r.destino.split(/\s*,\s*/).filter(Boolean),
        subject: r.asunto,
        html: r.html,
      }),
    })
    if (!res.ok) {
      const datos = (await res.json().catch(() => null)) as { message?: string } | null
      return { enviado: false, ...base, motivo: `Resend no aceptó el correo (${res.status}${datos?.message ? `: ${datos.message}` : ''}).` }
    }
    return { enviado: true, ...base }
  } catch {
    return { enviado: false, ...base, motivo: 'No se pudo conectar con Resend. Probá de nuevo en un rato.' }
  }
}
