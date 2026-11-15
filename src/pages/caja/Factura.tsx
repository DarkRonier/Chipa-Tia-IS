// M12: factura preimpresa. Imprime solo los datos variables (fecha, cliente, detalle e importes) sobre la hoja de la
// imprenta, en las posiciones del formato (milímetros). El formato se calibra acá: márgenes que corren todo junto y la
// posición de cada dato, con una hoja de prueba.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { put } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { enLetras, miles } from '../../shared/dinero'
import { diaLegible } from '../../shared/hora'
import type { ConfigFactura, Iva, PosicionFactura, Venta } from '../../shared/tipos'

// ---------- Hoja impresa ----------

/** Reparte el descuento entre las columnas de IVA en proporción, para que los subtotales sumen el total. */
function columnas(v: Venta) {
  const bruto: Record<Iva, number> = { 0: 0, 5: 0, 10: 0 }
  for (const i of v.items) bruto[i.iva] += i.subtotal
  const desc: Record<Iva, number> = { 0: 0, 5: 0, 10: 0 }
  if (v.descuento > 0 && v.subtotal > 0) {
    let repartido = 0
    for (const iva of [0, 5] as Iva[]) {
      desc[iva] = Math.round((v.descuento * bruto[iva]) / v.subtotal)
      repartido += desc[iva]
    }
    desc[10] = v.descuento - repartido
  }
  const neto = { 0: bruto[0] - desc[0], 5: bruto[5] - desc[5], 10: bruto[10] - desc[10] } as Record<Iva, number>
  return { desc, neto }
}

/** La factura sobre la hoja: cada dato en su lugar (mm), corrido por los márgenes. */
export function HojaFactura({ venta, config }: { venta: Venta; config: ConfigFactura }) {
  const { desc, neto } = columnas(venta)
  const en = (p: PosicionFactura, hijo: ReactNode, alinear: 'left' | 'right' = 'left', extra: CSSProperties = {}) => (
    <div style={{
      position: 'absolute', top: `${p.y + config.margenSuperior}mm`, whiteSpace: 'nowrap', ...extra,
      ...(alinear === 'right' ? { right: `${config.anchoHoja - p.x - config.margenIzquierdo}mm` } : { left: `${p.x + config.margenIzquierdo}mm` }),
    }}>{hijo}</div>
  )
  const columna = (iva: Iva) => (iva === 0 ? config.columnaExentas : iva === 5 ? config.columna5 : config.columna10)
  const renglones = venta.items.slice(0, config.maxRenglones)
  const fila = (i: number) => config.detalle.y + i * config.altoRenglon
  const iva5 = Math.round(neto[5] / 21)
  const iva10 = Math.round(neto[10] / 11)
  return (
    <div className="hoja-factura" style={{ width: `${config.anchoHoja}mm`, height: `${config.altoHoja}mm`, fontSize: `${config.tamanoLetra}pt` }}>
      {en(config.fecha, diaLegible(venta.dia))}
      {en(config.cliente, venta.clienteNombre || 'Sin nombre')}
      {en(config.ruc, venta.clienteRuc || 'X')}
      {renglones.map((i, n) => (
        <div key={i.productoId}>
          {en({ x: config.columnaCantidad, y: fila(n) }, i.cantidad, 'right')}
          {en({ x: config.columnaDescripcion, y: fila(n) }, i.nombre)}
          {en({ x: config.columnaPrecio, y: fila(n) }, miles(i.precioUnitario), 'right')}
          {en({ x: columna(i.iva), y: fila(n) }, miles(i.subtotal), 'right')}
        </div>
      ))}
      {venta.descuento > 0 && (
        <>
          {en({ x: config.columnaDescripcion, y: fila(renglones.length) }, 'Descuento')}
          {([0, 5, 10] as Iva[]).filter((iva) => desc[iva]).map((iva) => (
            <div key={iva}>{en({ x: columna(iva), y: fila(renglones.length) }, `-${miles(desc[iva])}`, 'right')}</div>
          ))}
        </>
      )}
      {([0, 5, 10] as Iva[]).map((iva) => (
        <div key={iva}>{en({ x: columna(iva), y: config.subtotales.y }, neto[iva] ? miles(neto[iva]) : '', 'right')}</div>
      ))}
      {en(config.total, miles(venta.total), 'right')}
      {en(config.totalLetras, `Guaraníes ${enLetras(venta.total)}`, 'left', { textTransform: 'capitalize' })}
      {en(config.liquidacionIva, `(5 %) ${miles(iva5)}    (10 %) ${miles(iva10)}    Total IVA ${miles(iva5 + iva10)}`)}
    </div>
  )
}

