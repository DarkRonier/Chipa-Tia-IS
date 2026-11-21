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
- **Roles y permisos.** Hay 7 roles: los 4 sectores (`chiperia`, `chipitas`, `panaderia`, `cocina`), `supervisor`,
  `cajero` y `admin`. Qué puede hacer cada uno está en una sola tabla, `src/shared/permisos.ts`, que usan la API
  (`requiere(permiso)` en `src/server/sesion.ts`) y las pantallas. Sin el permiso: `403 prohibido`.
  - **Administrador**: todo menos registrar ventas: opera la caja, ve y anula ventas y factura, pero las ventas las
    registra solo el cajero.
  - **Supervisor**: ve producción, stock, salidas, máquinas, limpieza, lotes, trazabilidad y reportes de todos los
    sectores (indica `?sector` como el administrador). Reporta fallas o incidencias de máquinas
    (`/incidencias`) y da el visto bueno de la limpieza. No carga producción ni lecturas, no mueve ni ajusta stock,
    no corrige y no entra a catálogos, usuarios, datos ni a la configuración del correo.
  - **Cajero**: caja, ventas (es el único que las registra) y facturas; `/alertas` le devuelve `[]`. Puede leer los
    catálogos.
  - **Sectores**: lo de su sector; lotes y trazabilidad solo Chipería.
- **Errores.** `{ "error": { "codigo": "...", "mensaje": "..." } }`. El `mensaje` se muestra tal cual al usuario,
  en castellano rioplatense/paraguayo y sin jerga ("No hay stock suficiente para esa salida.").

