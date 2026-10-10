// A01–A04: el administrador crea usuarios, cambia nombre y rol, desactiva/activa y restablece contraseñas.
import { useState, type FormEvent } from 'react'
import { patch, post } from '../../cliente/api'
import { nombreRol, useSectores } from '../../cliente/catalogo'
import { useAccion, useConsulta } from '../../cliente/consultas'
import { useUsuario } from '../../cliente/sesion'
import { Aviso, ConDatos } from '../../components/Estado'
import { diaLegible, diaPY } from '../../shared/hora'
import { ROLES, type Rol, type Usuario } from '../../shared/tipos'
import '../../styles/catalogos.css'

const CLAVE_MINIMA = 6

type NombreDeRol = (r: Rol) => string

export default function Usuarios() {
  const yo = useUsuario()
  const consulta = useConsulta<Usuario[]>('/usuarios')
  const sectores = useSectores()
  const rolTexto: NombreDeRol = (r) => nombreRol(r, sectores.nombre)

  return (
    <>
      <h1>Usuarios</h1>
      <p className="suave chico">
        Hay 5 roles: uno por cada sector ({sectores.lista.map((s) => s.nombre).join(', ')}) y el administrador.
        Cada encargado ve y carga solo los datos de su sector.
      </p>
      <ConDatos consulta={consulta}>
        {(lista) => (
          // Una sola lista (activos primero, como la ordena la API): al activar o desactivar la fila no se rearma.
          <div className="lista-cat">
            {lista.map((u) => <FilaUsuario key={u.id} u={u} esYo={u.id === yo.id} rolTexto={rolTexto} />)}
          </div>
        )}
      </ConDatos>
      <NuevoUsuario rolTexto={rolTexto} />
    </>
  )
}

type Modo = null | 'editar' | 'clave' | 'desactivar'

