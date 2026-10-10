// Registro de cambios hechos por el administrador (correcciones, ajustes, bloqueos, ediciones).
import { ahora, nuevoId, sentencia } from './db'
import type { BaseD1, SentenciaD1 } from './entorno'

export interface CambioAuditado {
  tabla: string
  registroId: string
  /** "crear", "editar", "corregir", "ajustar", "bloquear", "desactivar", ... */
  accion: string
  usuarioId: string
  antes?: unknown
  despues?: unknown
}

/** Sentencia lista para meter en un `batch` junto con el cambio, así quedan juntos o ninguno. */
export function sentenciaAuditoria(db: BaseD1, c: CambioAuditado): SentenciaD1 {
  return sentencia(
    db,
    'INSERT INTO auditoria (id, tabla, registro_id, accion, usuario_id, fecha, antes, despues) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nuevoId(), c.tabla, c.registroId, c.accion, c.usuarioId, ahora().fecha,
    c.antes === undefined ? null : JSON.stringify(c.antes),
    c.despues === undefined ? null : JSON.stringify(c.despues),
  )
}

export async function auditar(db: BaseD1, c: CambioAuditado) {
  await sentenciaAuditoria(db, c).run()
}
