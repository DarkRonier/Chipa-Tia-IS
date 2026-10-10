# Backlog para cerrar el sistema

Estado de partida: los 9 módulos (A–I) están en la rama `first-complete` (PR #2), con 196 pruebas
pasando, la prueba automática del anexo (`tests/anexo.test.ts`) y la revisión de seguridad hecha.
Lo que sigue son los tickets pendientes. Cada uno dice qué archivos toca, qué tiene que lograr y
cómo se comprueba. "Modelo" indica quién lo hace: Haiku para lo acotado y repetitivo, Sonnet para lo que
pide criterio o toca varias piezas.

Reglas para todos los tickets: no hacer commit ni push (lo hace quien coordina); no instalar paquetes; tocar
solo los archivos del ticket; textos de pantalla en castellano con voseo ("Elegí", "Cargá"); al terminar
correr `npx tsc -b` y las pruebas del ticket (`npx vitest run tests/<archivo>`), todo en verde.

## Ola 1 (en paralelo, archivos separados)

### T1 · Resumen de prueba con los datos de hoy (H04) · Sonnet
- **Problema**: `POST /reportes/enviar` solo acepta `diario` (ayer), `semanal` y `mensual`. El día de la entrega el
  correo de prueba no trae los datos cargados ese día, que es lo que el cliente va a querer ver (anexo H04).
- **Lograr**: aceptar `periodo: 'hoy'` = el día de hoy en hora de Paraguay hasta el momento. El asunto y el
  encabezado del correo dicen que es un resumen parcial de hoy ("Resumen de hoy hasta las 15:40"). El enlace
  abre `/#/admin/reportes?desde=<hoy>&hasta=<hoy>`. En modo demo devuelve la vista previa como los demás.
- **Archivos**: `src/server/rutas/reportes.ts`, `src/server/correo.ts` (y `src/shared/tipos.ts` si el tipo
  `Periodo` lo necesita, sin romper `rangoResumen`), `tests/reportes.test.ts`, `docs/api.md` (la fila de
  `/reportes/enviar`).
- **Comprobar**: prueba nueva que carga una producción hoy, pide `periodo: 'hoy'` con `fetch` simulado y verifica
  que el HTML trae esa producción, que el asunto dice "hoy" y que el enlace lleva la fecha de hoy.

### T3 · Limpieza: guardar con tareas sin marcar (G01) · Haiku
- **Problema**: el anexo dice "marcar 3 tareas". La pantalla no deja guardar si falta marcar alguna, y la planilla
  de papel pide no dejar casillas en blanco.
- **Lograr**: en `src/pages/sector/Limpieza.tsx`, si al guardar quedan tareas sin marcar, en lugar de solo
  bloquear se muestra una confirmación en línea (no `window.confirm`): "Quedan N tareas sin marcar. ¿Las
  guardamos como «-» (no se hizo)?" con los botones "Sí, guardar" y "Volver a marcar". Con "Sí" se envían esas
  tareas con marca `-`. La API sigue exigiendo todas las tareas (no se toca el servidor).
- **Archivos**: solo `src/pages/sector/Limpieza.tsx`.
- **Comprobar**: `npx tsc -b`; en la demo (`npx vite --mode demo --port 5203`) entrar como `cocina`, marcar 3
  tareas, guardar, confirmar y ver en el historial las 3 marcadas y el resto con "-".

### T4 · Códigos de lote en mayúsculas en salidas y envíos (E05) · Haiku
- **Problema**: `POST /ajustes` guarda el lote de Chipería en mayúsculas y sin espacios, pero `/salidas` y
  `/envios` lo usan tal cual llega; un lote escrito en minúsculas da "sin stock".
- **Lograr**: en `src/server/rutas/stock.ts`, normalizar el lote igual que en `/ajustes` (recortar espacios y pasar
  a mayúsculas) en salidas y envíos, reutilizando la misma función.
- **Archivos**: `src/server/rutas/stock.ts`, `tests/stock.test.ts`.
- **Comprobar**: prueba nueva: lote `CH-261009-1` con stock; salida y envío con `ch-261009-1 ` funcionan y descuentan
  de ese lote.

### T5 · Índices para consultas con muchos datos · Haiku
- **Problema**: el stock por lote (`leerLotesChipa`) filtra `movimientos` por `sector` y `lote`, y no hay índice para
  eso. Con años de datos D1 leería muchas filas.
- **Lograr**: `migrations/0003_indices.sql` con `CREATE INDEX IF NOT EXISTS`: `movimientos(sector, lote)`,
  `lecturas(fuera_de_rango, dia)`, `limpiezas(area_id, dia)`, `auditoria(fecha)`, `movimientos(tipo, dia)`.
  Comentario en castellano arriba explicando para qué es cada uno.
- **Archivos**: solo `migrations/0003_indices.sql` (la demo y las pruebas aplican todas las migraciones solas).
- **Comprobar**: `npx vitest run` completo en verde.

### T7 · Menos consultas por pedido (límite de 50 de D1 gratis) · Sonnet
- **Problema**: Workers Free permite 50 consultas a D1 por pedido. `todasPorTrozos` (`src/server/db.ts`) hace una
  consulta cada 90 ids: `GET /producciones` del administrador con 1000 registros ronda las 38.
- **Lograr**: cambiar `todasPorTrozos` para que haga una sola consulta por lista con
  `IN (SELECT value FROM json_each(?))` pasando la lista como JSON, sin cambiar su firma para quien la llama.
  El callback hoy recibe "?, ?, ?"; ajustar los llamadores que lo necesiten para que reciban el fragmento nuevo.
  Confirmar que sql.js trae JSON1.
- **Archivos**: `src/server/db.ts`, los llamadores en `src/server/consultas.ts` y `src/server/rutas/*.ts` que
  usen `todasPorTrozos`, `tests/consultas.test.ts` (nuevo).
- **Comprobar**: prueba que envuelve la base con un contador de consultas y verifica que `GET /producciones` con
  1000 registros y `GET /lotes-chipa` con 300 lotes usan menos de 15 consultas, con los mismos resultados.
  Toda la suite en verde.

### T8 · Contraseñas con espacios al principio o al final · Haiku
- **Problema**: el administrador puede crear o restablecer una contraseña con espacios al principio o al final,
  pero la entrada los recorta, así que esa contraseña nunca funciona.
- **Lograr**: rechazar con 400 ("La contraseña no puede empezar ni terminar con espacios.") al crear usuario,
  al restablecer y al cambiar la propia; en la entrada no recortar la contraseña (sí el usuario).
- **Archivos**: `src/server/rutas/usuarios.ts`, `src/server/rutas/auth.ts`, `tests/usuarios.test.ts`.
- **Comprobar**: pruebas nuevas para los tres casos y una entrada correcta con una contraseña que tiene un espacio
  en el medio.

### T9 · Barra superior en una sola línea en el celular · Haiku
- **Problema**: a 390 px de ancho "Chipa Tía" se parte en dos líneas al lado del selector de sector.
- **Lograr**: que la barra entre en una línea a 360 y 390 px sin perder nada (marca más chica o sin salto,
  enlaces compactos). Sin cambiar el aspecto en computadora.
- **Archivos**: `src/components/Layout.tsx`, `src/styles.css`.
- **Comprobar**: capturas con Playwright a 360, 390 y 1280 px como `admin` y como `cocina`, en claro y oscuro.

## Ola 2 (después de la ola 1)

### T2 · Opción "Hoy" en el resumen de prueba · Haiku · depende de T1
- **Lograr**: en `src/pages/admin/Reportes.tsx`, "Enviar resumen de prueba" ofrece "Hoy (lo cargado hasta ahora)"
  como primera opción y elegida por defecto, que envía `{ periodo: 'hoy' }`.
- **Comprobar**: en la demo como `admin`, enviar con "Hoy" muestra la vista previa con los datos de hoy.

### T6 · Tareas automáticas separadas en dos horarios · Sonnet
- **Problema**: el cron diario manda los resúmenes y además, los lunes, la copia semanal. Un lunes que cae día 1
  supera las 50 consultas por ejecución de Workers Free.
- **Lograr**: dos disparadores en `wrangler.jsonc`: `0 9 * * *` (resúmenes: diario siempre, semanal los lunes,
  mensual el día 1) y `30 9 * * 1` (copia semanal y borrado de sesiones vencidas). `src/worker/index.ts` pasa
  `evento.cron` a `tareasProgramadas`, que decide qué hacer según el disparador (sin disparador, como en las
  pruebas, hace todo como ahora).
- **Archivos**: `wrangler.jsonc`, `src/worker/index.ts`, `src/server/programado.ts`, `tests/programado.test.ts`
  (nuevo).
- **Comprobar**: pruebas que cuentan consultas: el peor caso (lunes día 1) queda por debajo de 50 en cada
  disparador; las sesiones vencidas se borran y las vigentes no.

### T10 · Guía de despliegue: límites del plan gratuito · Haiku · depende de T6
- **Lograr**: agregar a `docs/despliegue.md`: (1) Workers Free da 10 ms de CPU por pedido y la contraseña usa
  PBKDF2 con 100.000 iteraciones; cómo darse cuenta (error 1102 al entrar) y qué hacer (bajar `ITERACIONES` en
  `src/server/clave.ts`: las contraseñas ya guardadas siguen andando porque cada una guarda su número; o pasar a
  Workers Paid con aprobación del cliente); (2) recomendar una regla de límite de pedidos de Cloudflare para
  `/api/auth/login`; (3) los dos disparadores de T6 y qué hace cada uno.

## Ola 3

### T11 · Recorrido del anexo en pantalla · Sonnet
- **Lograr**: seguir la planilla de comprobación del anexo (A01 a I05) en la demo, como el día de la entrega, con
  Playwright: operadores a 390×844, administrador a 390 y 1366, con las cantidades encadenadas. Para cada ítem,
  resultado y captura. Revisar también: sin errores en la consola, sin desborde horizontal, tema oscuro legible,
  fechas en formato y hora de Paraguay, y Excel (H03, I03) que abren bien. Corregir los errores de pantalla que
  encuentre (`src/pages`, `src/components`, `src/styles`); los de la API se reportan.
- **Entrega**: tabla de A01 a I05 con pasa/no pasa y notas.

## Verificación (coordinador)

Después de cada ola: `npx tsc -b`, `npx vitest run`, `npx vite build --mode demo`, `npm run build`,
`npx wrangler deploy --dry-run`, revisar el diff de cada ticket, commit y push al PR #2.
