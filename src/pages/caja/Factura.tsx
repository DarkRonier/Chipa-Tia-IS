// M12: factura preimpresa (tres talonarios: Chipa Tía frente, Comedor y ChipaSticks; hoja oficio 216 × 330 mm con original arriba y duplicado abajo). Imprime solo los datos
// variables (fecha, cliente, detalle e importes) sobre la hoja de la imprenta, en las posiciones del formato (milímetros).
// El número y el timbrado ya vienen impresos: el sistema lleva la misma numeración y avisa qué hoja poner antes de imprimir.
// El formato se calibra en Caja → Factura: márgenes que corren todo junto y la posición de cada dato, con una hoja de prueba.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { post, put } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import Modal from '../../components/Modal'
import { enLetras, miles } from '../../shared/dinero'
import { columnasIva, fechaFactura, renglonesFactura } from '../../shared/factura'
import {
  NOMBRE_TALONARIO, NOMBRE_USO_FACTURA, TALONARIOS, USOS_FACTURA,
  type ConfigFactura, type Iva, type PosicionFactura, type TalonarioId, type UsosFactura, type Venta,
} from '../../shared/tipos'
import '../../styles/compras.css'

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
export function HojaFactura({ venta, config, fondo = false, regla = false }: { venta: Venta; config: ConfigFactura; fondo?: boolean; regla?: boolean }) {
  return (
    <div className={`hoja-factura${fondo ? ' con-fondo' : ''}`} style={{ width: `${config.anchoHoja}mm`, height: `${config.altoHoja}mm`, fontSize: `${config.tamanoLetra}pt` }}>
      <Copia venta={venta} config={config} corrida={{ x: 0, y: 0 }} />
      <Copia venta={venta} config={config} corrida={config.duplicado} />
      {regla && <Regla config={config} />}
    </div>
  )
}

/**
 * Solo en la hoja de prueba: una regla de 10 cm al pie. Si al medirla da menos (9 cm con papel A4), el navegador achicó
 * la hoja porque en la ventana de impresión quedó otro tamaño de papel, y los datos van a salir corridos.
 */
function Regla({ config }: { config: ConfigFactura }) {
  return (
    <div className="regla-factura" style={{ left: '20mm', top: `${config.altoHoja - 14}mm` }}>
      <div className="regla-linea" style={{ width: '100mm' }}>
        {Array.from({ length: 11 }, (_, i) => <span key={i} style={{ left: `${i * 10}mm` }} />)}
      </div>
      <p>Esta línea mide 10 cm. Si mide menos, en la ventana de impresión quedó otro papel (A4 o Carta): elegí Oficio y 100 %.</p>
    </div>
  )
}

/** Pone la hoja en la página solo para imprimir (fuera de la app) y abre el diálogo de impresión. */
function Imprimir({ venta, config, alTerminar, regla = false }: { venta: Venta; config: ConfigFactura; alTerminar: () => void; regla?: boolean }) {
  // alTerminar cambia en cada dibujo de la pantalla de atrás: si fuera dependencia del efecto, el diálogo se abriría dos veces.
  const terminar = useRef(alTerminar)
  terminar.current = alTerminar
  useEffect(() => {
    const estilo = document.createElement('style')
    estilo.textContent = `@page { size: ${config.anchoHoja}mm ${config.altoHoja}mm; margin: 0; }`
    document.head.appendChild(estilo)
    document.body.classList.add('con-factura')
    const fin = () => terminar.current()
    window.addEventListener('afterprint', fin)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', fin)
      document.body.classList.remove('con-factura')
      estilo.remove()
    }
  }, [config])
  return createPortal(<div className="factura-portal"><HojaFactura venta={venta} config={config} regla={regla} /></div>, document.body)
}

/**
 * Imprime la factura. Si la venta ya tiene número, primero dice qué hoja del talonario poner en la impresora, porque el
 * número viene impreso en la hoja y tiene que ser el mismo que el del sistema. La hoja de prueba se imprime directo.
 */
