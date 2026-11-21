// Catálogos: los depósitos del stock y las categorías de compras (M10). Productos y Mantenimiento (máquinas y limpieza) tienen su propia
// pantalla (pedido de Mati, 2026-11-21); sucursales y sectores ya no se editan desde acá (sus datos siguen en la base).
// Nada se borra: se desactiva y el historial lo sigue mostrando.
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { patch, post } from '../../cliente/api'
import { useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { Aviso, ConDatos } from '../../components/Estado'
import type { Categoria, Deposito, Sector, SectorId } from '../../shared/tipos'
import { FilaEditable, FormAlta, ListaConInactivos, SectoresCheck } from './piezasCatalogo'
import '../../styles/catalogos.css'

/** Enlaces viejos (?ver=…) de cuando todo estaba en pestañas de Catálogos: llevan a la pantalla nueva. */
const MUDADAS: Record<string, string> = {
  productos: '/admin/productos',
  maquinas: '/admin/mantenimiento?ver=maquinas',
  limpieza: '/admin/mantenimiento?ver=limpieza',
}

export default function Catalogos() {
  const [params] = useSearchParams()
  const sectores = useSectores()
  const mudada = MUDADAS[params.get('ver') ?? '']
  if (mudada) return <Navigate to={mudada} replace />
  return (
    <>
      <h1>Catálogos</h1>
      <h2>Depósitos</h2>
      <Depositos />
      <h2>Categorías de compras</h2>
      <Categorias sectores={sectores.lista} />
    </>
  )
}

// ---------- Depósitos ----------

function Depositos() {
  const c = useConsulta<Deposito[]>('/depositos', { todos: true })
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [ok, setOk] = useState<string | null>(null)
  const crear = useAccion(() => post<Deposito>('/depositos', { nombre, descripcion }))
  const agregar = async () => {
    setOk(null)
    const d = await crear.ejecutar()
    if (d) {
      setOk(`«${d.nombre}» agregado. Ya aparece en Stock para transferir y en Producción para guardar.`)
      setNombre('')
      setDescripcion('')
    }
  }
  return (
    <>
      <p className="suave">
        El stock de cada producto está repartido en depósitos. Las ventas de caja descuentan de «Directo a Venta»; lo
        cocinado entra ahí y lo guardado va a «Frío» (o al depósito que se elija). Los envíos salen de «Para sucursales» y
        las compras de materia prima entran en «Materia prima». Esos cuatro se pueden renombrar pero no desactivar.
      </p>
      <ConDatos consulta={c}>
        {(lista) => (
          <ListaConInactivos
            items={lista}
            vacio="Todavía no hay depósitos."
            textoInactivos="Depósitos desactivados"
            render={(d) => (
              <FilaEditable
                key={d.id}
                titulo={d.nombre}
                detalle={<>{d.descripcion}{d.sistema && <span className="etiqueta">Del sistema</span>}</>}
                activo={d.activo}
                campos={[
                  { clave: 'nombre', etiqueta: 'Nombre', valor: d.nombre, max: 60 },
                  { clave: 'descripcion', etiqueta: 'Descripción', valor: d.descripcion, max: 200 },
                ]}
                textoEditar="Editar"
                guardar={(cambios) => patch(`/depositos/${d.id}`, cambios)}
                cambiarActivo={d.sistema ? undefined : (activo) => patch(`/depositos/${d.id}`, { activo })}
              />
            )}
          />
        )}
      </ConDatos>
      <FormAlta titulo="Nuevo depósito" enviando={crear.enviando} error={crear.error} ok={ok} alEnviar={() => void agregar()}>
        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Cámara 2" />
        </label>
        <label className="campo">
          <span>Descripción <span className="opcional">opcional</span></span>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} placeholder="Freezer del fondo" />
        </label>
      </FormAlta>
    </>
  )
}

// ---------- Categorías de compras (M10) ----------

function Categorias({ sectores }: { sectores: Sector[] }) {
  const c = useConsulta<Categoria[]>('/categorias', { todos: true })
  const [nombre, setNombre] = useState('')
  const [elegidos, setElegidos] = useState<SectorId[]>([])
  const [ok, setOk] = useState<string | null>(null)
  const crear = useAccion(() => post<Categoria>('/categorias', { nombre, sectores: elegidos }))
  const agregar = async () => {
    setOk(null)
    const k = await crear.ejecutar()
    if (k) {
      setOk(`«${k.nombre}» agregada. Asignala a los productos en la pantalla Productos.`)
      setNombre('')
      setElegidos([])
    }
  }
  const nombres = (ids: SectorId[]) => ids.map((id) => sectores.find((s) => s.id === id)?.nombre ?? id).join(', ')
  return (
    <>
      <p className="suave">
        Cada producto puede tener una categoría (por ejemplo, «Bebidas» o «Insumos de limpieza»). Los sectores marcados en
        una categoría pueden cargar compras de los productos de su sector con esa categoría. El supervisor y el
        administrador compran cualquier producto.
      </p>
      <ConDatos consulta={c}>
        {(lista) => (
          <ListaConInactivos
            items={lista}
            vacio="Todavía no hay categorías."
            textoInactivos="Categorías desactivadas"
            render={(k) => (
              <FilaEditable
                key={k.id}
                titulo={k.nombre}
                detalle={k.sectores.length ? `Compran: ${nombres(k.sectores)}` : 'Ningún sector la compra (solo supervisor y admin)'}
                activo={k.activo}
                campos={[{ clave: 'nombre', etiqueta: 'Nombre', valor: k.nombre, max: 60 }]}
                guardar={(cambios) => patch(`/categorias/${k.id}`, cambios)}
                cambiarActivo={(activo) => patch(`/categorias/${k.id}`, { activo })}
                debajo={k.activo && <SectoresCategoria k={k} sectores={sectores} />}
              />
            )}
          />
        )}
      </ConDatos>
      <FormAlta titulo="Nueva categoría" enviando={crear.enviando} error={crear.error} ok={ok} alEnviar={() => void agregar()}>
        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Bebidas" />
        </label>
        <div className="ancho">
          <span className="chico">Sectores que pueden comprarla</span>
          <SectoresCheck elegidos={elegidos} sectores={sectores} alCambiar={setElegidos} permitirVacio />
        </div>
      </FormAlta>
    </>
  )
}

function SectoresCategoria({ k, sectores }: { k: Categoria; sectores: Sector[] }) {
  const cambiar = useAccion((v: SectorId[]) => patch<Categoria>(`/categorias/${k.id}`, { sectores: v }))
  return (
    <>
      <SectoresCheck elegidos={k.sectores} sectores={sectores} alCambiar={(v) => void cambiar.ejecutar(v)} deshabilitado={cambiar.enviando} permitirVacio />
      <Aviso>{cambiar.error}</Aviso>
    </>
  )
}
