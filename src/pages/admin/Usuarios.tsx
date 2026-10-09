import { useState } from 'react'
import { SECTORES, type Rol } from '../../mock/data'
import { nuevoId, useDatos } from '../../mock/store'

const nombreRol = (r: Rol) => (r === 'admin' ? 'Administrador' : SECTORES.find((s) => s.id === r)!.nombre)

export default function Usuarios() {
  const { datos, actualizar, usuario: yo } = useDatos()
  const [nombre, setNombre] = useState('')
  const [usuario, setUsuario] = useState('')
  const [rol, setRol] = useState<Rol>('chiperia')
  const [msg, setMsg] = useState<string | null>(null)

  const crear = () => {
    const u = usuario.trim().toLowerCase()
    if (!nombre.trim() || !u) return setMsg('Completá nombre y usuario.')
    if (datos.usuarios.some((x) => x.usuario === u)) return setMsg('Ese usuario ya existe.')
    actualizar((d) => ({ ...d, usuarios: [...d.usuarios, { id: nuevoId(), nombre: nombre.trim(), usuario: u, rol, activo: true }] }))
    setMsg(`Usuario ${u} creado con contraseña 1234.`)
    setNombre(''); setUsuario('')
  }
  const alternar = (id: string) =>
    actualizar((d) => ({ ...d, usuarios: d.usuarios.map((u) => (u.id === id ? { ...u, activo: !u.activo } : u)) }))

  return (
    <>
      <h1>Usuarios</h1>
      <table className="tabla">
        <thead><tr><th>Persona</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          {datos.usuarios.map((u) => (
            <tr key={u.id} className={u.activo ? '' : 'apagado'}>
              <td>{u.nombre}<div className="suave chico">{u.usuario}</div></td>
              <td>{nombreRol(u.rol)}</td>
              <td>
                {u.id !== yo!.id && <button className="btn-texto" onClick={() => alternar(u.id)}>{u.activo ? 'Desactivar' : 'Activar'}</button>}
                <button className="btn-texto" onClick={() => setMsg(`Contraseña de ${u.usuario} restablecida (en el prototipo sigue siendo 1234).`)}>Restablecer contraseña</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Nuevo usuario</h2>
      <div className="tarjeta filtros">
        <label className="campo"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="campo"><span>Usuario</span><input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoCapitalize="none" /></label>
        <label className="campo">
          <span>Rol</span>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {SECTORES.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button className="btn-primario" onClick={crear}>Crear usuario</button>
      </div>
      {msg && <p className="ok">{msg}</p>}
    </>
  )
}
