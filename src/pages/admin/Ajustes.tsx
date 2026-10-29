// D06, D07: el administrador ve el stock en frío del sector elegido arriba y registra mermas,
// vencimientos, ajustes (+/−) y el stock inicial, siempre con motivo y diciendo de cuál stock (C05: «Reponer venta»
// o «Sucursales»). Quedan en el historial y en la auditoría.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSector, useSectorActivo } from '../../components/Layout'
import Numero from '../../components/Numero'
import { NOMBRE_FINALIDAD, NOMBRE_TIPO_MOVIMIENTO, type Finalidad, type Movimiento, type PedidoAjuste, type TipoAjuste } from '../../shared/tipos'
import { conSigno, TablaMovimientos } from '../sector/Historial'
import { AlertasStock, CambiarFinalidad, TablaStock, useStock } from '../sector/Stock'
import '../../styles/stock.css'

const TIPOS: TipoAjuste[] = ['merma', 'vencimiento', 'ajuste', 'stock_inicial']
const TIPOS_AJUSTE = TIPOS.join(',')
const MOTIVO_INICIAL = 'Stock existente al empezar a usar el sistema'
const RECIENTES = 15

const AYUDA: Record<TipoAjuste, string> = {
  merma: 'Resta del stock.',
  vencimiento: 'Resta del stock.',
  ajuste: 'Corrige el stock: suma o resta.',
  stock_inicial: 'Suma al stock lo que ya había.',
}

const EJEMPLO_MOTIVO: Record<TipoAjuste, string> = {
  merma: 'Ej.: se rompió la bolsa',
  vencimiento: 'Ej.: vencido el 08/10',
  ajuste: 'Ej.: conteo físico del viernes',
  stock_inicial: MOTIVO_INICIAL,
}

export default function Ajustes() {
  // Al cambiar de sector en la barra de arriba, el formulario empieza de cero.
  const sector = useSector()
  return <Pantalla key={sector} />
}

