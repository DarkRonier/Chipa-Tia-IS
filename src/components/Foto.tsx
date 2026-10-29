// Fotos de lecturas de máquinas y reportes de limpieza (F03, G06): elegir o sacar la foto al cargar,
// y verla después solo a pedido (la foto no viaja con los listados).
import { useEffect, useState, type ChangeEvent } from 'react'
import { achicarFoto, useFoto } from '../cliente/foto'
import { Cargando } from './Estado'
import '../styles/controles.css'

/** «Sacar foto» / «Elegir de la galería» y, ya elegida, la vista previa con «Quitar foto». */
export function CampoFoto({ foto, alCambiar, alError, alOcupado }: {
  foto: string | null
  /** Foto nueva ya achicada, o null al quitarla. */
  alCambiar: (foto: string | null) => void
  alError: (mensaje: string) => void
  /** Avisa si se está preparando la foto (para no guardar a medias). */
  alOcupado?: (ocupado: boolean) => void
}) {
  const [achicando, setAchicando] = useState(false)
  const elegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setAchicando(true)
    alOcupado?.(true)
    try {
      alCambiar(await achicarFoto(archivo))
    } catch (err) {
      alError(err instanceof Error ? err.message : 'No se pudo leer la foto. Probá con otra.')
    } finally {
      setAchicando(false)
      alOcupado?.(false)
    }
  }
  return (
    <div className="campo">
      <span>Foto (opcional)</span>
      {foto ? (
        <div className="ctl-foto-vista">
          <img src={foto} alt="Foto adjunta" className="foto" />
          <button type="button" className="btn-texto" onClick={() => alCambiar(null)}>Quitar foto</button>
        </div>
      ) : (
        <div className="ctl-foto-botones">
          <label className={achicando ? 'btn-secundario ctl-archivo apagado' : 'btn-secundario ctl-archivo'}>
            Sacar foto
            <input type="file" accept="image/*" capture="environment" className="ctl-oculto" disabled={achicando} onChange={(e) => void elegir(e)} />
          </label>
          <label className={achicando ? 'btn-secundario ctl-archivo apagado' : 'btn-secundario ctl-archivo'}>
            Elegir de la galería
            <input type="file" accept="image/*" className="ctl-oculto" disabled={achicando} onChange={(e) => void elegir(e)} />
          </label>
        </div>
      )}
      {achicando && <Cargando texto="Preparando la foto…" />}
    </div>
  )
}

/**
 * Botón «Ver foto» de un registro que tiene foto: recién al tocarlo se pide al servidor (`ruta`, por ejemplo
 * `/limpiezas/:id/foto`). Después se muestra como miniatura que, al tocarla, se abre grande.
 */
export function FotoBajoDemanda({ ruta, alt }: { ruta: string; alt: string }) {
  const [pedida, setPedida] = useState(false)
  const { dataUrl, error } = useFoto(pedida ? ruta : null)
  const [abierta, setAbierta] = useState(false)
  if (!pedida) {
    return <button type="button" className="btn-texto" onClick={() => setPedida(true)}>Ver foto</button>
  }
  if (error) return <span className="error chico">{error}</span>
  if (!dataUrl) return <span className="ctl-foto-cargando suave chico">Cargando foto…</span>
  return (
    <>
      <button type="button" className="ctl-foto-mini" onClick={() => setAbierta(true)} aria-label="Ver la foto grande">
        <img src={dataUrl} alt={alt} className="foto-mini" />
      </button>
      {abierta && <VisorFoto src={dataUrl} alt={alt} alCerrar={() => setAbierta(false)} />}
    </>
  )
}

function VisorFoto({ src, alt, alCerrar }: { src: string; alt: string; alCerrar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [alCerrar])
  return (
    <div className="ctl-visor" role="dialog" aria-modal="true" aria-label="Foto" onClick={alCerrar}>
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="btn-primario" onClick={alCerrar} autoFocus>Cerrar</button>
    </div>
  )
}
