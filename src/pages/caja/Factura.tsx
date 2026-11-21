// M12: factura preimpresa de Chipa Tía (hoja A4 con original arriba y duplicado abajo). Imprime solo los datos
// variables (fecha, cliente, detalle e importes) sobre la hoja de la imprenta, en las posiciones del formato (milímetros).
// El número y el timbrado ya vienen impresos: el sistema lleva la misma numeración y avisa qué hoja poner antes de imprimir.
// El formato se calibra en Caja → Factura: márgenes que corren todo junto y la posición de cada dato, con una hoja de prueba.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { put } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import Modal from '../../components/Modal'
import { enLetras, miles } from '../../shared/dinero'
import { columnasIva, fechaFactura, renglonesFactura } from '../../shared/factura'
import type { ConfigFactura, Iva, PosicionFactura, Venta } from '../../shared/tipos'

// ---------- Hoja impresa ----------

/** Ancho aproximado de un texto en mm (Arial: ~0,5 em por letra), para achicar la letra si no entra. */
const anchoTexto = (t: string, pt: number) => t.length * pt * 0.3528 * 0.5

/** Una copia (original o duplicado): cada dato en su lugar (mm), corrido por los márgenes y por `corrida`. */
function Copia({ venta, config, corrida }: { venta: Venta; config: ConfigFactura; corrida: PosicionFactura }) {
  const { neto, iva5, iva10, totalIva } = columnasIva(venta)
  const dx = config.margenIzquierdo + corrida.x
  const dy = config.margenSuperior + corrida.y
  const en = (p: PosicionFactura, hijo: ReactNode, alinear: 'left' | 'right' = 'left', extra: CSSProperties = {}) => (
    <div style={{
      position: 'absolute', top: `${p.y + dy}mm`, whiteSpace: 'nowrap', ...extra,
      ...(alinear === 'right' ? { right: `${config.anchoHoja - p.x - dx}mm` } : { left: `${p.x + dx}mm` }),
    }}>{hijo}</div>
  )
  const columna = (iva: Iva) => (iva === 0 ? config.columnaExentas : iva === 5 ? config.columna5 : config.columna10)
  const fila = (i: number) => config.detalle.y + i * config.altoRenglon
  const recorte = (ancho: number): CSSProperties => ({ maxWidth: `${Math.max(5, ancho)}mm`, overflow: 'hidden', textOverflow: 'ellipsis' })
  const letras = enLetras(venta.total)
  const totalLetras = letras.charAt(0).toUpperCase() + letras.slice(1)
  const lugarLetras = config.total.x - 28 - config.totalLetras.x
  const anchoLetras = anchoTexto(totalLetras, config.tamanoLetra)
  return (
    <>
      {en(config.fecha, fechaFactura(venta.dia))}
      {en(config.contado, 'X', 'left', { fontWeight: 700 })}
      {en(config.cliente, venta.clienteNombre || 'Sin nombre', 'left', recorte(config.ruc.x - 30 - config.cliente.x))}
      {en(config.ruc, venta.clienteRuc || 'X')}
      {venta.clienteDireccion && en(config.direccion, venta.clienteDireccion, 'left', recorte(84))}
      {renglonesFactura(venta, config.maxRenglones, miles).map((r, n) => (
        <div key={n}>
          {r.codigo && en({ x: config.columnaCodigo, y: fila(n) }, r.codigo, 'left', recorte(config.columnaCantidad - 12.5 - config.columnaCodigo))}
          {en({ x: config.columnaCantidad, y: fila(n) }, r.cantidad, 'right')}
          {en({ x: config.columnaDescripcion, y: fila(n) }, r.descripcion, 'left', recorte(config.columnaPrecio - 19 - config.columnaDescripcion))}
          {en({ x: config.columnaPrecio, y: fila(n) }, r.precio, 'right')}
          {en({ x: columna(r.iva), y: fila(n) }, r.importe < 0 ? `-${miles(-r.importe)}` : miles(r.importe), 'right')}
        </div>
      ))}
      {([0, 5, 10] as Iva[]).map((iva) => (
        <div key={iva}>{en({ x: columna(iva), y: config.subtotales.y }, neto[iva] ? miles(neto[iva]) : '', 'right')}</div>
      ))}
      {en(config.total, miles(venta.total), 'right', { fontWeight: 700 })}
      {en(config.totalLetras, totalLetras, 'left', anchoLetras > lugarLetras ? { fontSize: `${(config.tamanoLetra * lugarLetras) / anchoLetras}pt` } : {})}
      {en(config.iva5, miles(iva5))}
      {en(config.iva10, miles(iva10))}
      {en(config.totalIva, miles(totalIva))}
    </>
  )
}

