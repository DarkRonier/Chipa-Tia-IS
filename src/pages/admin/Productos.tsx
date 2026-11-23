// B01: productos de todos los sectores en una tabla paginada (10 por página). La columna Sector dice quién lo elabora
// (lo elaborado) o qué sectores lo compran y usan (lo comprado: los que tienen habilitada su categoría).
// Arriba a la izquierda el filtro, arriba a la derecha «+ Nuevo producto»; la descarga (PDF o CSV) va sobre la tabla.
// Crear y editar se hace en un modal: en la tabla no se cambia nada directo (ni el tipo ni el precio).
// Los productos no tienen campos de stock: el stock se lleva por depósito (pantalla Stock).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Flecha } from '../../components/Volver'
import { patch, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { nombreSeguro, imprimir } from '../../cliente/imprimir'
import {
  aCSV, botonesPagina, descargarTexto, ENCABEZADOS_EXPORTACION, filasExportacion, filtrarProductos, FILTRO_VACIO, hayFiltro, paginar,
  TIPO_CORTO, textoSectores, type EstadoFiltro, type FiltroProductos, type Nombres,
} from '../../cliente/productos'
import BotonIcono, { Acciones } from '../../components/BotonIcono'
import { Aviso, ConDatos } from '../../components/Estado'
import { Icono } from '../../components/Iconos'
import { EncabezadoImpresion } from '../../components/Impresion'
import Modal from '../../components/Modal'
import { useSector } from '../../components/Layout'
import { gs, miles } from '../../shared/dinero'
import { diaPY } from '../../shared/hora'
import {
  CATEGORIA_MATERIA_PRIMA, IVAS, NOMBRE_IVA, NOMBRE_TIPO_PRODUCTO, TIPOS_PRODUCTO, type Categoria, type Iva, type Producto, type Sector, type SectorId, type TipoProducto,
} from '../../shared/tipos'
import '../../styles/compras.css'
import '../../styles/productos.css'

/** Pantalla propia de Productos (antes era una pestaña de Catálogos; Mati la independizó el 2026-11-21). */
export function PaginaProductos() {
  return (
    <>
      <h1 className="no-imprimir">Productos</h1>
      <Productos />
    </>
  )
}

type Modo = { tipo: 'nuevo' } | { tipo: 'editar'; producto: Producto }

export default function Productos() {
  const c = useConsulta<Producto[]>('/productos', { todos: true })
  const categorias = useConsulta<Categoria[]>('/categorias', { todos: true })
  const sectores = useSectores()
  const [filtro, setFiltro] = useState<FiltroProductos>(FILTRO_VACIO)
  const [pagina, setPagina] = useState(1)
  const [modal, setModal] = useState<Modo | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const listaCategorias = categorias.datos ?? []
  const nombres: Nombres = {
    sector: (id) => sectores.nombre(id),
    categoria: (id) => (id === null ? '' : listaCategorias.find((k) => k.id === id)?.nombre ?? ''),
    sectoresCategoria: (id) => listaCategorias.find((k) => k.id === id && k.activo)?.sectores ?? [],
  }
  const filtrados = useMemo(() => filtrarProductos(c.datos ?? [], filtro, nombres),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.datos, filtro, sectores.lista, listaCategorias])
  const vista = paginar(filtrados, pagina)

  const cambiarFiltro = (cambios: Partial<FiltroProductos>) => {
    setFiltro((f) => ({ ...f, ...cambios }))
    setPagina(1)
  }

  const archivo = nombreSeguro(`Productos Chipa Tía ${diaPY()}`)
  const exportarCSV = () => descargarTexto(`${archivo}.csv`, aCSV(ENCABEZADOS_EXPORTACION, filasExportacion(filtrados, nombres)))
  const detalleFiltro = hayFiltro(filtro) ? `${filtrados.length} productos (con filtro)` : `${filtrados.length} productos`

  return (
    <div className="prod-pagina">
      <div className="prod-barra no-imprimir">
        <FiltroTabla filtro={filtro} cambiar={cambiarFiltro} sectores={sectores.lista} categorias={listaCategorias} />
        <button type="button" className="btn-primario prod-nuevo" onClick={() => { setOk(null); setModal({ tipo: 'nuevo' }) }}>
          <Icono nombre="mas" /> Nuevo producto
        </button>
      </div>
      {ok && <div className="no-imprimir"><Aviso tipo="ok">{ok}</Aviso></div>}

      <ConDatos consulta={c}>
        {(lista) => (
          <>
            <div className="prod-sobre-tabla no-imprimir">
              <p className="suave chico" aria-live="polite">
                {vista.total ? `Mostrando ${vista.desde}–${vista.hasta} de ${vista.total}` : 'Sin resultados'}
                {hayFiltro(filtro) && ` · ${lista.length} en total`}
              </p>
              <MenuDescarga cantidad={filtrados.length} conFiltro={hayFiltro(filtro)} alPDF={() => imprimir(archivo)} alCSV={exportarCSV} />
            </div>

            {vista.total ? (
              <div className="no-imprimir">
                <table className="tabla tabla-tarjetas prod-tabla">
                  <thead>
                    <tr>
                      <th>Producto</th><th>Sector</th><th>Tipo</th><th>Categoría</th>
                      <th className="num">Precio de venta</th><th>Estado</th>
                      <th className="acciones"><span className="solo-lector">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.items.map((p) => (
                      <FilaProducto key={p.id} p={p} nombres={nombres} alEditar={() => { setOk(null); setModal({ tipo: 'editar', producto: p }) }} />
                    ))}
                  </tbody>
                </table>
                <Paginacion actual={vista.pagina} paginas={vista.paginas} ir={setPagina} />
              </div>
            ) : (
              <div className="tarjeta prod-vacio no-imprimir">
                {lista.length ? (
                  <>
                    <p>Ningún producto coincide con el filtro.</p>
                    <button type="button" className="btn-secundario" onClick={() => cambiarFiltro(FILTRO_VACIO)}>Limpiar filtro</button>
                  </>
                ) : <p>Todavía no hay productos. Creá el primero con «Nuevo producto».</p>}
              </div>
            )}

            {/* PDF: al imprimir se ve solo esto, con la lista completa (todas las páginas) del filtro. */}
            <div className="solo-impresion">
              <EncabezadoImpresion titulo="Productos" detalle={detalleFiltro} />
              <table className="tabla prod-impresion">
                <thead><tr>{ENCABEZADOS_PDF.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {filasExportacion(filtrados, nombres).map((f, i) => (
                    <tr key={filtrados[i].id}>{COLUMNAS_PDF.map((col) => <td key={col}>{f[col]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ConDatos>

      {modal && (
        <ModalProducto
          modo={modal} categorias={listaCategorias} sectores={sectores.lista} productos={c.datos ?? []}
          alCerrar={() => setModal(null)}
          alGuardar={(texto) => { setModal(null); setOk(texto) }}
        />
      )}
    </div>
  )
}

/** En el PDF van las columnas que entran en una hoja A4 (el CSV lleva todas). */
// En el PDF no entran todas: sin «Tipo» ni «Stock», para que quepa en una hoja apaisada.
const COLUMNAS_PDF = [0, 1, 2, 4, 5, 6, 8, 9, 10]
const ENCABEZADOS_PDF = COLUMNAS_PDF.map((i) => ENCABEZADOS_EXPORTACION[i])

// ---------- Filtro ----------

function FiltroTabla({ filtro, cambiar, sectores, categorias }: {
  filtro: FiltroProductos
  cambiar: (c: Partial<FiltroProductos>) => void
  sectores: { id: SectorId; nombre: string }[]
  categorias: Categoria[]
}) {
  return (
    <div className="prod-filtro" role="search">
      <label className="campo prod-buscar">
        <span className="solo-lector">Buscar producto</span>
        <span className="prod-lupa" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </span>
        <input
          type="search" value={filtro.texto} placeholder="Buscar por nombre, código o categoría…"
          onChange={(e) => cambiar({ texto: e.target.value })}
        />
      </label>
      <label className="campo">
        <span className="solo-lector">Sector</span>
        <select value={filtro.sector} onChange={(e) => cambiar({ sector: e.target.value as SectorId | '' })}>
          <option value="">Todos los sectores</option>
          {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>
      <label className="campo">
        <span className="solo-lector">Tipo</span>
        <select value={filtro.tipo} onChange={(e) => cambiar({ tipo: e.target.value as TipoProducto | '' })}>
          <option value="">Todos los tipos</option>
          {TIPOS_PRODUCTO.map((t) => <option key={t} value={t}>{TIPO_CORTO[t]}</option>)}
        </select>
      </label>
      <label className="campo">
        <span className="solo-lector">Categoría</span>
        <select value={filtro.categoria} onChange={(e) => cambiar({ categoria: e.target.value })}>
          <option value="">Todas las categorías</option>
          <option value="ninguna">Sin categoría</option>
          {categorias.map((k) => <option key={k.id} value={k.id}>{k.nombre}{k.activo ? '' : ' (desactivada)'}</option>)}
        </select>
      </label>
      <label className="campo">
        <span className="solo-lector">Estado</span>
        <select value={filtro.estado} onChange={(e) => cambiar({ estado: e.target.value as EstadoFiltro })}>
          <option value="todos">Todos los estados</option>
          <option value="activos">Solo activos</option>
          <option value="desactivados">Solo desactivados</option>
        </select>
      </label>
      {hayFiltro(filtro) && (
        <button type="button" className="btn-discreto rojo prod-limpiar" onClick={() => cambiar(FILTRO_VACIO)}>Limpiar</button>
      )}
    </div>
  )
}

// ---------- Descarga ----------

function MenuDescarga({ cantidad, conFiltro, alPDF, alCSV }: { cantidad: number; conFiltro: boolean; alPDF: () => void; alCSV: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])
  const elegir = (f: () => void) => { setAbierto(false); f() }
  return (
    <div className="prod-descarga" ref={caja}>
      <BotonIcono icono="descargar" texto="Descargar la lista de productos" presionado={abierto} disabled={!cantidad}
        aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto(!abierto)} />
      {abierto && (
        <div className="prod-menu" role="menu">
          <p className="prod-menu-titulo">
            {conFiltro ? `Los ${cantidad} productos del filtro` : `Los ${cantidad} productos`}, todas las páginas
          </p>
          <button type="button" role="menuitem" autoFocus onClick={() => elegir(alPDF)}>
            <strong>PDF</strong><span>Para imprimir o compartir</span>
          </button>
          <button type="button" role="menuitem" onClick={() => elegir(alCSV)}>
            <strong>CSV</strong><span>Para abrir en Excel</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Tabla ----------

function FilaProducto({ p, nombres, alEditar }: { p: Producto; nombres: Nombres; alEditar: () => void }) {
  const activar = useAccion((activo: boolean) => patch<Producto>(`/productos/${p.id}`, { activo }))
  const nada = <span className="suave">—</span>
  const categoria = nombres.categoria(p.categoriaId)
  return (
    <>
      <tr className={p.activo ? '' : 'apagado'}>
        <td data-etiqueta="Producto">
          <strong>{p.nombre}</strong>
          {!p.activo && <span className="etiqueta apagada">Desactivado</span>}
          {(p.codigo || p.subcategoria || p.unidad !== 'unidades' || p.sinStock) && (
            <span className="prod-sub suave chico">
              {[p.subcategoria, p.codigo && `Código ${p.codigo}`, p.unidad !== 'unidades' && `en ${p.unidad}`, p.sinStock && 'solo ventas, sin stock'].filter(Boolean).join(' · ')}
            </span>
          )}
        </td>
        <td data-etiqueta="Sector" title={p.tipo === 'elaborado' ? 'Lo elabora' : 'Lo compran y usan (según su categoría)'}>{textoSectores(p, nombres)}</td>
        <td data-etiqueta="Tipo" className="sin-cortar"><span className={`prod-tipo tipo-${p.tipo}`}>{TIPO_CORTO[p.tipo]}</span></td>
        <td data-etiqueta="Categoría" className={categoria ? undefined : 'vacia'}>{categoria || nada}</td>
        <td data-etiqueta="Precio de venta" className="num">{p.precioVenta === null ? <span className="suave">No se vende</span> : gs(p.precioVenta)}</td>
        <td data-etiqueta="Estado">
          {p.activo ? <span className="prod-estado activo">Activo</span> : <span className="prod-estado">Desactivado</span>}
        </td>
        <td className="acciones">
          <Acciones>
            <BotonIcono icono="editar" texto={`Editar ${p.nombre}`} onClick={alEditar} />
            <BotonIcono
              icono={p.activo ? 'desactivar' : 'activar'} texto={`${p.activo ? 'Desactivar' : 'Activar'} ${p.nombre}`}
              tono={p.activo ? 'peligro' : 'positivo'} disabled={activar.enviando} onClick={() => void activar.ejecutar(!p.activo)}
            />
          </Acciones>
        </td>
      </tr>
      {activar.error && (
        <tr className="fila-detalle"><td colSpan={7}><Aviso>{activar.error}</Aviso></td></tr>
      )}
    </>
  )
}

function Paginacion({ actual, paginas, ir }: { actual: number; paginas: number; ir: (n: number) => void }) {
  if (paginas <= 1) return null
  return (
    <nav className="prod-paginas" aria-label="Páginas de la tabla">
      <button type="button" className="prod-pag" disabled={actual === 1} onClick={() => ir(actual - 1)} aria-label="Página anterior"><Flecha /></button>
      {botonesPagina(actual, paginas).map((n, i) =>
        n === null ? <span key={`s${i}`} className="prod-pag-salto" aria-hidden="true">…</span> : (
          <button
            key={n} type="button" className={`prod-pag${n === actual ? ' actual' : ''}`}
            aria-current={n === actual ? 'page' : undefined} aria-label={`Página ${n}`} onClick={() => ir(n)}
          >
            {n}
          </button>
        ))}
      <button type="button" className="prod-pag" disabled={actual === paginas} onClick={() => ir(actual + 1)} aria-label="Página siguiente"><Flecha derecha /></button>
    </nav>
  )
}

// ---------- Modal de alta y edición ----------

interface Datos {
  /** Sector que lo elabora (solo lo elaborado lo elige). */
  sector: SectorId
  /** Materia prima nueva: si lleva lote de materia prima (se crea al comprarla, para elegirlo en la amasada). */
  conLote: boolean
  nombre: string
  codigo: string
  tipo: TipoProducto
  categoriaId: string
  subcategoria: string
  unidad: string
  sinStock: boolean
  precioVenta: string
  iva: Iva
}

/** Unidades de medida para elegir; si el producto tiene otra, también aparece. */
const UNIDADES = ['unidades', 'kg', 'g', 'litros', 'ml', 'docenas', 'paquetes', 'porciones']

const datosDe = (p: Producto): Datos => ({
  sector: p.sector,
  conLote: false,
  nombre: p.nombre,
  codigo: p.codigo,
  tipo: p.tipo,
  categoriaId: p.categoriaId ?? '',
  subcategoria: p.subcategoria,
  unidad: p.unidad,
  sinStock: p.sinStock,
  precioVenta: p.precioVenta === null ? '' : miles(p.precioVenta),
  iva: p.iva,
})

/** Lo que se manda a la API. Sin categoría elegida, la API usa «Otros». */
function cuerpo(d: Datos) {
  return {
    nombre: d.nombre.trim(),
    codigo: d.codigo.trim(),
    tipo: d.tipo,
    categoriaId: d.categoriaId || null,
    subcategoria: d.subcategoria.trim(),
    unidad: d.unidad.trim() || 'unidades',
    sinStock: d.sinStock,
    precioVenta: d.precioVenta.trim() || null,
    iva: d.iva,
  }
}

function ModalProducto({ modo, categorias, sectores, productos, alCerrar, alGuardar }: {
  modo: Modo
  categorias: Categoria[]
  sectores: Sector[]
  /** Para sugerir las subcategorías que ya se usan en la categoría elegida (ej.: «Minutas» en Chipas y bocaditos). */
  productos: Producto[]
  alCerrar: () => void
  alGuardar: (mensaje: string) => void
}) {
  const sectorArriba = useSector()
  const original = modo.tipo === 'editar' ? modo.producto : null
  const [d, setD] = useState<Datos>(() => original ? datosDe(original) : {
    sector: sectorArriba, conLote: false, nombre: '', codigo: '', tipo: 'elaborado', categoriaId: categorias.find((k) => k.sistema)?.id ?? '',
    subcategoria: '', unidad: 'unidades', sinStock: false, precioVenta: '', iva: 10,
  })
  const set = (c: Partial<Datos>) => setD((x) => ({ ...x, ...c }))
  // En un producto nuevo, la categoría acompaña al tipo: materia prima va a «Materia prima»; si deja de serlo, vuelve a
  // «Otros». Si ya se eligió otra categoría a mano, no se toca.
  const otros = categorias.find((k) => k.sistema)?.id ?? ''
  const materiaPrima = categorias.find((k) => k.id === CATEGORIA_MATERIA_PRIMA && k.activo)?.id
  const cambiarTipo = (tipo: TipoProducto) => setD((x) => {
    if (original || !materiaPrima) return { ...x, tipo }
    if (tipo === 'materia_prima' && (x.categoriaId === otros || !x.categoriaId)) return { ...x, tipo, categoriaId: materiaPrima }
    if (tipo !== 'materia_prima' && x.categoriaId === materiaPrima) return { ...x, tipo, categoriaId: otros }
    return { ...x, tipo }
  })
  const nombreSector = sectores.find((s) => s.id === d.sector)?.nombre ?? d.sector
  // Lo comprado no es de un sector: lo usan los que tienen habilitada su categoría. Por dentro el producto guarda un
  // sector igual (el libro de stock lo pide): para la materia prima, uno con lotes si lleva lote de materia prima
  // (Chipería) y uno sin lotes si no; para la venta directa, uno sin lotes.
  const conLotes = sectores.find((s) => s.conLotes)?.id
  const sinLotes = sectores.find((s) => !s.conLotes)?.id
  const sectorAlGuardar = (x: Datos): SectorId => {
    if (x.tipo === 'elaborado') return x.sector
    if (x.tipo === 'materia_prima' && x.conLote) return conLotes ?? x.sector
    return sinLotes ?? x.sector
  }
  const llevaLote = original ? !!sectores.find((s) => s.id === original.sector)?.conLotes : d.conLote

  const guardar = useAccion(async () => {
    const nuevo = cuerpo(d)
    if (!original) return post<Producto>('/productos', { sector: sectorAlGuardar(d), ...nuevo })
    // Solo lo que cambió.
    const antes = cuerpo(datosDe(original)) as Record<string, unknown>
    const cambios = Object.fromEntries(Object.entries(nuevo).filter(([k, v]) => v !== antes[k]))
    if (!Object.keys(cambios).length) return original
    return patch<Producto>(`/productos/${original.id}`, cambios)
  })

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const p = await guardar.ejecutar()
    if (p) alGuardar(original ? `Se guardaron los cambios de «${p.nombre}».` : p.tipo === 'elaborado' ? `«${p.nombre}» agregado a ${nombreSector}.` : `«${p.nombre}» agregado.`)
  }

  const unidades = UNIDADES.includes(d.unidad) || !d.unidad ? UNIDADES : [...UNIDADES, d.unidad]
  const seVende = d.precioVenta.trim() !== ''
  const visibles = categorias.filter((k) => k.activo || k.id === d.categoriaId)
  const subcategorias = [...new Set(productos.filter((p) => p.categoriaId === d.categoriaId && p.subcategoria).map((p) => p.subcategoria))]
    .sort((a, b) => a.localeCompare(b, 'es'))

  return (
    <Modal titulo={original ? `Editar «${original.nombre}»` : 'Nuevo producto'} alCerrar={alCerrar} ancho="grande">
      <form className="prod-form" onSubmit={enviar}>
        <div className="prod-form-grilla">
          <label className="campo ancho">
            <span>Nombre</span>
            <input value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} maxLength={100} required autoFocus placeholder="Chipa so'o" />
          </label>
          {d.tipo === 'elaborado' && (original ? (
            <div className="campo">
              <span>Lo elabora</span>
              <p className="prod-fijo" title="No se cambia: el stock y el historial del producto son de ese sector">{nombreSector}</p>
            </div>
          ) : (
            <label className="campo">
              <span>Lo elabora</span>
              <select value={d.sector} onChange={(e) => set({ sector: e.target.value as SectorId })}>
                {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
          ))}
          {d.tipo === 'materia_prima' && (original ? (
            <div className="campo">
              <span>Lote de materia prima</span>
              <p className="prod-fijo" title="No se cambia después de crearla">{llevaLote ? 'Lleva lote' : 'Sin lote'}</p>
            </div>
          ) : (
            <label className="campo">
              <span>Lote de materia prima</span>
              <select value={d.conLote ? 'si' : 'no'} onChange={(e) => set({ conLote: e.target.value === 'si' })}>
                <option value="si">Lleva lote (para la trazabilidad de Chipería)</option>
                <option value="no">Sin lote</option>
              </select>
            </label>
          ))}
          <label className="campo">
            <span>Código <span className="opcional">opcional</span></span>
            <input value={d.codigo} onChange={(e) => set({ codigo: e.target.value })} maxLength={30} />
          </label>
          <label className="campo">
            <span>Tipo</span>
            <select value={d.tipo} onChange={(e) => cambiarTipo(e.target.value as TipoProducto)}>
              {TIPOS_PRODUCTO.map((t) => <option key={t} value={t}>{NOMBRE_TIPO_PRODUCTO[t]}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Categoría</span>
            <select value={d.categoriaId} onChange={(e) => set({ categoriaId: e.target.value })}>
              {!d.categoriaId && <option value="">Otros</option>}
              {visibles.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Subcategoría <span className="opcional">opcional</span></span>
            <input value={d.subcategoria} onChange={(e) => set({ subcategoria: e.target.value })} maxLength={60} placeholder="Ej.: minutas, gaseosas, tortas"
              list="prod-subcategorias" />
            <datalist id="prod-subcategorias">{subcategorias.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          <label className="campo">
            <span>Unidad de medida</span>
            <select value={d.unidad || 'unidades'} onChange={(e) => set({ unidad: e.target.value })}>
              {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <p className="pista-campo ancho">
            La categoría agrupa los productos en Depósitos y dice qué sectores la pueden comprar y usar. «Otros» es para los que no entran en ninguna.
          </p>
        </div>

        <fieldset className="prod-grupo">
          <legend>Venta en caja</legend>
          <div className="prod-form-grilla">
            <label className="campo">
              <span>Precio de venta en Gs.</span>
              <input value={d.precioVenta} inputMode="numeric" onChange={(e) => set({ precioVenta: e.target.value })} maxLength={15} placeholder="Vacío = no se vende" />
            </label>
            <label className="campo">
              <span>IVA</span>
              <select value={d.iva} disabled={!seVende} onChange={(e) => set({ iva: Number(e.target.value) as Iva })}>
                {IVAS.map((i) => <option key={i} value={i}>{NOMBRE_IVA[i]}</option>)}
              </select>
            </label>
            <label className="check ancho">
              <input type="checkbox" checked={d.sinStock} onChange={(e) => set({ sinStock: e.target.checked })} />
              Sin stock: solo se registra lo que se vende (por ejemplo, el buffet por kilo)
            </label>
            <p className="pista-campo ancho">
              {d.sinStock
                ? 'No se lleva cuánto hay: en Depósitos aparece solo lo vendido.'
                : d.tipo === 'materia_prima'
                  ? 'Materia prima con precio (por ejemplo, la leche): se vende en caja y se descuenta del depósito «Materia prima». Sin precio no se vende.'
                  : 'Lo que se vende en la caja del frente se descuenta de «Venta frente», y en la del comedor, de «Venta comedor».'}
            </p>
          </div>
        </fieldset>

        <Aviso>{guardar.error}</Aviso>
        <div className="prod-form-botones">
          <button type="button" className="btn-secundario" onClick={alCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={guardar.enviando}>
            {guardar.enviando ? 'Guardando…' : original ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
