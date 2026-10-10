// Tareas automáticas del Worker (cron de Cloudflare, hora UTC; Paraguay es UTC-3):
// resúmenes por correo diario, semanal (lunes) y mensual (día 1) (H04) y copia semanal a R2 (I05).
import type { Env } from './entorno'

export async function tareasProgramadas(_env: Env, _cuando: Date): Promise<void> {
  // Lo completa el módulo de reportes y datos.
}
