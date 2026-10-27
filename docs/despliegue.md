# Puesta en línea

Hay dos formas de publicar el sistema. Las dos usan exactamente el mismo código de pantallas y de API.

| | Demo (GitHub Pages) | Sistema real (Cloudflare) |
|---|---|---|
| Para qué | Mostrar y probar | Usar en la planta |
| Dónde viven los datos | En el navegador de cada persona (IndexedDB) | Base central Cloudflare D1 (I01) |
| Fotos y copias | En la misma base del navegador | Cloudflare R2 |
| Correos | Solo vista previa | Resend |
| Costo | Gratis | Planes gratuitos + dominio (US$ 0,92/mes) |

## 1. Demo en GitHub Pages

La demo corre la API completa dentro del navegador (SQLite en WebAssembly), con datos de ejemplo y
usuarios `chiperia`, `chipitas`, `panaderia`, `cocina` y `admin` (contraseña `1234`). Lo que se carga queda solo
en ese navegador; "Reiniciar datos de ejemplo" (al pie de la pantalla) vuelve al estado inicial.

1. El repositorio tiene que ser público (o la cuenta tener GitHub Pro).
2. El workflow `.github/workflows/pages.yml` construye la demo (`npm run build:pages`) y la sube a la rama
   `gh-pages` en cada push a `main` (y a `first-complete` mientras dure la revisión).
3. Una sola vez: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / (root)**.
4. Queda en `https://<usuario>.github.io/Chipa-Tia-IS/`.

## 2. Sistema real en Cloudflare

Las cuentas se crean a nombre de Chipa Tía EAS (sección 7 del presupuesto).

### Publicación automática desde GitHub (recomendada)

El workflow `.github/workflows/cloudflare.yml` publica el sistema en cada push a `main`: corre las pruebas,
crea la base D1 y el bucket R2 si no existen, aplica las migraciones y publica el Worker. Una sola vez:

1. Crear la cuenta de Cloudflare y activar R2 (**R2 Object Storage → Activar**; el plan gratuito alcanza).
2. Crear un token en **My Profile → API Tokens → Create Token → plantilla "Edit Cloudflare Workers"**, agregándole
   el permiso **Account → D1 → Edit**. Copiar también el **Account ID** (aparece en la página de inicio de Workers).
3. En GitHub, **Settings → Secrets and variables → Actions**:
   - *Secrets*: `CLOUDFLARE_API_TOKEN` (el token), `ADMIN_CLAVE_INICIAL` (contraseña inicial del admin, mínimo 6
     caracteres) y, para los correos, `RESEND_API_KEY`.
   - *Variables*: `CLOUDFLARE_ACCOUNT_ID` y, para los correos, `CORREO_REMITENTE` (por ejemplo
     `Chipa Tía <reportes@chipatia.com>`).
4. **Actions → Publicar en Cloudflare → Run workflow**, marcando "Crear o reiniciar el usuario admin". Queda en
   `https://chipa-tia.<subdominio>.workers.dev` hasta conectar el dominio. El admin entra con `ADMIN_CLAVE_INICIAL`
   y elige su propia contraseña.

Sin `CLOUDFLARE_ACCOUNT_ID` el workflow no hace nada. Para reiniciar la contraseña del admin, cambiar el secreto y
volver a correrlo con la casilla marcada.

### Publicación a mano

```bash
npm install
npx wrangler login                          # con la cuenta de Cloudflare de Chipa Tía
npx wrangler d1 create chipa-tia            # copiar el database_id que devuelve a wrangler.jsonc
npx wrangler r2 bucket create chipa-tia-archivos
npm run db:migrar                           # crea las tablas y el catálogo inicial (migrations/)
npm run crear-admin -- 'una-clave-segura' --remoto   # usuario "admin"; elige la suya al entrar
npx wrangler secret put RESEND_API_KEY      # clave de Resend para los correos (H04)
npm run deploy                              # compila y publica el Worker con la app
```

Después, entrando como `admin`:

- **Datos → Configuración**: correo que recibe los resúmenes y la dirección pública del sistema (para el enlace del correo).
- **Usuarios**: crear un usuario por sector con su contraseña. Solo el administrador cambia contraseñas: si alguien
  la olvida, se la restablece desde Usuarios.
- **Catálogos**: ajustar productos, máquinas y rangos, áreas y tareas de limpieza y sucursales según el relevamiento.
- **Stock**: cargar el stock en frío existente como "Stock inicial" (D07).

### Correos (H04)

- Resend necesita un dominio propio verificado (registros DNS que indica Resend). Con el dominio comprado,
  cambiar `CORREO_REMITENTE` en `wrangler.jsonc` (por ejemplo `Chipa Tía <reportes@chipatia.com>`) y volver a publicar.