/**
 * Pone la hoja en la página solo para imprimir (fuera de la app) y abre el diálogo de impresión. Durante la impresión
 * la hoja manda: tamaño de página = tamaño de la hoja, sin márgenes.
 */
export function ImprimirFactura({ venta, config, alTerminar }: { venta: Venta; config: ConfigFactura; alTerminar: () => void }) {
  useEffect(() => {
    const estilo = document.createElement('style')
    estilo.textContent = `@page { size: ${config.anchoHoja}mm ${config.altoHoja}mm; margin: 0; }`
    document.head.appendChild(estilo)
    document.body.classList.add('con-factura')
    const fin = () => alTerminar()
    window.addEventListener('afterprint', fin)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', fin)
      document.body.classList.remove('con-factura')
      estilo.remove()
    }
  }, [config, alTerminar])
  return createPortal(<div className="factura-portal"><HojaFactura venta={venta} config={config} /></div>, document.body)
}

// ---------- Formato y calibración (administrador) ----------

const VENTA_PRUEBA: Venta = {
  id: 'prueba', numero: 0, cajaId: '', clienteNombre: 'Cliente de prueba S.A.', clienteRuc: '80000000-1', subtotal: 64_000, descuento: 4000,
  total: 60_000, medio: 'efectivo', recibido: null, vuelto: null, usuarioNombre: '', fecha: new Date().toISOString(),
  dia: new Date().toISOString().slice(0, 10), anulada: false, anuladaEn: null, motivoAnulacion: null, factura: null,
  items: [
    { productoId: 'a', nombre: 'Chipa tradicional', cantidad: 10, precioUnitario: 3000, subtotal: 30_000, iva: 10 },
    { productoId: 'b', nombre: 'Cocido con leche', cantidad: 2, precioUnitario: 5000, subtotal: 10_000, iva: 5 },
    { productoId: 'c', nombre: 'Gaseosa 500 ml', cantidad: 3, precioUnitario: 8000, subtotal: 24_000, iva: 10 },
  ],
}

type CampoNum = { [K in keyof ConfigFactura]: ConfigFactura[K] extends number ? K : never }[keyof ConfigFactura]
type CampoPos = { [K in keyof ConfigFactura]: ConfigFactura[K] extends PosicionFactura ? K : never }[keyof ConfigFactura]

const NUMEROS: [CampoNum, string][] = [
  ['anchoHoja', 'Ancho de la hoja (mm)'], ['altoHoja', 'Alto de la hoja (mm)'],
  ['margenIzquierdo', 'Correr todo a la derecha (mm)'], ['margenSuperior', 'Correr todo hacia abajo (mm)'],
  ['tamanoLetra', 'Tamaño de letra (pt)'], ['altoRenglon', 'Alto de cada renglón (mm)'], ['maxRenglones', 'Renglones de la hoja'],
  ['columnaCantidad', 'Columna cantidad: borde derecho (mm)'], ['columnaDescripcion', 'Columna descripción: inicio (mm)'],
  ['columnaPrecio', 'Columna precio: borde derecho (mm)'], ['columnaExentas', 'Columna exentas: borde derecho (mm)'],
  ['columna5', 'Columna 5 %: borde derecho (mm)'], ['columna10', 'Columna 10 %: borde derecho (mm)'],
]
const POSICIONES: [CampoPos, string][] = [
  ['fecha', 'Fecha'], ['cliente', 'Nombre o razón social'], ['ruc', 'RUC o CI'], ['detalle', 'Primer renglón del detalle (solo cuenta y)'],
  ['subtotales', 'Fila de subtotales (solo cuenta y)'], ['total', 'Total (x = borde derecho)'], ['totalLetras', 'Total en letras'],
  ['liquidacionIva', 'Liquidación del IVA'],
]