/** La hoja entera: original arriba y duplicado corrido `config.duplicado`. */
export function HojaFactura({ venta, config, fondo = false }: { venta: Venta; config: ConfigFactura; fondo?: boolean }) {
  return (
    <div className={`hoja-factura${fondo ? ' con-fondo' : ''}`} style={{ width: `${config.anchoHoja}mm`, height: `${config.altoHoja}mm`, fontSize: `${config.tamanoLetra}pt` }}>
      <Copia venta={venta} config={config} corrida={{ x: 0, y: 0 }} />
      <Copia venta={venta} config={config} corrida={config.duplicado} />
    </div>
  )
}

/** Pone la hoja en la página solo para imprimir (fuera de la app) y abre el diálogo de impresión. */
function Imprimir({ venta, config, alTerminar }: { venta: Venta; config: ConfigFactura; alTerminar: () => void }) {
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

/**
 * Imprime la factura. Si la venta ya tiene número, primero dice qué hoja del talonario poner en la impresora, porque el
 * número viene impreso en la hoja y tiene que ser el mismo que el del sistema. La hoja de prueba se imprime directo.
 */
export function ImprimirFactura({ venta, config, alTerminar }: { venta: Venta; config: ConfigFactura; alTerminar: () => void }) {
  const [listo, setListo] = useState(!venta.factura)
  if (listo) return <Imprimir venta={venta} config={config} alTerminar={alTerminar} />
  const f = venta.factura!
  const reimpresion = f.impresiones > 1
  return (
    <Modal titulo={`Poné la hoja Nº ${f.numeroCompleto}`} alCerrar={alTerminar}>
      <div className="aviso-hoja">
        <p>
          Poné en la impresora la hoja de factura <strong>Nº {f.numeroCompleto}</strong>
          {f.timbrado && <> (timbrado {f.timbrado})</>}, con el original arriba. El número está impreso en rojo, arriba a la derecha.
        </p>
        {reimpresion
          ? <Aviso>Esta factura ya se imprimió. Volvé a imprimirla solo si esa hoja quedó en blanco (por ejemplo, se trabó el papel). Si la hoja se arruinó, guardala anulada y avisale al administrador.</Aviso>
          : <p className="suave">Si la hoja que sigue en el talonario tiene otro número, no imprimas y avisale al administrador: el número se corrige en Caja → Factura.</p>}
        <div className="fila-acciones">
          <button type="button" className="btn-primario" autoFocus onClick={() => setListo(true)}>Imprimir</button>
          <button type="button" className="btn-secundario" onClick={alTerminar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- Formato y calibración (administrador) ----------

const VENTA_PRUEBA: Venta = {
  id: 'prueba', numero: 0, cajaId: '', clienteNombre: 'Cliente de prueba S.A.', clienteRuc: '80000000-1', clienteDireccion: 'Ruta 1 km 300, Coronel Bogado',
  subtotal: 64_000, descuento: 4000, total: 60_000, medio: 'efectivo', recibido: null, vuelto: null, usuarioNombre: '', fecha: new Date().toISOString(),
  dia: new Date().toISOString().slice(0, 10), anulada: false, anuladaEn: null, motivoAnulacion: null, factura: null,
  items: [
    { productoId: 'a', codigo: 'CH01', nombre: 'Chipa tradicional', cantidad: 10, precioUnitario: 3000, subtotal: 30_000, iva: 10 },
    { productoId: 'b', codigo: 'CO02', nombre: 'Cocido con leche', cantidad: 2, precioUnitario: 5000, subtotal: 10_000, iva: 5 },
    { productoId: 'c', codigo: 'GA05', nombre: 'Gaseosa 500 ml', cantidad: 3, precioUnitario: 8000, subtotal: 24_000, iva: 10 },
  ],
}

type CampoNum = { [K in keyof ConfigFactura]: ConfigFactura[K] extends number ? K : never }[keyof ConfigFactura]
type CampoPos = { [K in keyof ConfigFactura]: ConfigFactura[K] extends PosicionFactura ? K : never }[keyof ConfigFactura]

const NUMEROS: [CampoNum, string][] = [
  ['anchoHoja', 'Ancho de la hoja (mm)'], ['altoHoja', 'Alto de la hoja (mm)'],
  ['tamanoLetra', 'Tamaño de letra (pt)'], ['altoRenglon', 'Alto de cada renglón (mm)'], ['maxRenglones', 'Renglones del detalle'],
  ['columnaCodigo', 'Columna COD: inicio (mm)'], ['columnaCantidad', 'Columna CANT.: borde derecho (mm)'],
  ['columnaDescripcion', 'Columna DESCRIPCIÓN: inicio (mm)'], ['columnaPrecio', 'Columna PRECIO UNITARIO: borde derecho (mm)'],
  ['columnaExentas', 'Columna EXENTAS: borde derecho (mm)'], ['columna5', 'Columna 5 %: borde derecho (mm)'], ['columna10', 'Columna 10 %: borde derecho (mm)'],
]
const POSICIONES: [CampoPos, string][] = [
  ['fecha', 'Fecha de emisión'], ['contado', 'X de «Contado»'], ['cliente', 'Señor(es)'], ['ruc', 'C.I. o RUC'], ['direccion', 'Dirección'],
  ['detalle', 'Primer renglón del detalle (solo cuenta y)'], ['subtotales', 'Valor parcial (solo cuenta y)'],
  ['total', 'Total a pagar (x = borde derecho)'], ['totalLetras', 'Total en letras'],
  ['iva5', 'Liquidación del IVA 5 %'], ['iva10', 'Liquidación del IVA 10 %'], ['totalIva', 'Total IVA'],
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
  const [fondo, setFondo] = useState(true)
  const proxima = useConsulta<{ numero: number; numeroCompleto: string }>('/factura/proxima')
  const guardar = useAccion(() => put<ConfigFactura>('/factura/config', d))
  const cambiar = (x: Partial<ConfigFactura>) => { setOk(false); setD({ ...d, ...x }) }
  const num = (k: CampoNum, etiqueta: string) => (
    <label key={k} className="campo">
      <span>{etiqueta}</span>
      <input inputMode="decimal" value={String(d[k])} onChange={(e) => cambiar({ [k]: aNumero(e.target.value) || 0 })} />
    </label>
  )
  const par = (k: CampoPos, etiqueta: string, ejes: [string, string] = ['x', 'y']) => (
    <div key={k} className="campo">
      <span>{etiqueta}</span>
      <div className="par-mm">
        <input aria-label={`${etiqueta}: ${ejes[0]}`} placeholder={ejes[0]} inputMode="decimal" value={String(d[k].x)} onChange={(e) => cambiar({ [k]: { ...d[k], x: aNumero(e.target.value) || 0 } })} />
        <input aria-label={`${etiqueta}: ${ejes[1]}`} placeholder={ejes[1]} inputMode="decimal" value={String(d[k].y)} onChange={(e) => cambiar({ [k]: { ...d[k], y: aNumero(e.target.value) || 0 } })} />
      </div>
    </div>
  )
  return (
    <>
      <p className="suave">
        La factura sale sobre la hoja preimpresa de la imprenta (A4, original arriba y duplicado abajo): el sistema
        imprime solo la fecha, el cliente, el detalle y los importes. Para calibrar, imprimí una hoja de prueba en una hoja
        A4 común (al imprimir: papel A4, márgenes «Ninguno» y escala 100 %), ponela encima de una factura en blanco y miralas a contraluz. Si todo sale 3 mm más arriba, poné 3 en
        «Correr todo hacia abajo»; si sale 2 mm a la derecha, poné -2 en «Correr todo a la derecha». Guardá y probá de nuevo.
      </p>

      <h2>Numeración</h2>
      <div className="tarjeta filtros">
        <label className="campo"><span>Timbrado</span><input value={d.timbrado} maxLength={20} onChange={(e) => cambiar({ timbrado: e.target.value })} /></label>
        <label className="campo"><span>Fin de vigencia del timbrado</span><input type="date" value={d.venceTimbrado} onChange={(e) => cambiar({ venceTimbrado: e.target.value })} /></label>
        <label className="campo"><span>Establecimiento y punto (001-002)</span><input value={d.prefijo} maxLength={7} onChange={(e) => cambiar({ prefijo: e.target.value })} /></label>
        <label className="campo">
          <span>Número de la próxima factura (si es más alto que el último)</span>
          <input inputMode="numeric" value={String(d.numeroInicial)} onChange={(e) => cambiar({ numeroInicial: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </label>
        <label className="campo">
          <span>Último número del talonario (0 = sin límite)</span>
          <input inputMode="numeric" value={String(d.numeroFinal)} onChange={(e) => cambiar({ numeroFinal: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </label>
      </div>
      {proxima.datos && (
        <p className="chico">
          La próxima factura del sistema es la <strong>Nº {proxima.datos.numeroCompleto}</strong>. Tiene que ser la misma hoja que
          sigue en el talonario; si no, cambiá «Número de la próxima factura» y guardá.
          {d.numeroFinal > 0 && proxima.datos.numero <= d.numeroFinal && <> Quedan {d.numeroFinal - proxima.datos.numero + 1} hojas.</>}
        </p>
      )}

      <h2>Calibrar con la impresora</h2>
      <div className="tarjeta filtros">
        {num('margenIzquierdo', 'Correr todo a la derecha (mm)')}
        {num('margenSuperior', 'Correr todo hacia abajo (mm)')}
        {par('duplicado', 'Duplicado: dónde empieza respecto del original (mm)', ['a la derecha', 'hacia abajo'])}
      </div>

      <details className="tarjeta">
        <summary>Medidas de la hoja y posición de cada dato</summary>
        <p className="suave chico">En milímetros, desde la esquina de arriba a la izquierda de la hoja (x hacia la derecha, y hacia abajo). Solo hace falta tocarlas si un dato puntual cae mal.</p>
        <div className="filtros">{NUMEROS.map(([k, t]) => num(k, t))}</div>
        <div className="filtros">{POSICIONES.map(([k, t]) => par(k, t))}</div>
      </details>

      <Aviso>{guardar.error}</Aviso>
      {ok && <Aviso tipo="ok">Formato guardado.</Aviso>}
      <div className="fila-acciones">
        <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void guardar.ejecutar().then((r) => { if (r) { setOk(true); proxima.recargar() } })}>Guardar formato</button>
        <button type="button" className="btn-secundario" onClick={() => setPrueba(true)}>Imprimir hoja de prueba</button>
      </div>
      <h2>Vista previa</h2>
      <label className="check">
        <input type="checkbox" checked={fondo} onChange={(e) => setFondo(e.target.checked)} />
        <span>Verla sobre el dibujo de la hoja (sacado de la foto, enderezado y a tamaño A4)</span>
      </label>
      <div className="vista-factura"><HojaFactura venta={VENTA_PRUEBA} config={d} fondo={fondo} /></div>
      {prueba && <ImprimirFactura venta={VENTA_PRUEBA} config={d} alTerminar={() => setPrueba(false)} />}
    </>
  )
}