- El resumen diario de ayer sale a las 06:00 (Paraguay); los lunes además el semanal, y el día 1 el mensual
  (ver "Tareas automáticas" más abajo). "Reportes → Enviar resumen de prueba" lo manda en el momento.

### Copias de seguridad

- **I02, últimos 7 días**: Cloudflare D1 Time Travel viene activo en todas las bases y no hay que configurarlo.
  Para volver a un minuto: `npx wrangler d1 time-travel restore chipa-tia --timestamp=<fecha ISO>`
  (`npx wrangler d1 time-travel info chipa-tia` muestra el punto disponible).
- **I05, copia semanal**: los lunes, a las 06:30 (Paraguay), el Worker guarda en R2 (`copias/`) un JSON con todas las tablas.
  "Datos → Hacer copia ahora" genera una a mano y se puede descargar.

### Dominio

Comprar el dominio (Porkbun u otro), apuntarlo a Cloudflare y agregarlo como *Custom Domain* del Worker
`chipa-tia` (Workers & Pages → chipa-tia → Settings → Domains & Routes).

### Tareas automáticas

El Worker tiene dos disparadores, definidos en `wrangler.jsonc` (`triggers.crons`). Las horas son de Paraguay (UTC-3):

| Disparador | Hora | Qué hace |
|---|---|---|
| `0 9 * * *` | 06:00, todos los días | Resúmenes por correo: el diario siempre, el semanal los lunes y el mensual el día 1. |
| `30 9 * * 1` | 06:30, los lunes | Copia semanal de la base a R2 (I05) y borrado de las sesiones vencidas. |

Están separados a propósito: Workers Free permite 50 consultas a D1 por ejecución, y juntos, un lunes que cae día 1,
pasaban ese límite. Si se cambia un horario, cambiar la expresión en `wrangler.jsonc` y las constantes
`CRON_RESUMENES` y `CRON_COPIA` de `src/server/programado.ts` a la vez (tienen que quedar iguales), y volver a publicar.
Si no coinciden, el disparador nuevo no hace nada.

### Límites del plan gratuito

Workers Free da 10 ms de CPU por pedido. La entrada usa PBKDF2-SHA256 con 100.000 iteraciones
(`src/server/clave.ts`, constante `ITERACIONES`). Cada contraseña guarda su número de iteraciones dentro del hash
(`pbkdf2$iteraciones$sal$hash`).

Cómo se nota: al entrar aparece el error 1102 ("Worker exceeded resource limits").

Qué hacer, una de estas dos opciones:

- **Bajar las iteraciones.** Cambiar `ITERACIONES` en `src/server/clave.ts` (por ejemplo, a 50.000) y volver a publicar
  con `npm run deploy`. Las contraseñas ya guardadas siguen funcionando, porque cada una usa el número que tiene
  guardado. Las nuevas o las cambiadas usan el nuevo. Costo: con menos iteraciones, el hash resiste menos si alguien
  llega a la base; por eso conviene el límite de pedidos de más abajo.
- **Pasar a Workers Paid** (US$ 5 por mes, 30 s de CPU por pedido). Solo con aprobación del cliente. Cambia la fila
  "Costo" de la tabla del principio.

Después de publicar, probar la entrada enseguida, como `admin` y como un usuario común.

**Límite de pedidos para la entrada.** Recomendamos una regla de límite de pedidos de Cloudflare para
`/api/auth/login`, para frenar intentos de adivinar contraseñas. Las reglas son del dominio, así que se crean una vez
que el dominio propio está en Cloudflare (no aplican a la dirección `workers.dev`). En el panel del dominio, ir a
**Security → WAF → Rate limiting rules** y crear una regla:

- Si la ruta (*URI Path*) es igual a `/api/auth/login`.
- Contar por IP; en el plan gratuito el período es de 10 segundos: poner 3 pedidos cada 10 segundos.
- Acción: bloquear (*Block*). En el plan gratuito el bloqueo dura 10 segundos, que alcanza para frenar
  un programa que prueba contraseñas sin molestar a quien se equivocó al escribir.

El plan gratuito permite una sola regla de este tipo, así que conviene reservarla para esta. Si el panel ofrece
otros períodos o duraciones (planes pagos), 10 pedidos por minuto y 10 minutos de bloqueo es una buena medida.

## Desarrollo local

```bash
npm run dev          # demo en http://localhost:5173 (API dentro del navegador)
npm test             # pruebas de la API (incluye la planilla de comprobación del anexo)
npm run dev:worker   # Worker local con D1 local (antes: npx wrangler d1 migrations apply chipa-tia --local
                     #  y npm run crear-admin -- <clave>)
```