| Estado | Código | Cuándo |
|---|---|---|
| 400 | `datos_invalidos` | Falta un dato o no es válido (el mensaje dice cuál); cuerpo que no es JSON; `desde` posterior a `hasta` |
| 401 | `no_autorizado` | Sin sesión, sesión vencida o cerrada |
| 401 | `credenciales` | Usuario o contraseña incorrectos (el mismo mensaje en los dos casos) |
| 403 | `prohibido` | Otro sector (A03), algo que el rol no tiene permitido, lotes fuera de Chipería |
| 403 | `usuario_inactivo` | Login de un usuario desactivado |
| 403 | `debe_cambiar_clave` | Un administrador todavía no cambió su contraseña inicial o restablecida |
| 404 | `no_encontrado` | El registro no existe; ruta desconocida |
| 409 | `stock_insuficiente` | Salida, envío, transferencia, merma o corrección que dejaría negativo el producto o el lote en su depósito (D04). Las ventas de caja nunca lo dan |
| 409 | `usuario_repetido` | Ya existe ese nombre de usuario |
| 409 | `nombre_repetido` | Producto (en su sector), área, tarea (en su área), sucursal o sector con el mismo nombre, sin distinguir mayúsculas ni tildes; si el otro está desactivado, el mensaje propone activarlo |
| 409 | `numero_repetido` | Otra máquina activa del sector tiene ese N° |
| 409 | `lote_mp_usado` | Anular una compra cuyo lote de materia prima ya usó una amasada |
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
  o el lote en su depósito (menos las ventas de caja). Las rutas lo traducen a `409 stock_insuficiente` diciendo qué falta ("de Empanada frita (carne)
  hay 3 y querés sacar 10"). Varias líneas en un `batch` son atómicas: si una no alcanza, no se guarda ninguna.

## Autenticación (A01)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `PedidoLogin` | `RespuestaLogin` (`401 credenciales`, `403 usuario_inactivo`) |
| GET | `/auth/yo` | | `Usuario` (con `superHasta` si el modo super-administrador está activo) |
| POST | `/auth/super` | `{ clave }` · admin | `{ superHasta }`: modo super-administrador por 30 minutos en esta sesión (`400` con contraseña mal) |
| POST | `/auth/super/salir` | · admin | `{ ok }` |
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
| POST | `/productos` | `{ sector, nombre, unidad? }` (más lo de compras y venta: `tipo`, `categoriaId`, `codigo`, `precioVenta`, `iva`) | `Producto` (`unidad` por defecto `unidades`; queda al final de su sector) |
| PATCH | `/productos/:id` | `{ nombre?, unidad?, activo? }` (y los mismos campos opcionales) | `Producto` |
| GET | `/maquinas` | `?sector&todos` | `Maquina[]` (por sector y N°) |
| POST | `/maquinas` | `{ sector, numero?, nombre, tipo, tempMin?, tempMax? }` | `Maquina` |
| PATCH | `/maquinas/:id` | `{ numero?, nombre?, tipo?, tempMin?, tempMax?, activo? }` | `Maquina` |
| GET | `/areas` | `?sector&todos` | `AreaLimpieza[]` con sus tareas (sin `todos`, solo las activas) |
| POST | `/areas` | `{ nombre, codigo?, sectores }` | `AreaLimpieza` |
| PATCH | `/areas/:id` | `{ nombre?, codigo?, sectores?, activo? }` | `AreaLimpieza` (`sectores` reemplaza la lista) |
| POST | `/areas/:id/tareas` | `{ nombre, pideNumero? }` | `TareaLimpieza` (queda al final de la planilla) |
| PATCH | `/tareas/:id` | `{ nombre?, pideNumero?, activo? }` | `TareaLimpieza` |
| GET | `/sucursales` | `?todos` | `Sucursal[]` (por nombre) |
| POST | `/sucursales` | `{ nombre }` · super-administrador | `Sucursal` |
| PATCH | `/sucursales/:id` | `{ nombre?, activo? }` · admin (cambiar `activo`: super-administrador) | `Sucursal` |
| DELETE | `/sucursales/:id` | · super-administrador | `{ ok }` (con envíos queda dada de baja; sin envíos se borra) |
| GET | `/depositos` | | `Deposito[]` (venta directa, después los fríos y Materia prima; con `maquina` y su última medición, y `categorias` en los de venta) |
| POST | `/depositos` | `{ nombre, descripcion?, maquinaId? }` · super-administrador | `Deposito` (un depósito frío; va antes de Materia prima) |
| PATCH | `/depositos/:id` | `{ nombre?, descripcion?, maquinaId? (solo fríos; null desvincula), categorias? (solo venta directa) }` · admin | `Deposito` |
| DELETE | `/depositos/:id` | · super-administrador | `{ ok }` |

- Nombres repetidos: `409 nombre_repetido` (ver arriba).
- Máquinas: sin `numero` toma el siguiente al más alto del sector; dos máquinas activas del mismo sector no
  comparten N° (`409 numero_repetido`). `otra` = sin control de temperatura (el rango queda vacío); los demás
  tipos necesitan al menos un límite: un lado puede faltar (freezer ≤ −18 °C, bufetera ≥ 63 °C).
  `tempMin ≤ tempMax`, entre −60 °C y 300 °C, con un decimal. El `PATCH` valida el rango con lo que llega y lo
  que ya tenía.
- Los productos no tienen campos de stock (stock mínimo, stock obligatorio y «la venta descuenta stock» se quitaron
  en la migración 0014): el stock se lleva por depósito (ver Stock).
- Depósitos (migración 0015): `tipo` `venta` (`venta` «Venta frente», la caja del cajero; `comedor` «Venta comedor»)
  o `almacen` (`frio` «Frío» y los que cree el super-administrador; `materia_prima` «Materia prima»). Los de venta y
  Materia prima son fijos: se renombran pero no se borran (`409 deposito_del_sistema`). Un almacén se borra si está
  vacío (`409 deposito_con_stock`) y queda otro (`409 ultimo_almacen`); si tuvo movimientos queda oculto
  (`borrado_en`) por el historial. Crear y borrar exige el modo super-administrador (`403` sin él). Las sucursales
  no son un depósito: solo se registra lo enviado (`GET /envios`).
- Productos: `categoriaId` (sin elegir, «Otros», la categoría `sistema` que no se desactiva), `subcategoria` (texto
  libre), `unidad` y `sinStock` (solo se registran las ventas, como el buffet por kilo: no tiene movimientos; `409
  producto_con_stock` si se marca con stock).
- Áreas: `sectores` = qué sectores la cargan (al menos uno; las comunes, como Sanitario, tienen varios).

## Producción (C01–C04, E02–E04)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/producciones` | `?sector&desde&hasta` | `Produccion[]` |
| POST | `/producciones` | `PedidoProduccion` | `Produccion` |
| PATCH | `/producciones/:id` | `{ items: [{ productoId, cocinado, guardado }] }` · admin | `Produccion` |

- `POST`: `turno` (`dia` o `noche`) obligatorio. Cada producto una sola vez (hasta 300), enteros ≥ 0; las líneas
  en 0 y 0 no se guardan y tiene que quedar al menos una. Productos activos del sector.
- Lo `cocinado` entra en el depósito de venta `depositoVentaId` (por defecto «Venta frente»; `400` si no es de
  venta) y lo `guardado` en el almacén de la línea (`depositoId`, por defecto Frío o el primer almacén; `400` si no es
  un almacén o ya no existe), los dos como movimiento `produccion`. Los productos «sin stock» no generan movimientos. Al corregir,
  lo guardado sigue en su depósito.
- **Chipería**: exige `lotesMP` (de 1 a 50 objetos `{ id, cantidad }`; `400` si falta) disponibles (`409
  lote_mp_no_disponible` si alguno está bloqueado, vencido, sin saldo o no existe). `cantidad` es lo usado de ese
  lote en su unidad (E03): obligatoria, número > 0 y no más que el saldo del lote (`400`); cada lote va una sola
  vez; se guarda en `lote_chipa_mp.cantidad` (NULL = registro anterior, «sin dato»). Un trigger de la base
  rechaza (`409 lote_mp_sin_saldo`) dos cargas simultáneas que pasarían del saldo. Crea el lote de chipa `CH-AAMMDD-N` (N = número de amasada del
  día, desde 1), con `amasada = N`; los movimientos de stock llevan ese código en `lote`. En los otros sectores
  `lotesMP` se ignora.
  Si el lote de materia prima entró con una compra (`LoteMP.productoId`), lo usado sale del depósito Materia prima
  (movimiento `produccion` negativo con el número de lote de la compra y motivo "Usado en la amasada CH-…"); ese
  movimiento no se frena aunque el depósito no alcance, porque el saldo del lote ya se controló (migración 0016).
- **Otros sectores**: `materiaPrima` opcional (hasta 50 `{ productoId, cantidad }`, materia prima del mismo sector,
  cantidad > 0 con hasta 3 decimales): sale del depósito Materia prima (movimiento `produccion` negativo, motivo
  "Usado en la producción"), sin frenarse si no alcanza. `Produccion.materiaPrima` lista lo usado (también lo de los
  lotes de Chipería que entraron con una compra).
- Corrección (C04): **mezcla**, no reemplaza: los productos que no vienen en `items` quedan como estaban; los
  que vienen toman los valores nuevos (0 y 0 deja el producto en cero) y se pueden agregar productos activos
  del sector. Sin cambios, `400`; el registro tiene que quedar con al menos una cantidad. Por cada producto, la
  diferencia de `cocinado` (en su depósito de venta) y la de `guardado` (en su depósito) se registran como movimientos
  `ajuste` (con `produccionId`, el lote si es de Chipería y motivo "Corrección de producción"); si dejaría negativo,
  `409 stock_insuficiente`. Estos ajustes no cuentan como salidas en los reportes. Guarda
  `corregidoPor`/`corregidoEn` y una fila de `auditoria` (`corregir`, ítems antes y después). El turno y los
  lotes de materia prima no se corrigen.

## Stock por depósitos (D01–D07)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/stock` | `?sector` (sin sector o con `todos=1`: todos los productos) | `StockFila[]` (con `sector`, `categoriaId`, `subcategoria`, `unidad`) |
| GET | `/stock/vendido` | `?desde&hasta` (por defecto hoy) | `VendidoFila[]` (incluye los «sin stock») |
| GET | `/envios` | `?desde&hasta` | `EnvioResumen[]` (lo enviado por sucursal y producto) |
| POST | `/salidas` | `PedidoSalida` (`desde?` almacén, por defecto Frío; `hacia?` depósito de venta, por defecto Venta frente) | `Movimiento` (`salida_venta`, la mitad que sale) |
| POST | `/envios` | `PedidoEnvio` (`desde?` almacén, por defecto Frío) | `RespuestaEnvio` (una línea por ítem, mismo `envioId`, todo o nada) |
| POST | `/ajustes` | `PedidoAjuste` (`depositoId?`, por defecto `frio`) · admin | `Movimiento` |
| POST | `/transferencias` | `PedidoTransferencia`: `{ sector?, productoId, lote?, cantidad, desde, hacia }` | `Movimiento[]` (par `transferencia`: −N en `desde`, +N en `hacia`) |
| GET | `/movimientos` | `?sector&desde&hasta&sucursal&producto&tipo&lote&deposito` | `Movimiento[]` |

- **Depósitos.** Cada movimiento lleva `depositoId` (y `depositoNombre` al leerlo). `StockFila` trae `total` (todos
  los depósitos), `porDeposito` (`{ venta: 3, frio: 8 }`, sin los que están en 0) y, en Chipería, `lotes` con
  `cantidad` y `porDeposito`. Las ventas de caja descuentan de «Venta frente» (la materia prima
  con precio, como la leche, de «Materia prima»); las compras de venta directa
  (`tipo: reventa`) entran ahí y las de materia prima en «Materia prima»; lo cocinado entra en el depósito de venta
  elegido. El sector de cada movimiento sale del producto: un operador solo mueve los de su sector (`403`); el
  administrador no necesita indicar el sector.
- `/salidas` («Sacar para la venta») pasa del almacén `desde` al depósito de venta `hacia` con dos movimientos
  `salida_venta` (motivo «De «Frío» a «Venta frente»»). `/transferencias` pasa entre dos depósitos cualesquiera
  (distintos, el destino activo) con dos movimientos `transferencia`, que no cuentan como salida en los reportes.
  `/movimientos` muestra solo la mitad que sale de esos pares.
- El trigger de D04 controla por producto, depósito y lote; el `409` dice cuánto hay en los otros depósitos y sugiere
  «Transferir». Las ventas de caja (tipo `venta`) son la excepción: nunca se frenan y «Venta frente» puede quedar en
  negativo (la pantalla de Depósitos lo marca: «faltan N por cargar»).
- `/stock`: los productos activos (del sector pedido, o todos) aunque estén en 0 y los inactivos con stock ≠ 0. En Chipería,
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

## Lotes y trazabilidad (E01, E05–E07) · Chipería, supervisor (solo ver) y admin

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/lotes-mp` | `?disponibles` | `LoteMP[]` (el ingreso más nuevo primero) |
| POST | `/lotes-mp` | `{ insumo, proveedor, numeroLote?, fechaIngreso, cantidad, unidad?, vencimiento }` | `LoteMP` |
| PATCH | `/lotes-mp/:id` | `{ bloqueado }` · admin | `LoteMP` |
| GET | `/lotes/alertas` | | `Alerta[]` (E10) |
| GET | `/lotes-chipa` | `?desde&hasta` | `LoteChipa[]` (horno, congelador, lo que queda y sus lotes de materia prima con la cantidad usada) |
| GET | `/trazabilidad/mp/:id` | | `TrazabilidadMP` |
| GET | `/trazabilidad/lote/:codigo` | | `TrazabilidadLote` |
| GET | `/trazabilidad/sucursal/:id` | `?desde&hasta` | `TrazabilidadSucursal` |

- `consumido` = suma de lo usado por las amasadas (E03); `saldo = cantidad − consumido` (nunca negativo);
  `agotado = saldo = 0`. Los usos sin cantidad (anteriores) no descuentan.
- `GET /lotes/alertas`: `lote_vencido` (vencido, sin bloquear y con saldo) y `lote_por_vencer` (vence en los
  próximos `DIAS_AVISO_VENCIMIENTO` = 7 días, sin bloquear y con saldo); sector `chiperia`, enlace `/lotes`.
  La función `alertasLotes(db)` está en `src/server/alertasLotes.ts`.
- `disponible = !bloqueado && vencimiento ≥ hoy (Paraguay) && saldo > 0`; `?disponibles=1` trae solo esos (E07).
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

### Fallas e incidencias de máquinas · supervisor y admin reportan

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/incidencias` | `?sector&maquina&desde&hasta&abiertas` | `Incidencia[]` (la más nueva primero) |
| POST | `/incidencias` | `{ maquinaId, tipo: 'falla' \| 'incidencia', descripcion }` | `Incidencia` |
| POST | `/incidencias/:id/resolver` | `{ resolucion? }` | `Incidencia` (`409 ya_resuelta`) |

- No es una lectura: no lleva estado ni temperatura. Queda abierta (aviso `incidencia_maquina` en `/alertas`) hasta
  que el supervisor o el administrador la marca como resuelta. Los sectores ven las de sus máquinas.

## Limpieza (G01–G03)

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/limpiezas` | `?sector&area&desde&hasta&sinControlar` | `Limpieza[]` (marcas en el orden de la planilla) |
| POST | `/limpiezas` | `PedidoLimpieza` | `Limpieza` |
| POST | `/limpiezas/:id/control` | · admin o supervisor | `Limpieza` (`409 ya_controlada`) |

- `POST`: el área tiene que existir (`404`), estar activa (`400`) y ser del sector del operador (`403`). El
  administrador indica `sector` cuando el área la cargan varios sectores (`400` si falta).
- Como en la planilla en papel no se dejan cuadros en blanco: **todas** las tareas activas del área se marcan
  una sola vez con `X` (diaria), `XX` (profunda) o `-` (no se hizo); si falta alguna, `400` nombrándola.
  `numero` (hasta 30 caracteres) solo en tareas con `pideNumero` (`400` en las otras) y no se guarda con `-`.
  `comentario` opcional, hasta 500 caracteres.
- `/control` firma el «Controlado por» con auditoría (`controlar`).

## Compras, proveedores y pagos (M10)

Roles: los **sectores** cargan compras solo de productos de su sector cuya categoría el administrador habilitó para
ese sector, y ven solo las compras que cargaron (sin pagos ni saldos). **Supervisor y administrador** compran
cualquier producto (y renglones de texto libre, como un flete, que no tocan el stock), gestionan proveedores, marcan
pagos (parciales o totales), anulan compras y pagos, y ven el reporte. El cajero no entra.

Cada renglón con producto suma a su stock (movimiento `compra`, en el sector del producto): los de venta directa en
«Venta frente» y la materia prima en «Materia prima». Anular una compra (sin pagos) descuenta ese stock del mismo
depósito; si ya salió de ahí, `409 stock_insuficiente`.
Lo pagado nunca supera el total (trigger `pagos_proveedor_sin_exceso`). Importes en guaraníes enteros.

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/categorias` | `?todos` (admin/supervisor) | `Categoria[]` |
| POST | `/categorias` | `{ nombre, sectores?: SectorId[] }` · admin | `Categoria` |
| PATCH | `/categorias/:id` | `{ nombre?, activo?, sectores? }` · admin | `Categoria` |
| PATCH | `/productos/:id` | `{ categoriaId: string \| null, codigo?: string }` (además de lo de B01; `codigo` opcional, para buscar) · admin | `Producto` |
| GET | `/proveedores` | `?todos` (quien gestiona) | `Proveedor[]` (`saldo` solo para quien marca pagos) |
| POST | `/proveedores` | `{ nombre, ruc?, telefono?, notas? }` · supervisor y admin | `Proveedor` |
| PATCH | `/proveedores/:id` | `{ nombre?, ruc?, telefono?, notas?, activo? }` · supervisor y admin | `Proveedor` |
| GET | `/proveedores/:id/cuenta` | — · supervisor y admin | `CuentaProveedor` (compras y pagos con el saldo después de cada uno) |
| GET | `/compras/productos` | — | `ProductoCompra[]` (lo que ese usuario puede comprar) |
| GET | `/compras` | `?desde&hasta&proveedor&estado=pendiente,parcial,pagada,anulada&sector` | `Compra[]` |
| GET | `/compras/:id` | — | `Compra` con `pagos` (si puede verlos) |
| POST | `/compras` | `PedidoCompra`: `{ proveedorId?, comprobante?, diaCompra?, vencimiento?, nota?, items: [{ productoId? \| detalle?, cantidad, precioUnitario, lote?, vencimiento? }] }`. La materia prima de Chipería (`ProductoCompra.loteMP`) exige `vencimiento` (no anterior a la compra ni a hoy) y crea su lote de materia prima (`LoteMP.compraId`) con el lote, la cantidad y el proveedor del renglón. Sin `proveedorId` queda el proveedor fijo «Sin nombre» (`prov-sin-nombre`, no se lista ni se edita). Se guarda siempre pendiente: con `pago` da 400 | `Compra` |
| POST | `/compras/:id/pagos` | `{ importe \| total: true, medio, diaPago?, nota?, desdeCaja? }` (`desdeCaja`: el pago sale de la caja abierta) · supervisor y admin | `Compra` |
| POST | `/compras/:id/anular` | `{ motivo }` · supervisor y admin | `Compra` (`409 compra_con_pagos`; `409 lote_mp_usado` si una amasada ya usó su lote de materia prima; si no, ese lote se borra con la compra) |
| POST | `/pagos-proveedor/:id/anular` | `{ motivo }` · supervisor y admin | `Compra` |
| GET | `/reportes/compras` | `?desde&hasta` (por defecto, el mes actual) · supervisor y admin | `ReporteCompras` |

Medios de pago: `efectivo`, `transferencia`, `tarjeta`, `qr`, `cheque`. Avisos nuevos en `/alertas` (supervisor y
admin): `compra_por_vencer` (vence en 3 días o menos) y `compra_vencida`.

## Caja, ventas y facturas (M11–M13) · cajero (y admin, que no vende)

Hay una sola caja abierta a la vez. Sin caja abierta no se vende. Al cerrar se cuenta el efectivo: esperado = fondo
inicial + ventas en efectivo + ingresos − retiros; la diferencia queda guardada. Una caja cerrada no se toca (trigger
`CAJA_CERRADA`). Cada producto tiene `precioVenta` (sin precio no se vende; cualquier tipo con precio se vende, también la materia
prima como la leche) e `iva` (0, 5 o 10). Toda venta descuenta del depósito «Venta frente» (la materia prima, de
«Materia prima»; movimiento `venta`), sin frenarse nunca; en Chipería, por lote, el más viejo primero
(lo que no alcanza sale sin lote). Solo el **cajero** registra ventas (`ventas.registrar`); el administrador opera la
caja, ve las ventas, las anula (`ventas.anular`) y factura, pero no vende. El supervisor no entra.

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/caja` | — | `Caja \| null` (la abierta, con totales por medio y movimientos) |
| POST | `/caja/abrir` | `{ fondoInicial }` | `Caja` (`409` si ya hay una abierta) |
| POST | `/caja/movimientos` | `{ tipo: ingreso \| retiro, concepto, importe, medio? }` | `Caja` |
| POST | `/caja/movimientos/:id/anular` | `{ motivo }` (solo los cargados a mano) | `Caja` |
| POST | `/caja/arqueos` | `{ contado, nota? }` (arqueo parcial, sin cerrar) | `Caja` |
| POST | `/caja/cerrar` | `{ contado, nota? }` | `Caja` cerrada con `diferencia` |
| GET | `/cajas` | `?desde&hasta` · admin | `Caja[]` |
| GET | `/cajas/:id` | — · admin | `Caja` |
| GET | `/ventas/productos` | — | `ProductoVenta[]` (con precio y `stock` en «Venta frente») |
| GET | `/ventas` | `?caja&desde&hasta` (el cajero, por defecto la caja abierta) · cajero y admin | `Venta[]` |
| GET | `/ventas/:id` | — | `Venta` |
| POST | `/ventas` | `PedidoVenta`: `{ items: [{ productoId, cantidad }], descuento?, medio, recibido?, clienteNombre?, clienteRuc? }` | `Venta` · solo cajero |
| POST | `/ventas/:id/anular` | `{ motivo }` (solo con la caja abierta; devuelve el stock al mismo depósito y lote y anula la factura) · cajero y admin | `Venta` |
| GET | `/factura/config` | — | `ConfigFactura` (timbrado, prefijo, número inicial y posiciones en mm) |
| PUT | `/factura/config` | `ConfigFactura` · admin | `ConfigFactura` |
| POST | `/ventas/:id/factura` | — | `{ venta, config }`: la primera vez asigna el número correlativo; después cuenta reimpresiones |

## Ingresos y egresos, gastos fijos y sueldos (M14) · admin (el supervisor ve solo pagos a proveedores)

Las ventas entran solas como ingreso y los pagos a proveedores como egreso. El resto se carga a mano. Los sueldos son
gastos fijos mensuales (`esSueldo`), con importe que solo el administrador define; al pagarlos quedan como egreso del
mes. Con `desdeCaja`, el movimiento también entra o sale de la caja abierta.

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/ie` | `?desde&hasta` | `ResumenIE` (supervisor: `soloProveedores`) |
| GET | `/ie/categorias` | — | `{ ingreso: string[], egreso: string[] }` |
| POST | `/ie` | `{ tipo, dia?, concepto, categoria, importe, medio?, desdeCaja? }` · admin | movimiento |
| POST | `/ie/:id/anular` | `{ motivo }` · admin | movimiento |
| GET | `/gastos-fijos` | `?periodo=AAAA-MM` · admin | `GastoFijoMes[]` (con pagado o no ese mes) |
| POST | `/gastos-fijos` | `{ nombre, categoria?, importe, diaDelMes, esSueldo? }` · admin | `GastoFijo` |
| PATCH | `/gastos-fijos/:id` | `{ nombre?, categoria?, importe?, diaDelMes?, activo? }` · admin | `GastoFijo` |
| POST | `/gastos-fijos/:id/pagar` | `{ periodo, importe?, medio, dia?, desdeCaja? }` · admin | movimiento (`409 ya_pagado`) |
| GET | `/reportes/detallado` | `?desde&hasta` · admin | `ReporteDetallado` (ventas, cajas, I/E, sueldos, gastos fijos, compras) |

Avisos nuevos en `/alertas`: `caja_sin_cerrar` (caja abierta de un día anterior) y `gasto_fijo_pendiente` (vencido sin pagar, admin).

## Reportes (H01–H04) · admin y supervisor (el correo, solo admin)

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
