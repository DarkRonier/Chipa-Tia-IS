# API del sistema de producción

Todo vive bajo `/api` y responde JSON. Los tipos de cada cuerpo y respuesta están en
[`src/shared/tipos.ts`](../src/shared/tipos.ts). La misma app de Hono (`src/server/app.ts`) corre en
Cloudflare Workers (D1 + R2), dentro del navegador en la demo de GitHub Pages (sql.js) y en las pruebas.
La planilla de comprobación del anexo está escrita como prueba en [`tests/anexo.test.ts`](../tests/anexo.test.ts).

## Reglas generales

- **Sesión.** Todo salvo `POST /auth/login` y `GET /salud` (`{ ok: true }`) exige `Authorization: Bearer <token>`.
  El token dura 30 días y en la base solo se guarda su hash. Sin sesión válida (falta, venció, se cerró o el
  usuario se desactivó): `401 no_autorizado`. Una ruta desconocida, con sesión, da `404 no_encontrado`.
- **Contraseñas.** Solo el administrador cambia contraseñas: las de los operadores las pone y las restablece él
  (`/usuarios`), y los operadores no pueden cambiar la suya (`POST /auth/clave` da `403`). Un administrador con la
  contraseña inicial o una restablecida (`debeCambiarClave: true`) solo tiene las rutas de `/auth`; el resto da
  `403 debe_cambiar_clave` hasta que la cambie con `POST /auth/clave` (`conClavePropia` en `src/server/sesion.ts`).
  A los operadores nunca se les pide.
- **Errores.** `{ "error": { "codigo": "...", "mensaje": "..." } }`. El `mensaje` se muestra tal cual al usuario,
  en castellano rioplatense/paraguayo y sin jerga ("No hay stock suficiente para esa salida.").

| Estado | Código | Cuándo |
|---|---|---|
| 400 | `datos_invalidos` | Falta un dato o no es válido (el mensaje dice cuál); cuerpo que no es JSON; `desde` posterior a `hasta` |
| 401 | `no_autorizado` | Sin sesión, sesión vencida o cerrada |
| 401 | `credenciales` | Usuario o contraseña incorrectos (el mismo mensaje en los dos casos) |
| 403 | `prohibido` | Otro sector (A03), función de administrador, lotes fuera de Chipería |
| 403 | `usuario_inactivo` | Login de un usuario desactivado |
| 403 | `debe_cambiar_clave` | Un administrador todavía no cambió su contraseña inicial o restablecida |
| 404 | `no_encontrado` | El registro no existe; ruta desconocida |
| 409 | `stock_insuficiente` | Salida, envío, merma o corrección que dejaría negativo el producto o el lote (D04) |
| 409 | `usuario_repetido` | Ya existe ese nombre de usuario |
| 409 | `nombre_repetido` | Producto (en su sector), área, tarea (en su área), sucursal o sector con el mismo nombre, sin distinguir mayúsculas ni tildes; si el otro está desactivado, el mensaje propone activarlo |
| 409 | `numero_repetido` | Otra máquina activa del sector tiene ese N° |
| 409 | `lote_mp_no_disponible` | Producción de Chipería con un lote de materia prima bloqueado, vencido o que ya no existe |
| 409 | `ya_controlada` | La limpieza ya tiene «Controlado por» |
| 413 | `demasiado_grande` | Cuerpo de más de 3 MB |
| 500 | `error_interno` | Error inesperado ("Ocurrió un error inesperado. Probá de nuevo.") |

- **Sector (A03).** Un operador (rol = su sector) solo ve y carga su sector: el servidor fuerza
  `sector = rol` y responde `403` si pide otro (`sectorPara` en `src/server/sesion.ts`); sin `sector`, los
  listados le traen solo lo suyo. Cargar con un producto de otro sector da `400`; con una máquina o un área de
  limpieza de otro sector, `403`. El administrador indica el `sector` al cargar (`400 Indicá el sector.` si falta
  donde hace falta); en los listados, sin `sector` ve todos.