function Pantalla() {
  const { id: sector, nombre, conLotes } = useSectorActivo()
  const stock = useStock(sector)
  const recientes = useConsulta<Movimiento[]>('/movimientos', { sector, tipo: TIPOS_AJUSTE })
  const [tipo, setTipo] = useState<TipoAjuste>('merma')
  const [sentido, setSentido] = useState<1 | -1>(-1)
  const [finalidad, setFinalidad] = useState<Finalidad>('reposicion')
  const [productoId, setProductoId] = useState('')
  const [lote, setLote] = useState('')
  const [cantidad, setCantidad] = useState(0)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const guardarAjuste = useAccion((p: PedidoAjuste) => post<Movimiento>('/ajustes', p))

  // Merma y vencimiento siempre restan; stock inicial suma; un ajuste puede ir en los dos sentidos.
  const signo = tipo === 'stock_inicial' ? 1 : tipo === 'ajuste' ? sentido : -1
  const filas = stock.datos ?? []
  const fila = filas.find((f) => f.productoId === productoId)
  // Para restar solo cuentan los lotes con stock de la finalidad elegida.
  const lotes = (fila?.lotes ?? []).filter((l) => signo > 0 || l[finalidad] > 0)
  // Para sumar se puede escribir un lote (por ejemplo, uno anterior al sistema); para restar se elige uno con stock.
  const loteEscrito = conLotes && signo > 0
  const disponible = !fila ? 0 : conLotes ? (lotes.find((l) => l.lote === lote.trim().toUpperCase())?.[finalidad] ?? 0) : fila[finalidad]

  const limpiarMensajes = () => {
    setAviso(null)
    setListo(null)
    guardarAjuste.limpiarError()
  }

  const elegirTipo = (t: TipoAjuste) => {
    limpiarMensajes()
    setTipo(t)
    setLote('')
    // El stock inicial trae un motivo sugerido; se puede cambiar.
    if (t === 'stock_inicial' && !motivo.trim()) setMotivo(MOTIVO_INICIAL)
    if (t !== 'stock_inicial' && motivo === MOTIVO_INICIAL) setMotivo('')
  }

  const guardar = async () => {
    limpiarMensajes()
    if (!fila) return setAviso('Elegí el producto.')
    if (conLotes && !lote.trim()) return setAviso(loteEscrito ? 'Escribí el lote.' : 'Elegí el lote.')
    if (cantidad <= 0) return setAviso('Cargá una cantidad mayor que cero.')
    if (!motivo.trim()) return setAviso('Escribí el motivo.')
    if (signo < 0 && cantidad > disponible) return setAviso(`Solo hay ${disponible} en «${NOMBRE_FINALIDAD[finalidad]}»${conLotes ? ' en ese lote' : ''}.`)
    const r = await guardarAjuste.ejecutar({
      sector, productoId, tipo, cantidad, finalidad, motivo: motivo.trim(),
      ...(conLotes ? { lote: lote.trim() } : {}),
      ...(tipo === 'ajuste' ? { sentido } : {}),
    })
    if (r) {
      setListo(`Guardado: ${NOMBRE_TIPO_MOVIMIENTO[r.tipo].toLowerCase()} ${conSigno(r.cantidad)} de ${r.productoNombre}${r.lote ? ` (lote ${r.lote})` : ''}.`)
      setCantidad(0)
      setLote('')
      setMotivo(tipo === 'stock_inicial' ? MOTIVO_INICIAL : '')
    }
  }

  const error = aviso ?? guardarAjuste.error

  return (
    <>
      <h1>Stock en frío · {nombre}</h1>
      <AlertasStock sector={sector} />
      <ConDatos consulta={stock}>
        {(datos) => (
          <>
            <TablaStock filas={datos} conLotes={conLotes} ocultarCeros />
            <CambiarFinalidad key={sector} sector={sector} conLotes={conLotes} filas={datos} />
          </>
        )}
      </ConDatos>

      <h2>Registrar merma, vencimiento o ajuste</h2>
      <div className="tarjeta">
        <div className="segmentado stk-tipos" role="group" aria-label="Tipo">
          {TIPOS.map((t) => (
            <button key={t} type="button" className={tipo === t ? 'activo' : ''} aria-pressed={tipo === t} onClick={() => elegirTipo(t)}>
              {NOMBRE_TIPO_MOVIMIENTO[t]}
            </button>
          ))}
        </div>
        <p className="suave chico stk-ayuda">{AYUDA[tipo]}</p>
        {tipo === 'ajuste' && (
          <div className="segmentado" role="group" aria-label="Sentido del ajuste">
            <button type="button" className={sentido === 1 ? 'activo' : ''} aria-pressed={sentido === 1} onClick={() => { limpiarMensajes(); setSentido(1); setLote('') }}>Sumar (+)</button>
            <button type="button" className={sentido === -1 ? 'activo' : ''} aria-pressed={sentido === -1} onClick={() => { limpiarMensajes(); setSentido(-1); setLote('') }}>Restar (−)</button>
          </div>
        )}
        <div className="segmentado" role="group" aria-label="Stock al que afecta">
          {(['reposicion', 'distribucion'] as Finalidad[]).map((f) => (
            <button key={f} type="button" className={finalidad === f ? 'activo' : ''} aria-pressed={finalidad === f} onClick={() => { limpiarMensajes(); setFinalidad(f); setLote('') }}>
              {NOMBRE_FINALIDAD[f]}
            </button>
          ))}
        </div>
        <label className="campo">
          <span>Producto</span>
          <select value={productoId} onChange={(e) => { limpiarMensajes(); setProductoId(e.target.value); setLote('') }}>
            <option value="">{stock.datos ? 'Elegí un producto' : 'Cargando…'}</option>
            {filas.map((f) => (
              <option key={f.productoId} value={f.productoId}>{f.productoNombre} ({f[finalidad]}){f.activo ? '' : ' · desactivado'}</option>
            ))}
          </select>
        </label>
        {conLotes && fila && (
          <label className="campo">
            <span>Lote{loteEscrito ? ' (escribí el código o elegí uno de la lista)' : ''}</span>
            {loteEscrito ? (
              <>
                <input
                  value={lote}
                  onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}
                  placeholder="Ej.: CH-261001-1"
                  list="stk-lotes-producto"
                  autoCapitalize="characters"
                  maxLength={40}
                />
                <datalist id="stk-lotes-producto">
                  {lotes.map((l) => <option key={l.lote} value={l.lote}>{l[finalidad]} en stock</option>)}
                </datalist>
              </>
            ) : (
              <select value={lote} onChange={(e) => { limpiarMensajes(); setLote(e.target.value) }}>
                <option value="">{lotes.length ? 'Elegí un lote' : 'Este producto no tiene lotes con stock'}</option>
                {lotes.map((l) => <option key={l.lote} value={l.lote}>{l.lote} ({l[finalidad]})</option>)}
              </select>
            )}
          </label>
        )}
        <Numero
          etiqueta={fila && signo < 0 && (!conLotes || lote) ? `Cantidad (hay ${disponible})` : 'Cantidad'}
          valor={cantidad}
          onChange={(n) => { limpiarMensajes(); setCantidad(n) }}
        />
        <label className="campo">
          <span>Motivo (obligatorio)</span>
          <input value={motivo} onChange={(e) => { limpiarMensajes(); setMotivo(e.target.value) }} placeholder={EJEMPLO_MOTIVO[tipo]} maxLength={300} />
        </label>
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{listo}</Aviso>
        <button className="btn-primario" onClick={() => void guardar()} disabled={guardarAjuste.enviando}>
          {guardarAjuste.enviando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <h2>Últimos ajustes · {nombre}</h2>
      <ConDatos consulta={recientes}>
        {(lista) => lista.length === 0 ? (
          <p className="suave">Todavía no hay ajustes en este sector.</p>
        ) : (
          <>
            <TablaMovimientos movimientos={lista.slice(0, RECIENTES)} />
            {lista.length > RECIENTES && (
              <p className="suave chico">
                Se muestran los últimos {RECIENTES}. <Link to="/admin/historial">Ver todo en el historial</Link>.
              </p>
            )}
          </>
        )}
      </ConDatos>
    </>
  )
}