export function ImprimirFactura({ venta, config, alTerminar }: { venta: Venta; config: ConfigFactura; alTerminar: () => void }) {
  const [listo, setListo] = useState(!venta.factura)
  if (listo) return <Imprimir venta={venta} config={config} alTerminar={alTerminar} regla={!venta.factura} />
  const f = venta.factura!
  const reimpresion = f.impresiones > 1
  return (
    <Modal titulo={`Poné la hoja Nº ${f.numeroCompleto}`} alCerrar={alTerminar}>
      <div className="aviso-hoja">
        <p>
          Poné en la impresora la hoja de factura <strong>{NOMBRE_TALONARIO[f.talonario]}</strong> <strong>Nº {f.numeroCompleto}</strong>
          {f.timbrado && <> (timbrado {f.timbrado})</>}, con el original arriba. El número está impreso en rojo, arriba a la derecha.
        </p>
        <p className="papel-oficio">
          En la ventana de impresión, <strong>Tamaño del papel: Oficio</strong> (u 8,5 × 13; si no está, Legal) y escala 100.
          Con A4 o Carta todo sale achicado y los datos caen fuera de su lugar.
        </p>
        {reimpresion
          ? <Aviso>Esta factura ya se imprimió. Volvé a imprimirla solo si esa hoja quedó en blanco (por ejemplo, se trabó el papel). Si la hoja se arruinó, guardala anulada y avisale al administrador.</Aviso>
          : <p className="suave">Si la hoja que sigue en el talonario tiene otro número, no imprimas y avisale al administrador: el número se corrige en Caja → Factura.</p>}
        <ConsejoImpresora />
        <div className="fila-acciones">
          <button type="button" className="btn-primario" autoFocus onClick={() => setListo(true)}>Imprimir</button>
          <button type="button" className="btn-secundario" onClick={alTerminar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Lo que más traba al imprimir: el navegador recuerda el último destino, y como los reportes se bajan con «Guardar como
 * PDF», la impresora no aparece. Se elige una vez y queda.
 */
function ConsejoImpresora() {
  return (
    <details className="consejo-impresora">
      <summary>¿No aparece la impresora?</summary>
      <ol>
        <li>En la ventana de impresión, abrí la lista <strong>Destino</strong> (o <strong>Impresora</strong>) y elegí la impresora. Si no está, tocá <strong>Ver más…</strong>.</li>
        <li>El navegador se acuerda de la última elegida: después de la primera vez ya aparece sola. Si alguien bajó un reporte como PDF, puede volver a «Guardar como PDF» y hay que elegirla de nuevo.</li>
        <li>Si tampoco está en «Ver más…», la impresora no está instalada en Windows: Configuración → Bluetooth y dispositivos → Impresoras y escáneres → Agregar dispositivo.</li>
        <li>En <strong>Más opciones</strong>: tamaño del papel <strong>Oficio</strong> (u 8,5 × 13; si no está, <strong>Legal</strong>), márgenes <strong>Ninguno</strong> y escala <strong>100</strong>. Nunca A4 ni Carta: el navegador achica la hoja y los datos salen corridos hacia arriba.</li>
        <li>Para no elegirlo cada vez: en Windows, Configuración → Impresoras → tu impresora → Preferencias de impresión, poné papel Oficio como predeterminado.</li>
      </ol>
    </details>
  )
}

/**
 * Pide la factura (le asigna número la primera vez) a `ruta` (`/ventas/:id/factura` o `/envios/:id/factura`) y abre la
 * impresión. `vista` va en la página.
 */
export function useFactura() {
  const [imprimiendo, setImprimiendo] = useState<{ venta: Venta; config: ConfigFactura } | null>(null)
  const hacer = useAccion((ruta: string) => post<{ venta: Venta; config: ConfigFactura }>(ruta))
  const imprimir = async (ruta: string) => {
    const r = await hacer.ejecutar(ruta)
    if (r) setImprimiendo(r)
  }
  const vista = imprimiendo && <ImprimirFactura venta={imprimiendo.venta} config={imprimiendo.config} alTerminar={() => setImprimiendo(null)} />
  return { imprimir, vista, error: hacer.error, enviando: hacer.enviando, ultima: imprimiendo?.venta }
}

// ---------- Formato y calibración (administrador) ----------

const VENTA_PRUEBA: Venta = {
  id: 'prueba', numero: 0, cajaId: '', clienteNombre: 'Cliente de prueba S.A.', clienteRuc: '80000000-1', clienteDireccion: 'Ruta 1 km 300, Coronel Bogado',
  subtotal: 64_000, descuento: 4000, total: 60_000, medio: 'efectivo', pagos: [], recibido: null, vuelto: null, usuarioNombre: '', fecha: new Date().toISOString(),
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
  const [talonario, setTalonario] = useState<TalonarioId>('comedor')
  const c = useConsulta<ConfigFactura>('/factura/config', { talonario })
  return (
    <>
      <UsosTalonarios />
      <h2>Talonario</h2>
      <div className="segmentado" role="tablist" aria-label="Talonario">
        {TALONARIOS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === talonario} className={t === talonario ? 'activo' : ''} onClick={() => setTalonario(t)}>
            {NOMBRE_TALONARIO[t]}
          </button>
        ))}
      </div>
      <ConDatos consulta={c}>{(config) => config.talonario === talonario ? <FormFactura key={talonario} inicial={config} /> : null}</ConDatos>
    </>
  )
}