- **Solo administrador** (`soloAdmin`): usuarios, edición de catálogos y sectores, ajustes de stock,
  correcciones de producción, bloqueo de lotes, control de limpieza, reportes, configuración, exportación,
  copias y auditoría.
- **Lotes y trazabilidad (E)** solo para Chipería y el administrador; los otros sectores reciben `403`.
- **Fechas.** `fecha` es ISO en UTC y la pone el servidor (el cliente nunca la manda); `dia` es el día
  calendario en Paraguay (`AAAA-MM-DD`), calculado al guardar. Los filtros `desde`/`hasta` son días inclusivos
  que comparan contra `dia`. Listados: el más nuevo primero, con tope (producciones y limpiezas 1000,
  movimientos y lecturas 2000, auditoría 500).
- **Consultas.** Los filtros sí/no aceptan `1` o `true` (`?disponibles=1`, `?todos=true`).
- **Cantidades.** Enteros: producción ≥ 0, stock > 0 (el servidor pone el signo), hasta 1.000.000.
- **Nada se borra.** Productos, máquinas, áreas, tareas, sucursales, usuarios y lotes de materia prima se
  desactivan o bloquean; el historial los sigue mostrando por nombre. El stock es un libro de movimientos: las
  correcciones son movimientos compensatorios (`ajuste`).
- **Auditoría.** Cada cambio del administrador deja una fila en `auditoria` (con antes/después y quién): altas
  y ediciones de catálogos y usuarios, contraseñas restablecidas, correcciones de producción, ajustes de stock,
  bloqueos de lotes, controles de limpieza, configuración y copias manuales.
