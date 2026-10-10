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

```bash
npm install
npx wrangler login                          # con la cuenta de Cloudflare de Chipa Tía
npx wrangler d1 create chipa-tia            # copiar el database_id que devuelve a wrangler.jsonc
npx wrangler r2 bucket create chipa-tia-archivos
npm run db:migrar                           # crea las tablas y el catálogo inicial (migrations/)
npm run crear-admin -- 'una-clave-segura' --remoto   # usuario "admin"; pide cambiarla al entrar
npx wrangler secret put RESEND_API_KEY      # clave de Resend para los correos (H04)
npm run deploy                              # compila y publica el Worker con la app
```

Después, entrando como `admin`:

- **Datos → Configuración**: correo que recibe los resúmenes y la dirección pública del sistema (para el enlace del correo).
- **Usuarios**: crear un usuario por sector con contraseña inicial (cada uno la cambia al entrar).
- **Catálogos**: ajustar productos, máquinas y rangos, áreas y tareas de limpieza y sucursales según el relevamiento.
- **Stock**: cargar el stock en frío existente como "Stock inicial" (D07).

### Correos (H04)

- Resend necesita un dominio propio verificado (registros DNS que indica Resend). Con el dominio comprado,
  cambiar `CORREO_REMITENTE` en `wrangler.jsonc` (por ejemplo `Chipa Tía <reportes@chipatia.com>`) y volver a publicar.
- El cron `0 9 * * *` (06:00 en Paraguay) envía el resumen diario de ayer; los lunes además el semanal y la copia
  semanal; el día 1 además el mensual. "Reportes → Enviar resumen de prueba" lo manda en el momento.

### Copias de seguridad

- **I02, últimos 7 días**: Cloudflare D1 Time Travel viene activo en todas las bases y no hay que configurarlo.
  Para volver a un minuto: `npx wrangler d1 time-travel restore chipa-tia --timestamp=<fecha ISO>`
  (`npx wrangler d1 time-travel info chipa-tia` muestra el punto disponible).
- **I05, copia semanal**: los lunes el Worker guarda en R2 (`copias/`) un JSON con todas las tablas.
  "Datos → Hacer copia ahora" genera una a mano y se puede descargar.

### Dominio

Comprar el dominio (Porkbun u otro), apuntarlo a Cloudflare y agregarlo como *Custom Domain* del Worker
`chipa-tia` (Workers & Pages → chipa-tia → Settings → Domains & Routes).

## Desarrollo local

```bash
npm run dev          # demo en http://localhost:5173 (API dentro del navegador)
npm test             # pruebas de la API (incluye la planilla de comprobación del anexo)
npm run dev:worker   # Worker local con D1 local (antes: npx wrangler d1 migrations apply chipa-tia --local
                     #  y npm run crear-admin -- <clave>)
```