/** Qué talonario usa la caja del frente, la del comedor y los envíos a sucursal. */
function UsosTalonarios() {
  const c = useConsulta<UsosFactura>('/factura/usos')
  const guardar = useAccion((u: UsosFactura) => put<UsosFactura>('/factura/usos', u))
  return (
    <>
      <h2>Qué factura sale en cada lugar</h2>
      <ConDatos consulta={c}>
        {(usos) => (
          <div className="tarjeta filtros">
            {USOS_FACTURA.map((uso) => (
              <label key={uso} className="campo">
                <span>{NOMBRE_USO_FACTURA[uso]}</span>
                <select value={usos[uso]} disabled={guardar.enviando} onChange={(e) => void guardar.ejecutar({ ...usos, [uso]: e.target.value as TalonarioId }).then((r) => { if (r) c.recargar() })}>
                  {TALONARIOS.map((t) => <option key={t} value={t}>{NOMBRE_TALONARIO[t]}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </ConDatos>
      <Aviso>{guardar.error}</Aviso>
    </>
  )
}

function FormFactura({ inicial }: { inicial: ConfigFactura }) {
  const t = inicial.talonario
  const [d, setD] = useState(inicial)
  const [ok, setOk] = useState(false)
  const [prueba, setPrueba] = useState(false)
  const [fondo, setFondo] = useState(true)
  const proxima = useConsulta<{ numero: number; numeroCompleto: string }>('/factura/proxima', { talonario: t })
  const guardar = useAccion(() => put<ConfigFactura>(`/factura/config?talonario=${t}`, d))
  const cambiar = (x: Partial<ConfigFactura>) => { setOk(false); setD({ ...d, ...x }) }
  const redondo = (n: number) => Math.round(n * 10) / 10
  const mover = (dx: number, dy: number) => cambiar({ margenIzquierdo: redondo(d.margenIzquierdo + dx), margenSuperior: redondo(d.margenSuperior + dy) })
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
        La factura <strong>{NOMBRE_TALONARIO[t]}</strong> sale sobre la hoja preimpresa de la imprenta (oficio, 216 × 330 mm, original arriba y duplicado abajo):
        el sistema imprime solo la fecha, el cliente, el detalle y los importes. Para calibrar, imprimí una hoja de prueba en
        una hoja oficio común (papel oficio, márgenes «Ninguno» y escala 100), ponela encima de una factura en blanco y
        miralas a contraluz. Primero medí la regla del pie: tiene que dar 10 cm; si da menos, la hoja salió achicada (papel A4
        o Carta en la ventana de impresión). Después mové todo con las flechas: si los datos salen 3 mm más arriba de donde van, tocá
        «Bajar» 3 veces. Guardá y probá de nuevo.
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
      <div className="tarjeta calibrar">
        <div className="flechas-mm" role="group" aria-label="Mover todo lo que se imprime, de a 1 mm">
          <button type="button" className="btn-secundario arriba" onClick={() => mover(0, -1)}>▲ Subir</button>
          <button type="button" className="btn-secundario izquierda" onClick={() => mover(-1, 0)}>◀ Izquierda</button>
          <span className="centro chico">1 mm</span>
          <button type="button" className="btn-secundario derecha" onClick={() => mover(1, 0)}>Derecha ▶</button>
          <button type="button" className="btn-secundario abajo" onClick={() => mover(0, 1)}>▼ Bajar</button>
        </div>
        <div className="filtros">
          {num('margenIzquierdo', 'Corrido a la derecha (mm, negativo = a la izquierda)')}
          {num('margenSuperior', 'Corrido hacia abajo (mm, negativo = hacia arriba)')}
          {par('duplicado', 'Duplicado: dónde empieza respecto del original (mm)', ['a la derecha', 'hacia abajo'])}
        </div>
      </div>
      <ConsejoImpresora />

      <details className="tarjeta">
        <summary>Medidas de la hoja y posición de cada dato</summary>
        <p className="suave chico">En milímetros, desde la esquina de arriba a la izquierda de la hoja (x hacia la derecha, y hacia abajo). Solo hace falta tocarlas si un dato puntual cae mal.</p>
        <div className="filtros">{NUMEROS.map(([k, t]) => num(k, t))}</div>
        <div className="filtros">{POSICIONES.map(([k, t]) => par(k, t))}</div>
      </details>

      <Aviso>{guardar.error}</Aviso>
      {ok && <Aviso tipo="ok">Formato de {NOMBRE_TALONARIO[t]} guardado.</Aviso>}
      <div className="fila-acciones">
        <button type="button" className="btn-primario" disabled={guardar.enviando} onClick={() => void guardar.ejecutar().then((r) => { if (r) { setOk(true); proxima.recargar() } })}>Guardar formato</button>
        <button type="button" className="btn-secundario" onClick={() => setPrueba(true)}>Imprimir hoja de prueba</button>
      </div>
      <h2>Vista previa</h2>
      <label className="check">
        <input type="checkbox" checked={fondo} onChange={(e) => setFondo(e.target.checked)} />
        <span>Verla sobre el dibujo de la hoja (sacado de la foto, enderezado y a tamaño oficio)</span>
      </label>
      <div className="vista-factura"><HojaFactura venta={VENTA_PRUEBA} config={d} fondo={fondo} /></div>
      {prueba && <ImprimirFactura venta={VENTA_PRUEBA} config={d} alTerminar={() => setPrueba(false)} />}
    </>
  )
}