- **D04.** El trigger `movimientos_sin_stock_negativo` rechaza cualquier salida que deje negativo el producto
  o el lote. Las rutas lo traducen a `409 stock_insuficiente` diciendo qué falta ("de Empanada frita (carne)
  hay 3 y querés sacar 10"). Varias líneas en un `batch` son atómicas: si una no alcanza, no se guarda ninguna.

## Autenticación (A01)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `PedidoLogin` | `RespuestaLogin` (`401 credenciales`, `403 usuario_inactivo`) |
| GET | `/auth/yo` | | `Usuario` |
| POST | `/auth/logout` | | `{ ok }` (cierra esta sesión) |
| POST | `/auth/clave` | `{ actual, nueva }` | `{ token }` |

- El usuario se compara en minúsculas. Si no existe, el login tarda lo mismo que con la contraseña equivocada.
- `/auth/clave`: solo administradores (un operador recibe `403 prohibido`). `nueva` de al menos 6 caracteres y distinta de la actual; si `actual` no es la correcta,
  `400`. Deja `debeCambiarClave: false`, cierra todas las sesiones del usuario y devuelve un token nuevo.

## Usuarios (A01–A04) · solo admin

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/usuarios` | | `Usuario[]` (incluye inactivos; activos primero, por rol y nombre) |
| POST | `/usuarios` | `{ nombre, usuario, rol, clave }` | `Usuario` (`debeCambiarClave: true` solo si es administrador; `409 usuario_repetido`) |
| PATCH | `/usuarios/:id` | `{ nombre?, rol?, activo? }` | `Usuario` |
| POST | `/usuarios/:id/clave` | `{ clave }` | `{ ok }` |

- `usuario`: de 2 a 40 letras minúsculas, números, punto, guion o guion bajo, sin espacios (se guarda en
  minúsculas). `clave`: al menos 6 caracteres. `rol`: un sector o `admin`.
- `PATCH`: desactivarlo o cambiarle el rol cierra sus sesiones. El administrador no puede desactivarse ni
  quitarse el rol a sí mismo (`403`).
- `/clave` restablece y cierra sus sesiones; a un administrador le deja `debeCambiarClave: true`. Para la propia, `400` (se usa
  `POST /auth/clave`).

## Catálogos (B01–B04)

Lectura para cualquier usuario con sesión: el operador ve solo lo activo de su sector (las sucursales y los
sectores son de todos). Escritura solo admin. `todos=1` incluye inactivos (solo para el administrador).
Los `PATCH` sin ningún campo editable dan `400`.

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/sectores` | | `Sector[]` (los cuatro, en orden) |
| PATCH | `/sectores/:id` | `{ nombre }` | `Sector` |
| GET | `/productos` | `?sector&todos` | `Producto[]` |
| POST | `/productos` | `{ sector, nombre, unidad? }` | `Producto` (`unidad` por defecto `unidades`; queda al final de su sector) |
| PATCH | `/productos/:id` | `{ nombre?, unidad?, activo? }` | `Producto` |
| GET | `/maquinas` | `?sector&todos` | `Maquina[]` (por sector y N°) |
| POST | `/maquinas` | `{ sector, numero?, nombre, tipo, tempMin?, tempMax? }` | `Maquina` |
| PATCH | `/maquinas/:id` | `{ numero?, nombre?, tipo?, tempMin?, tempMax?, activo? }` | `Maquina` |
| GET | `/areas` | `?sector&todos` | `AreaLimpieza[]` con sus tareas (sin `todos`, solo las activas) |
| POST | `/areas` | `{ nombre, codigo?, sectores }` | `AreaLimpieza` |
| PATCH | `/areas/:id` | `{ nombre?, codigo?, sectores?, activo? }` | `AreaLimpieza` (`sectores` reemplaza la lista) |
| POST | `/areas/:id/tareas` | `{ nombre, pideNumero? }` | `TareaLimpieza` (queda al final de la planilla) |
| PATCH | `/tareas/:id` | `{ nombre?, pideNumero?, activo? }` | `TareaLimpieza` |
| GET | `/sucursales` | `?todos` | `Sucursal[]` (por nombre) |
| POST | `/sucursales` | `{ nombre }` | `Sucursal` |
| PATCH | `/sucursales/:id` | `{ nombre?, activo? }` | `Sucursal` |

- Nombres repetidos: `409 nombre_repetido` (ver arriba).
- Máquinas: sin `numero` toma el siguiente al más alto del sector; dos máquinas activas del mismo sector no
  comparten N° (`409 numero_repetido`). `otra` = sin control de temperatura (el rango queda vacío); los demás
  tipos necesitan al menos un límite: un lado puede faltar (freezer ≤ −18 °C, bufetera ≥ 63 °C).
  `tempMin ≤ tempMax`, entre −60 °C y 300 °C, con un decimal. El `PATCH` valida el rango con lo que llega y lo
  que ya tenía.
- Áreas: `sectores` = qué sectores la cargan (al menos uno; las comunes, como Sanitario, tienen varios).

## Producción (C01–C04, E02–E04)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/producciones` | `?sector&desde&hasta` | `Produccion[]` |
| POST | `/producciones` | `PedidoProduccion` | `Produccion` |
| PATCH | `/producciones/:id` | `{ items: [{ productoId, cocinado, guardado }] }` · admin | `Produccion` |

- `POST`: `turno` (`dia` o `noche`) obligatorio. Cada producto una sola vez (hasta 300), enteros ≥ 0; las líneas
  en 0 y 0 no se guardan y tiene que quedar al menos una. Productos activos del sector.
- Lo `guardado` entra al stock en frío como movimiento `produccion` (+guardado); lo `cocinado` va directo a venta.
- **Chipería**: exige `lotesMP` (de 1 a 50 ids; `400` si falta) disponibles (`409 lote_mp_no_disponible` si
  alguno está bloqueado, vencido o no existe) y crea el lote de chipa `CH-AAMMDD-N` (N = número de amasada del
  día, desde 1), con `amasada = N`; los movimientos de stock llevan ese código en `lote`. En los otros sectores
  `lotesMP` se ignora.
- Corrección (C04): **mezcla**, no reemplaza: los productos que no vienen en `items` quedan como estaban; los
  que vienen toman los valores nuevos (0 y 0 deja el producto en cero) y se pueden agregar productos activos
  del sector. Sin cambios, `400`; el registro tiene que quedar con al menos una cantidad. Por cada producto, la
  diferencia de `guardado` se registra como movimiento `ajuste` (con `produccionId`, el lote si es de Chipería y
  motivo "Corrección de producción"); si dejaría negativo, `409 stock_insuficiente`. Guarda
  `corregidoPor`/`corregidoEn` y una fila de `auditoria` (`corregir`, ítems antes y después). El turno y los
  lotes de materia prima no se corrigen.

## Stock en frío (D01–D07)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/stock` | `?sector` (admin: obligatorio) | `StockFila[]` |
| POST | `/salidas` | `PedidoSalida` | `Movimiento` (`salida_venta`, cantidad negativa) |
| POST | `/envios` | `PedidoEnvio` | `RespuestaEnvio` (una línea por ítem, mismo `envioId`, todo o nada) |
| POST | `/ajustes` | `PedidoAjuste` · admin | `Movimiento` |
| GET | `/movimientos` | `?sector&desde&hasta&sucursal&producto&tipo&lote` | `Movimiento[]` |

- `/stock`: los productos activos del sector (aunque estén en 0) y los inactivos con stock ≠ 0. En Chipería,
  `lotes` trae los lotes con cantidad > 0, el más viejo primero; en los demás sectores viene vacío.
- **Chipería exige `lote`** en salidas, envíos (en cada línea) y ajustes (`400` si falta); en los otros
  sectores se ignora. En los ajustes el lote se guarda en mayúsculas.
- Salidas y envíos aceptan productos desactivados del sector (puede quedarles stock).
- `/envios`: sucursal activa (`400` si no existe o está desactivada), de 1 a 100 líneas, sin repetir el mismo
  producto y lote (`400`: hay que juntar las cantidades).
- `/ajustes`: `sector` obligatorio; `tipo` `merma` o `vencimiento` (restan), `stock_inicial` (suma) o `ajuste`
  (suma o resta según `sentido`, obligatorio: `1` o `-1`); `motivo` obligatorio (hasta 300 caracteres). Deja una
  fila de `auditoria` (`ajustar`) con el stock antes y después.
- `/movimientos`: `tipo` acepta varios separados por coma (`?tipo=salida_venta,envio`); `lote` es el código
  exacto.

## Lotes y trazabilidad (E01, E05–E07) · Chipería y admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/lotes-mp` | `?disponibles` | `LoteMP[]` (el ingreso más nuevo primero) |
| POST | `/lotes-mp` | `{ insumo, proveedor, numeroLote?, fechaIngreso, cantidad, unidad?, vencimiento }` | `LoteMP` |
| PATCH | `/lotes-mp/:id` | `{ bloqueado }` · admin | `LoteMP` |
| GET | `/lotes-chipa` | `?desde&hasta` | `LoteChipa[]` (horno, congelador, lo que queda y sus lotes de materia prima) |
| GET | `/trazabilidad/mp/:id` | | `TrazabilidadMP` |
| GET | `/trazabilidad/lote/:codigo` | | `TrazabilidadLote` |
| GET | `/trazabilidad/sucursal/:id` | `?desde&hasta` | `TrazabilidadSucursal` |

- `disponible = !bloqueado && vencimiento ≥ hoy (Paraguay)`; `?disponibles=1` trae solo esos (E07).
  `descripcion` = "Harina · Molinos del Sur · lote 123" (o "ingreso 02/10/2026" si no hay número), como en la planilla.
- `POST /lotes-mp`: `fechaIngreso` no posterior a hoy; `cantidad` > 0 (admite decimales); `unidad` por defecto
  `kg`; `vencimiento` no anterior al ingreso ni a hoy.
- `PATCH /lotes-mp/:id`: bloquea o desbloquea con auditoría (`bloquear`/`desbloquear`); si no cambia nada,
  devuelve el lote como está.
- `/trazabilidad/mp/:id` (hacia adelante): los lotes de chipa que usaron ese lote y sus envíos.
- `/trazabilidad/lote/:codigo`: el código sin distinguir mayúsculas; trae la producción y la materia prima,
  los envíos y en `otrosMovimientos` las salidas, mermas, vencimientos y ajustes del lote. Un lote que solo
  existe en el stock (cargado como stock inicial) viene sin producción ni materia prima (`id` vacío,
  `amasada` 0); sin lote ni movimientos, `404`.
- `/trazabilidad/sucursal/:id` (hacia atrás): **solo los envíos de Chipería** a esa sucursal, sus lotes de chipa
  y los lotes de materia prima de esos lotes.

## Máquinas y temperaturas (F01–F05)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/lecturas` | `?sector&maquina&desde&hasta&fueraDeRango&conFallas` | `Lectura[]` |
| POST | `/lecturas` | `PedidoLectura` | `Lectura` |
| GET | `/lecturas/:id/foto` | | `{ dataUrl }` |

- `conFallas` = estado `con_fallas` o `fuera_de_servicio`.
- `POST`: la máquina tiene que existir (`404`), ser del sector del operador (`403`) y estar activa (`400`).
  Temperatura entre −60 °C y 300 °C (con un decimal), obligatoria si la máquina tiene rango, salvo
  `fuera_de_servicio` (F02). `fueraDeRango` lo calcula el servidor con `tempMin`/`tempMax` (un lado puede ser
  null). `observacion` y `mantenimiento` hasta 500 caracteres; `mantenimientoPor` exige `mantenimiento`.
- Foto opcional: data URL de un JPEG, PNG o WEBP de verdad (se revisa la firma del archivo), ya achicada en el
  navegador, hasta 1,5 MB. Se guarda en R2 (o en la tabla `archivos` en la demo y las pruebas) como
  `fotos/<id>.<ext>`. `/foto`: el operador solo ve las de su sector (`403`); sin foto, `404`.

## Limpieza (G01–G03)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/limpiezas` | `?sector&area&desde&hasta&sinControlar` | `Limpieza[]` (marcas en el orden de la planilla) |
| POST | `/limpiezas` | `PedidoLimpieza` | `Limpieza` |
| POST | `/limpiezas/:id/control` | · admin | `Limpieza` (`409 ya_controlada`) |

- `POST`: el área tiene que existir (`404`), estar activa (`400`) y ser del sector del operador (`403`). El
  administrador indica `sector` cuando el área la cargan varios sectores (`400` si falta).
- Como en la planilla en papel no se dejan cuadros en blanco: **todas** las tareas activas del área se marcan
  una sola vez con `X` (diaria), `XX` (profunda) o `-` (no se hizo); si falta alguna, `400` nombrándola.
  `numero` (hasta 30 caracteres) solo en tareas con `pideNumero` (`400` en las otras) y no se guarda con `-`.
  `comentario` opcional, hasta 500 caracteres.
- `/control` firma el «Controlado por» con auditoría (`controlar`).

## Reportes (H01–H04) · solo admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/reportes` | `?desde&hasta&sector` | `Reporte` |
| GET | `/reportes/serie` | `?desde&hasta` | `SerieReporte` |
| POST | `/reportes/enviar` | `{ periodo? }` | `ResumenCorreo` |

- `/reportes`: sin fechas, el día de hoy; con solo `desde`, ese día. Hasta 1100 días por pedido (unos tres años;
  `400` si es más). `stock` es el stock actual, no el del período; `salidas` es lo que salió del frío en el
  período por sector y tipo, en unidades positivas; `lotesChipa` viene solo sin `sector` o con Chipería.
- `/reportes/serie`: para los gráficos de historial y comparación del Resumen. Mismas reglas de fechas que
  `/reportes` (sin fechas, hoy; hasta 1100 días; `400` si el rango es inválido). Devuelve `dias`, un elemento por
  cada día del rango (también los que no tuvieron nada, en cero) con, por cada sector, `cocinado`, `guardado`
  (unidades guardadas en frío), `enviado` (a sucursales) y `vendido` (sacado a la venta, `salida_venta`), todo en
  unidades positivas. Usa las definiciones de `/reportes`, así que la suma de un rango coincide con
  `totales.unidadesCocinadas`, `unidadesGuardadas`, `unidadesEnviadas` y con la salida `salida_venta` de `salidas`.
  Son dos consultas agrupadas por día y sector, sin importar el largo del rango (`src/server/serie.ts`).
- `/reportes/enviar`: `periodo` `diario` (por defecto), `semanal`, `mensual` u `hoy`. Arma el resumen del período
  que corresponde a hoy, como el envío automático: **diario = ayer**, semanal = de lunes a domingo de la semana
  pasada, mensual = el mes pasado (`rangoResumen` en `src/shared/hora.ts`). `hoy` es solo para la prueba manual
  (el envío automático no lo usa): resumen parcial del día de hoy en hora de Paraguay, con lo cargado hasta ese
  momento; el asunto es `Chipa Tía · Resumen de hoy hasta las HH:MM` y el enlace abre `desde=<hoy>&hasta=<hoy>`. Lo manda con Resend a
  `correoReportes`, con el enlace `<urlPublica>/#/admin/reportes?desde=…&hasta=…`. Nunca falla por el envío:
  devuelve `enviado: false` y el `motivo` (demo, falta el correo, falta `RESEND_API_KEY` o `CORREO_REMITENTE`,
  Resend no lo aceptó o no hubo conexión), con el `asunto` y el `html` para la vista previa.

El Excel (H03, I03) se arma en el navegador con `write-excel-file` a partir de estas respuestas.

## Datos (I01–I05) · solo admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/config` | | `Configuracion` |
| PATCH | `/config` | `Partial<Configuracion>` | `Configuracion` |
| GET | `/exportar` | | `Exportacion` |
| GET | `/copias` | | `Copia[]` (la más nueva primero, hasta 500) |
| POST | `/copias` | | `Copia` (copia manual ahora) |
| GET | `/copias/:clave` | | el JSON de la copia, como descarga |
| GET | `/auditoria` | `?tabla&desde&hasta` | `Auditoria[]` (la más nueva primero, hasta 500) |

- `/config`: `correoReportes` acepta hasta 5 correos separados por coma (se guardan en minúsculas y sin
  repetir); `urlPublica` tiene que ser `http(s)://`, sin usuario ni contraseña, y se guarda sin `?…`, `#…` ni la
  barra final. Vacío o `null` lo borra. Auditoría por cada valor que cambia.
- `/exportar`: todas las tablas (también las que agregue una migración nueva) salvo `sesiones`; `usuarios`
  sale sin `clave_hash` y `archivos` sin `datos` (el contenido de fotos y copias).
- Copias (I05): la misma exportación guardada aparte (R2, o la tabla `archivos` en la demo) con la clave
  `copias/AAAA-MM-DDTHHMMSS.json` (día y hora de Paraguay; `-2`, `-3`… si coinciden en el segundo). La manual
  deja auditoría. `/copias/:clave` acepta la clave con o sin `copias/` y codificada o no; responde con
  `Content-Disposition: attachment`.
- `/auditoria`: `desde`/`hasta` se comparan con el día de Paraguay de cada cambio.

La vuelta atrás a cualquier minuto de los últimos 7 días (I02) es D1 Time Travel de Cloudflare
(ver `docs/despliegue.md`): no pasa por esta API.

Tareas automáticas (`src/server/programado.ts`, dos disparadores en `wrangler.jsonc`): `0 9 * * *` (06:00 Paraguay)
manda los resúmenes (diario; semanal los lunes; mensual el día 1), y `30 9 * * 1` (lunes 06:30 Paraguay) hace la
copia semanal (I05) y borra las sesiones vencidas.
