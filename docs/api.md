# API del sistema de producción

Todo vive bajo `/api` y responde JSON. Los tipos de cada cuerpo y respuesta están en
[`src/shared/tipos.ts`](../src/shared/tipos.ts). La misma app de Hono (`src/server/app.ts`) corre en
Cloudflare Workers (D1 + R2), dentro del navegador en la demo de GitHub Pages (sql.js) y en las pruebas.

## Reglas generales

- **Sesión.** Todo salvo `POST /auth/login` y `GET /salud` exige `Authorization: Bearer <token>`.
  Sin sesión válida: `401 no_autorizado`.
- **Errores.** `{ "error": { "codigo": "...", "mensaje": "..." } }`. El `mensaje` se muestra tal cual al usuario,
  en castellano rioplatense/paraguayo y sin jerga ("No hay stock suficiente para esa salida.").
  Códigos: `400 datos_invalidos`, `401 no_autorizado | credenciales`, `403 prohibido | usuario_inactivo`,
  `404 no_encontrado`, `409 stock_insuficiente | usuario_repetido | lote_mp_no_disponible | ya_controlada | ...`.
- **Sector (A03).** Un operador (rol = su sector) solo ve y carga su sector: el servidor fuerza
  `sector = rol` y responde `403` si pide otro (`sectorPara` en `src/server/sesion.ts`). El administrador
  puede indicar cualquier `sector`; en listados, sin `sector` ve todos.
- **Solo administrador**: usuarios, edición de catálogos, ajustes de stock, correcciones, bloqueo de lotes,
  control de limpieza, reportes y datos. Middleware `soloAdmin`.
- **Lotes y trazabilidad (E)** solo para Chipería y el administrador; los otros sectores reciben `403`.
- **Fechas.** `fecha` ISO UTC; `dia` = día calendario en Paraguay (`AAAA-MM-DD`). Filtros `desde`/`hasta`
  son días inclusivos y comparan contra `dia`. Listados: más nuevo primero.
- **Nada se borra.** Productos, máquinas, áreas, tareas, sucursales y usuarios se desactivan (`activo: false`);
  el historial los sigue mostrando por nombre. El stock es un libro de movimientos: las correcciones son
  movimientos compensatorios (`ajuste`) y quedan en `auditoria` con antes/después y quién las hizo.
- **D04.** El trigger `movimientos_sin_stock_negativo` rechaza cualquier salida que deje negativo el producto
  o el lote; `app.onError` lo traduce a `409 stock_insuficiente`. Varias líneas en un `batch` son atómicas.

## Autenticación (A01)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `PedidoLogin` | `RespuestaLogin` |
| GET | `/auth/yo` | | `Usuario` |
| POST | `/auth/logout` | | `{ ok }` |
| POST | `/auth/clave` | `{ actual, nueva }` | `{ token }` (cierra las otras sesiones) |

## Usuarios (A01–A04) · solo admin

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/usuarios` | | `Usuario[]` (incluye inactivos) |
| POST | `/usuarios` | `{ nombre, usuario, rol, clave }` | `Usuario` (`debeCambiarClave: true`; `409 usuario_repetido`) |
| PATCH | `/usuarios/:id` | `{ nombre?, rol?, activo? }` | `Usuario` (desactivar cierra sus sesiones; no puede desactivarse ni quitarse el rol a sí mismo) |
| POST | `/usuarios/:id/clave` | `{ clave }` | `{ ok }` (reinicia: `debeCambiarClave: true`, cierra sesiones) |

## Catálogos (B01–B05)

Lectura para cualquier usuario con sesión (operador: su sector). Escritura solo admin. `todos=1` incluye inactivos.

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/sectores` | | `Sector[]` |
| PATCH | `/sectores/:id` | `{ nombre }` | `Sector` |
| GET | `/productos` | `?sector&todos` | `Producto[]` |
| POST | `/productos` | `{ sector, nombre, unidad? }` | `Producto` |
| PATCH | `/productos/:id` | `{ nombre?, unidad?, activo? }` | `Producto` |
| GET | `/maquinas` | `?sector&todos` | `Maquina[]` |
| POST | `/maquinas` | `{ sector, numero, nombre, tipo, tempMin, tempMax }` | `Maquina` (`otra` = sin rango; `tempMin ≤ tempMax`) |
| PATCH | `/maquinas/:id` | `{ numero?, nombre?, tipo?, tempMin?, tempMax?, activo? }` | `Maquina` |
| GET | `/areas` | `?sector&todos` | `AreaLimpieza[]` con sus tareas |
| POST | `/areas` | `{ nombre, codigo?, sectores }` | `AreaLimpieza` |
| PATCH | `/areas/:id` | `{ nombre?, codigo?, sectores?, activo? }` | `AreaLimpieza` |
| POST | `/areas/:id/tareas` | `{ nombre, pideNumero? }` | `TareaLimpieza` |
| PATCH | `/tareas/:id` | `{ nombre?, pideNumero?, activo? }` | `TareaLimpieza` |
| GET | `/sucursales` | `?todos` | `Sucursal[]` |
| POST | `/sucursales` | `{ nombre }` | `Sucursal` |
| PATCH | `/sucursales/:id` | `{ nombre?, activo? }` | `Sucursal` |