function FilaUsuario({ u, esYo, rolTexto }: { u: Usuario; esYo: boolean; rolTexto: NombreDeRol }) {
  const [modo, setModo] = useState<Modo>(null)
  const [nombre, setNombre] = useState(u.nombre)
  const [rol, setRol] = useState<Rol>(u.rol)
  const [clave, setClave] = useState('')
  const [hecho, setHecho] = useState<string | null>(null)
  const cambiar = useAccion((cuerpo: Partial<Pick<Usuario, 'nombre' | 'rol' | 'activo'>>) => patch<Usuario>(`/usuarios/${u.id}`, cuerpo))
  const restablecer = useAccion((nueva: string) => post<{ ok: boolean }>(`/usuarios/${u.id}/clave`, { clave: nueva }))
  const enviando = cambiar.enviando || restablecer.enviando

  const abrir = (m: Modo) => {
    setModo(m)
    setHecho(null)
    setNombre(u.nombre)
    setRol(u.rol)
    setClave('')
    cambiar.limpiarError()
    restablecer.limpiarError()
  }

  const guardar = async (e: FormEvent) => {
    e.preventDefault()
    const cuerpo: { nombre?: string; rol?: Rol } = {}
    if (nombre.trim() !== u.nombre) cuerpo.nombre = nombre
    if (rol !== u.rol) cuerpo.rol = rol
    if (!cuerpo.nombre && !cuerpo.rol) return setModo(null)
    if (await cambiar.ejecutar(cuerpo)) {
      setModo(null)
      setHecho(cuerpo.rol ? `Listo. ${u.usuario} ahora es ${rolTexto(cuerpo.rol)}; la próxima vez que entre ve su nuevo sector.` : 'Nombre guardado.')
    }
  }

  const guardarClave = async (e: FormEvent) => {
    e.preventDefault()
    if (await restablecer.ejecutar(clave)) {
      setModo(null)
      setHecho(`Contraseña restablecida. ${u.usuario} entra con «${clave}» y al entrar la tiene que cambiar.`)
      setClave('')
    }
  }

  const activar = async (activo: boolean) => {
    if (await cambiar.ejecutar({ activo })) {
      setModo(null)
      setHecho(activo ? `${u.usuario} puede volver a entrar.` : null)
    }
  }

  return (
    <div className={`fila-cat${u.activo ? '' : ' inactiva'}`}>
      <div>
        <div className="cabeza">
          <span className="nombre">{u.nombre}{esYo && ' (vos)'}</span>
          <span className="etiqueta">{rolTexto(u.rol)}</span>
          {!u.activo && <span className="etiqueta apagada">Desactivado</span>}
          {u.activo && u.debeCambiarClave && <span className="etiqueta aviso-clave">Debe cambiar la contraseña</span>}
        </div>
        <div className="detalle">Usuario: <strong>{u.usuario}</strong> · creado el {diaLegible(diaPY(u.creadoEn))}</div>
      </div>

      {modo === null && (
        <div className="acciones-cat">
          <button type="button" className="btn-texto" onClick={() => abrir('editar')}>{esYo ? 'Cambiar nombre' : 'Editar'}</button>
          {!esYo && u.activo && (
            <>
              <button type="button" className="btn-texto" onClick={() => abrir('clave')}>Restablecer contraseña</button>
              <button type="button" className="btn-texto" onClick={() => abrir('desactivar')}>Desactivar</button>
            </>
          )}
          {!u.activo && (
            <button type="button" className="btn-texto" disabled={enviando} onClick={() => void activar(true)}>
              {enviando ? 'Activando…' : 'Activar'}
            </button>
          )}
        </div>
      )}

      {modo === 'editar' && (
        <form className="editor" onSubmit={guardar}>
          <label className="campo">
            <span>Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus maxLength={80} />
          </label>
          <label className="campo">
            <span>Rol</span>
            <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} disabled={esYo}>
              {ROLES.map((r) => <option key={r} value={r}>{rolTexto(r)}</option>)}
            </select>
          </label>
          {esYo && <p className="pista-campo ancho">No podés quitarte el rol de administrador.</p>}
          {!esYo && rol !== u.rol && <p className="pista-campo ancho">Al cambiarle el rol se cierra su sesión y vuelve a entrar con el sector nuevo.</p>}
          <div className="botones-cat">
            <button className="btn-primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn-texto" onClick={() => abrir(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {modo === 'clave' && (
        <form className="editor" onSubmit={guardarClave}>
          <label className="campo ancho">
            <span>Contraseña nueva para {u.usuario}</span>
            <input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={CLAVE_MINIMA}
            />
            <span className="pista-campo">Mínimo {CLAVE_MINIMA} caracteres. Pasásela a la persona: al entrar la va a tener que cambiar. Se cierra su sesión abierta.</span>
          </label>
          <div className="botones-cat">
            <button className="btn-primario" disabled={enviando || clave.length < CLAVE_MINIMA}>
              {enviando ? 'Guardando…' : 'Guardar contraseña'}
            </button>
            <button type="button" className="btn-texto" onClick={() => abrir(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {modo === 'desactivar' && (
        <div className="confirmar-cat">
          <p>¿Desactivar a <strong>{u.nombre}</strong>? No va a poder entrar y se cierra su sesión. Lo que cargó queda en el historial.</p>
          <div className="botones-cat">
            <button type="button" className="btn-primario peligro" disabled={enviando} onClick={() => void activar(false)}>
              {enviando ? 'Desactivando…' : 'Sí, desactivar'}
            </button>
            <button type="button" className="btn-texto" onClick={() => abrir(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <Aviso>{cambiar.error ?? restablecer.error}</Aviso>
      {hecho && modo === null && <Aviso tipo="ok">{hecho}</Aviso>}
    </div>
  )
}

function NuevoUsuario({ rolTexto }: { rolTexto: NombreDeRol }) {
  const [nombre, setNombre] = useState('')
  const [usuario, setUsuario] = useState('')
  const [rol, setRol] = useState<Rol | ''>('')
  const [clave, setClave] = useState('')
  const [creado, setCreado] = useState<string | null>(null)
  const crear = useAccion(() => post<Usuario>('/usuarios', { nombre, usuario, rol, clave }))

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setCreado(null)
    const u = await crear.ejecutar()
    if (u) {
      setCreado(`Usuario ${u.usuario} creado (${rolTexto(u.rol)}). Entra con la contraseña que le diste y al entrar la cambia.`)
      setNombre('')
      setUsuario('')
      setRol('')
      setClave('')
    }
  }

  return (
    <form className="form-cat" onSubmit={enviar}>
      <h2>Nuevo usuario</h2>
      <div className="tarjeta filtros">
        <label className="campo">
          <span>Nombre y apellido</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
        </label>
        <label className="campo">
          <span>Usuario (para entrar, sin espacios)</span>
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
          />
        </label>
        <label className="campo">
          <span>Rol</span>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol | '')}>
            <option value="">Elegí…</option>
            {ROLES.map((r) => <option key={r} value={r}>{rolTexto(r)}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Contraseña inicial (mín. {CLAVE_MINIMA})</span>
          <input
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button className="btn-primario" disabled={crear.enviando}>{crear.enviando ? 'Creando…' : 'Crear usuario'}</button>
      </div>
      <Aviso>{crear.error}</Aviso>
      {creado && <Aviso tipo="ok">{creado}</Aviso>}
    </form>
  )
}
