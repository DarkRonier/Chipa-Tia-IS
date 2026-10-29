// Imprimir o guardar como PDF (H06, H09) con el diálogo de impresión del navegador: sin librerías.
// La hoja de estilos de impresión (styles/impresion.css) deja solo el contenido; acá se arma el nombre
// del archivo, porque los navegadores usan el título de la página como nombre sugerido del PDF.
const MARCA = 'Chipa Tía'

/** Saca lo que no puede ir en el nombre de un archivo y junta los espacios. */
export function nombreSeguro(texto: string): string {
  return texto.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** «Reporte Chipa Tía 2026-10-01 a 2026-10-31» (un solo día: «Reporte Chipa Tía 2026-10-01»; con sector, al final). */
export function nombreArchivoReporte(desde: string, hasta: string, sector?: string): string {
  const periodo = desde === hasta ? desde : `${desde} a ${hasta}`
  return nombreSeguro(`Reporte ${MARCA} ${periodo}${sector ? ` ${sector}` : ''}`)
}

/** «Trazabilidad Chipa Tía lote CH-261010-1». */
export function nombreArchivoTrazabilidad(que: string): string {
  return nombreSeguro(`Trazabilidad ${MARCA} ${que}`)
}

/**
 * Abre el diálogo de impresión (ahí se elige «Guardar como PDF»). Mientras tanto la página se llama `titulo`
 * para que el PDF salga con ese nombre; al terminar se vuelve al título de antes.
 */
export function imprimir(titulo: string): void {
  const anterior = document.title
  const restaurar = () => {
    document.title = anterior
    window.removeEventListener('afterprint', restaurar)
  }
  window.addEventListener('afterprint', restaurar)
  document.title = titulo
  window.print()
}