## Producción (C01–C05, E02–E03)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/producciones` | `?sector&desde&hasta` | `Produccion[]` |
| POST | `/producciones` | `PedidoProduccion` | `Produccion` |
| PATCH | `/producciones/:id` | `{ items: [{ productoId, cocinado, guardado }] }` · admin | `Produccion` |

- Cada ítem: enteros ≥ 0 y al menos uno con `cocinado + guardado > 0`; productos activos del sector.
- Lo `guardado` entra al stock en frío como movimiento `produccion` (+guardado); lo `cocinado` va directo a venta.
- **Chipería**: exige `lotesMP` (al menos uno) disponibles (`409 lote_mp_no_disponible` si está bloqueado
  o vencido) y crea el lote de chipa `CH-AAMMDD-N` (N = número de amasada del día, desde 1), con
  `amasada = N`; los movimientos de stock llevan ese código en `lote`.
- Corrección (C04): por cada producto, la diferencia de `guardado` se registra como movimiento `ajuste`
  (con `produccionId` y motivo "Corrección de producción"); si dejaría negativo, `409 stock_insuficiente`.
  Guarda `corregidoPor`/`corregidoEn` y una fila de `auditoria`.

## Stock en frío (D01–D07)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/stock` | `?sector` (admin: obligatorio) | `StockFila[]` (activos + inactivos con stock ≠ 0; lotes con cantidad > 0, el más viejo primero) |
| POST | `/salidas` | `PedidoSalida` | `Movimiento` (`salida_venta`, cantidad negativa) |
| POST | `/envios` | `PedidoEnvio` | `RespuestaEnvio` (una línea por ítem, mismo `envioId`, todo o nada) |
| POST | `/ajustes` | `PedidoAjuste` · admin | `Movimiento` (merma/vencimiento restan, stock_inicial suma, ajuste según `sentido`; `motivo` obligatorio; auditoría) |
| GET | `/movimientos` | `?sector&desde&hasta&sucursal&producto&tipo&lote` | `Movimiento[]` |

En Chipería las salidas y envíos exigen `lote`. Cantidades: enteros > 0 (el servidor pone el signo).

## Lotes y trazabilidad (E01–E07) · Chipería y admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/lotes-mp` | `?disponibles` | `LoteMP[]` |
| POST | `/lotes-mp` | `{ insumo, proveedor, numeroLote?, fechaIngreso, cantidad, unidad?, vencimiento }` | `LoteMP` |
| PATCH | `/lotes-mp/:id` | `{ bloqueado }` · admin | `LoteMP` (auditoría) |
| GET | `/lotes-chipa` | `?desde&hasta` | `LoteChipa[]` |
| GET | `/trazabilidad/mp/:id` | | `TrazabilidadMP` |
| GET | `/trazabilidad/lote/:codigo` | | `TrazabilidadLote` |
| GET | `/trazabilidad/sucursal/:id` | `?desde&hasta` | `TrazabilidadSucursal` |

`disponible = !bloqueado && vencimiento ≥ hoy (Paraguay)`. `descripcion` = "Queso · Proveedor · lote 123"
(o la fecha de ingreso si no hay número), como en la planilla.

## Máquinas y temperaturas (F01–F05)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/lecturas` | `?sector&maquina&desde&hasta&fueraDeRango&conFallas` | `Lectura[]` |
| POST | `/lecturas` | `PedidoLectura` | `Lectura` |
| GET | `/lecturas/:id/foto` | | `{ dataUrl }` |

Temperatura obligatoria si la máquina tiene rango (salvo `fuera_de_servicio`). `fueraDeRango` lo calcula el
servidor con `tempMin`/`tempMax` (un lado puede ser null: ≤ −18 °C, ≥ 63 °C). Foto opcional (JPEG ya achicado
en el navegador, máx. ~1,5 MB) en R2 o en la tabla `archivos`.

## Limpieza (G01–G03)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/limpiezas` | `?sector&area&desde&hasta&sinControlar` | `Limpieza[]` |
| POST | `/limpiezas` | `PedidoLimpieza` | `Limpieza` (todas las tareas activas del área marcadas `X`, `XX` o `-`) |
| POST | `/limpiezas/:id/control` | · admin | `Limpieza` (`409 ya_controlada`) |

## Reportes (H01–H04) · solo admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/reportes` | `?desde&hasta&sector` | `Reporte` |
| POST | `/reportes/enviar` | `{ periodo }` | `ResumenCorreo` (en la demo no envía: devuelve la vista previa) |

El Excel (H03) se arma en el navegador con `write-excel-file` a partir de estas respuestas.

## Datos (I01–I05) · solo admin

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/config` | | `Configuracion` |
| PATCH | `/config` | `Partial<Configuracion>` | `Configuracion` |
| GET | `/exportar` | | `Exportacion` (todas las tablas, sin `clave_hash`, sesiones ni archivos) |
| GET | `/copias` | | `Copia[]` |
| POST | `/copias` | | `Copia` (copia manual ahora) |
| GET | `/copias/:clave` | | el JSON de la copia |
| GET | `/auditoria` | `?tabla&desde&hasta` | `Auditoria[]` |

Tareas automáticas (`src/server/programado.ts`, cron diario 09:00 UTC = 06:00 Paraguay): resumen diario,
semanal los lunes, mensual el día 1, y copia semanal (I05) los lunes.
