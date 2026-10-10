// C03–C04: el administrador revisa los registros de producción del sector elegido arriba y corrige
// cantidades. La diferencia de lo guardado ajusta el stock y queda anotado quién corrigió y cuándo.
import { useState } from 'react'
import { patch } from '../../cliente/api'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import { useSectorActivo } from '../../components/Layout'
import { diaPY, fechaHoraPY, inicioDeMes, sumarDias } from '../../shared/hora'
import type { Produccion, Producto, Turno } from '../../shared/tipos'
import '../../styles/produccion.css'

const NOMBRE_TURNO: Record<Turno, string> = { dia: 'turno día', noche: 'turno noche' }

const columnas = (conLotes: boolean) => (conLotes ? ['Horno', 'Congelador'] : ['Cocinado', 'Guardado'])

type Rango = 'hoy' | 'semana' | 'mes'

function rango(r: Rango, hoy: string): [string, string] {
  if (r === 'hoy') return [hoy, hoy]
  if (r === 'semana') return [sumarDias(hoy, -6), hoy]
  return [inicioDeMes(hoy), hoy]
}

export default function Registros() {
  const sector = useSectorActivo()
  const hoy = diaPY()
  const [desde, setDesde] = useState(() => rango('semana', hoy)[0])
  const [hasta, setHasta] = useState(hoy)
  const rangoMal = !!desde && !!hasta && desde > hasta
  const consulta = useConsulta<Produccion[]>(rangoMal ? null : '/producciones', { sector: sector.id, desde, hasta })
  const productos = useConsulta<Producto[]>('/productos', { sector: sector.id })
  const [colCocinado, colGuardado] = columnas(sector.conLotes)

  const elegido = (['hoy', 'semana', 'mes'] as Rango[]).find((r) => {
    const [d, h] = rango(r, hoy)
    return d === desde && h === hasta
  })

  return (
    <>
      <h1>Registros de producción{sector.nombre && <span className="suave"> · {sector.nombre}</span>}</h1>
      <div className="tarjeta">
        <div className="segmentado chico" role="group" aria-label="Período">
          {([['hoy', 'Hoy'], ['semana', 'Últimos 7 días'], ['mes', 'Este mes']] as [Rango, string][]).map(([r, t]) => (
            <button
              key={r}
              type="button"
              className={elegido === r ? 'activo' : ''}
              aria-pressed={elegido === r}
              onClick={() => {
                const [d, h] = rango(r, hoy)
                setDesde(d)
                setHasta(h)
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="prod-fechas">
          <label className="campo"><span>Desde</span><input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      </div>
      {rangoMal ? (
        <Aviso>La fecha desde no puede ser posterior a la fecha hasta.</Aviso>
      ) : (
        <ConDatos consulta={consulta}>
          {(lista) =>
            lista.length === 0 ? (
              <p className="suave">No hay registros de {sector.nombre || 'este sector'} en esas fechas.</p>
            ) : (
              <>
                <p className="suave chico">
                  {lista.length} {lista.length === 1 ? 'registro' : 'registros'} ·{' '}
                  {lista.reduce((s, p) => s + p.items.reduce((a, i) => a + i.cocinado, 0), 0)} {colCocinado.toLowerCase()} ·{' '}
                  {lista.reduce((s, p) => s + p.items.reduce((a, i) => a + i.guardado, 0), 0)} {colGuardado.toLowerCase()}
                </p>
                {lista.map((p) => (
                  <Tarjeta key={p.id} p={p} productos={productos.datos ?? []} conLotes={sector.conLotes} />
                ))}
              </>
            )
          }
        </ConDatos>
      )}
    </>
  )
}

interface Fila {
  productoId: string
  productoNombre: string
  cocinado: string
  guardado: string
}

/** "" = 0; si no es un entero ≥ 0 devuelve null. */
function leer(v: string): number | null {
  const t = v.trim()
  if (t === '') return 0
  const n = Number(t)
  return Number.isInteger(n) && n >= 0 ? n : null
}

const conSigno = (n: number) => (n > 0 ? `+${n}` : `−${-n}`)

function Tarjeta({ p, productos, conLotes }: { p: Produccion; productos: Producto[]; conLotes: boolean }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [hecho, setHecho] = useState(false)
  const corregir = useAccion((items: { productoId: string; cocinado: number; guardado: number }[]) =>
    patch<Produccion>(`/producciones/${p.id}`, { items }))
  const [colCocinado, colGuardado] = columnas(conLotes)
  const editando = filas !== null

  const empezar = () => {
    setHecho(false)
    setAviso(null)
    corregir.limpiarError()
    setFilas(p.items.map((i) => ({ productoId: i.productoId, productoNombre: i.productoNombre, cocinado: String(i.cocinado), guardado: String(i.guardado) })))
  }
  const cambiar = (idx: number, campo: 'cocinado' | 'guardado', v: string) => {
    setAviso(null)
    setFilas((fs) => fs && fs.map((f, j) => (j === idx ? { ...f, [campo]: v } : f)))
  }

  // Lo que cambió respecto del registro y su efecto en el stock en frío.
  const cambios = (filas ?? []).flatMap((f) => {
    const cocinado = leer(f.cocinado)
    const guardado = leer(f.guardado)
    if (cocinado === null || guardado === null) return []
    const antes = p.items.find((i) => i.productoId === f.productoId)
    const igual = antes ? antes.cocinado === cocinado && antes.guardado === guardado : cocinado + guardado === 0
    return igual ? [] : [{ productoId: f.productoId, productoNombre: f.productoNombre, cocinado, guardado, diferencia: guardado - (antes?.guardado ?? 0) }]
  })
  const invalidas = (filas ?? []).filter((f) => leer(f.cocinado) === null || leer(f.guardado) === null)
  const efecto = cambios.filter((c) => c.diferencia !== 0)
  const paraAgregar = productos.filter((x) => x.activo && !(filas ?? []).some((f) => f.productoId === x.id))

  const guardar = async () => {
    setAviso(null)
    if (invalidas.length) return setAviso(`Revisá ${invalidas[0].productoNombre}: las cantidades son números enteros, sin negativos.`)
    if (!cambios.length) return setAviso('No cambiaste ninguna cantidad.')
    const r = await corregir.ejecutar(cambios.map(({ productoId, cocinado, guardado }) => ({ productoId, cocinado, guardado })))
    if (r) {
      setFilas(null)
      setHecho(true)
    }
  }

  const items = editando ? filas : p.items
  const total = (campo: 'cocinado' | 'guardado') => p.items.reduce((s, i) => s + i[campo], 0)

  return (
    <div className={editando ? 'tarjeta prod-editando' : 'tarjeta'}>
      <div className="fila-acciones prod-cabeza">
        <strong>{fechaHoraPY(p.fecha)} · {NOMBRE_TURNO[p.turno]}</strong>
        <span className="suave chico">{p.usuarioNombre}</span>
        {p.lote && <span className="chip">{p.lote.codigo}</span>}
        {!editando && <button className="btn-texto" onClick={empezar}>Corregir</button>}
      </div>
      {p.lote && p.lote.lotesMP.length > 0 && (
        <span className="suave chico">Materia prima: {p.lote.lotesMP.map((l) => l.descripcion).join(' · ')}</span>
      )}
      {p.corregidoEn && (
        <span className="prod-corregido">Corregido por {p.corregidoPorNombre} el {fechaHoraPY(p.corregidoEn)}</span>
      )}
      {hecho && <Aviso tipo="ok">Corrección guardada.</Aviso>}
      <table className="tabla">
        <thead><tr><th>Producto</th><th className="num">{colCocinado}</th><th className="num">{colGuardado}</th></tr></thead>
        <tbody>
          {editando
            ? filas.map((f, idx) => (
                <tr key={f.productoId}>
                  <td>{f.productoNombre}</td>
                  {(['cocinado', 'guardado'] as const).map((campo) => (
                    <td className="num" key={campo}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        aria-label={`${f.productoNombre}: ${campo === 'cocinado' ? colCocinado : colGuardado}`}
                        className={leer(f[campo]) === null ? 'rojo' : undefined}
                        value={f[campo]}
                        onChange={(e) => cambiar(idx, campo, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : (items as Produccion['items']).map((i) => (
                <tr key={i.productoId}>
                  <td>{i.productoNombre}</td>
                  <td className="num">{i.cocinado}</td>
                  <td className="num">{i.guardado}</td>
                </tr>
              ))}
          {!editando && p.items.length > 1 && (
            <tr className="prod-total"><td>Total</td><td className="num">{total('cocinado')}</td><td className="num">{total('guardado')}</td></tr>
          )}
        </tbody>
      </table>
      {editando && (
        <>
          {paraAgregar.length > 0 && (
            <label className="campo">
              <span>¿Faltó un producto?</span>
              <select
                value=""
                onChange={(e) => {
                  const x = productos.find((pr) => pr.id === e.target.value)
                  if (x) setFilas((fs) => fs && [...fs, { productoId: x.id, productoNombre: x.nombre, cocinado: '0', guardado: '0' }])
                }}
              >
                <option value="">Agregar un producto…</option>
                {paraAgregar.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </label>
          )}
          {efecto.length > 0 && (
            <div className="prod-efecto">
              El stock en frío se ajusta{p.lote ? <> en el lote <span className="prod-codigo">{p.lote.codigo}</span></> : null}:
              <ul>{efecto.map((c) => <li key={c.productoId}>{c.productoNombre}: {conSigno(c.diferencia)}</li>)}</ul>
            </div>
          )}
          <Aviso>{aviso ?? corregir.error}</Aviso>
          <div className="fila-acciones prod-cabeza">
            <button className="btn-primario" onClick={() => void guardar()} disabled={corregir.enviando || (!cambios.length && !invalidas.length)}>
              {corregir.enviando ? 'Guardando…' : 'Guardar corrección'}
            </button>
            <button className="btn-texto" onClick={() => setFilas(null)} disabled={corregir.enviando}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  )
}