const aNumero = (s: string) => Number(s.replace(',', '.'))

export function ConfigurarFactura() {
  const c = useConsulta<ConfigFactura>('/factura/config')
  return <ConDatos consulta={c}>{(config) => <FormFactura inicial={config} />}</ConDatos>
}

function FormFactura({ inicial }: { inicial: ConfigFactura }) {
  const [d, setD] = useState(inicial)
  const [ok, setOk] = useState(false)
  const [prueba, setPrueba] = useState(false)
  const guardar = useAccion(() => put<ConfigFactura>('/factura/config', d))
  const num = (k: CampoNum) => (
    <input inputMode="decimal" value={String(d[k])} onChange={(e) => { setOk(false); setD({ ...d, [k]: aNumero(e.target.value) || 0 }) }} />
  )
  return (
    <>
      <p className="suave">
        La factura sale sobre la hoja preimpresa de la imprenta: el sistema imprime solo la fecha, el cliente, el detalle y los
        importes. Imprimí una hoja de prueba sobre una factura anulada (o una hoja común encima, a contraluz) y corré los
        datos hasta que caigan en su lugar. Por ejemplo, si todo sale 3 mm más arriba, poné 3 en «Correr todo hacia abajo».
      </p>
      <div className="tarjeta filtros">
        <label className="campo"><span>Timbrado</span><input value={d.timbrado} maxLength={20} onChange={(e) => setD({ ...d, timbrado: e.target.value })} /></label>
        <label className="campo"><span>Establecimiento y punto (001-001)</span><input value={d.prefijo} maxLength={7} onChange={(e) => setD({ ...d, prefijo: e.target.value })} /></label>
        <label className="campo">
          <span>Número de la próxima factura (si es más alto que el último)</span>
          <input inputMode="numeric" value={String(d.numeroInicial)} onChange={(e) => setD({ ...d, numeroInicial: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </label>
      </div>
      <h2>Hoja y columnas</h2>
      <div className="tarjeta filtros">
        {NUMEROS.map(([k, t]) => <label key={k} className="campo"><span>{t}</span>{num(k)}</label>)}
      </div>
      <h2>Posición de cada dato (mm desde arriba a la izquierda)</h2>
      <div className="tarjeta filtros">
        {POSICIONES.map(([k, t]) => (
          <div key={k} className="campo">
            <span>{t}</span>
            <div className="par-mm">
              <input aria-label={`${t} x`} inputMode="decimal" value={String(d[k].x)} onChange={(e) => setD({ ...d, [k]: { ...d[k], x: aNumero(e.target.value) || 0 } })} />
              <input aria-label={`${t} y`} inputMode="decimal" value={String(d[k].y)} onChange={(e) => setD({ ...d, [k]: { ...d[k], y: aNumero(e.target.value) || 0 } })} />
            </div>
          </div>
        ))}
      </div>
      <Aviso>{guardar.error}</Aviso>
      {ok && <Aviso tipo="ok">Formato guardado.</Aviso>}
      <div className="fila-acciones">
        <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void guardar.ejecutar().then((r) => r && setOk(true))}>Guardar formato</button>
        <button type="button" className="btn-secundario" onClick={() => setPrueba(true)}>Imprimir hoja de prueba</button>
      </div>
      <h2>Vista previa</h2>
      <div className="vista-factura"><HojaFactura venta={VENTA_PRUEBA} config={d} /></div>
      {prueba && <ImprimirFactura venta={VENTA_PRUEBA} config={d} alTerminar={() => setPrueba(false)} />}
    </>
  )
}
