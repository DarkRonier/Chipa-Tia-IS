-- Esquema inicial de la base (Cloudflare D1 / SQLite).
-- Fechas: `fecha` es ISO 8601 en UTC; `dia` es la fecha calendario en hora de Paraguay (AAAA-MM-DD),
-- calculada al guardar, para filtrar y agrupar reportes sin convertir zonas horarias en SQL.

CREATE TABLE sectores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  con_lotes INTEGER NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('chiperia', 'chipitas', 'panaderia', 'cocina', 'admin')),
  activo INTEGER NOT NULL DEFAULT 1,
  debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  creada_en TEXT NOT NULL,
  vence_en TEXT NOT NULL
);
CREATE INDEX sesiones_usuario ON sesiones(usuario_id);

CREATE TABLE productos (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  nombre TEXT NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'unidades',
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX productos_sector ON productos(sector);

CREATE TABLE maquinas (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  numero INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('heladera', 'congelador', 'exhibidora_fria', 'exhibidora_caliente', 'otra')),
  temp_min REAL,
  temp_max REAL,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX maquinas_sector ON maquinas(sector);

CREATE TABLE areas_limpieza (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Qué sectores cargan cada área (las áreas comunes pueden tener más de uno).
CREATE TABLE areas_sectores (
  area_id TEXT NOT NULL REFERENCES areas_limpieza(id),
  sector TEXT NOT NULL REFERENCES sectores(id),
  PRIMARY KEY (area_id, sector)
);

CREATE TABLE tareas_limpieza (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas_limpieza(id),
  nombre TEXT NOT NULL,
  pide_numero INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tareas_area ON tareas_limpieza(area_id);

CREATE TABLE sucursales (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lotes_mp (
  id TEXT PRIMARY KEY,
  insumo TEXT NOT NULL,
  proveedor TEXT NOT NULL,
  numero_lote TEXT NOT NULL DEFAULT '',
  fecha_ingreso TEXT NOT NULL,
  cantidad REAL NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'kg',
  vencimiento TEXT NOT NULL,
  bloqueado INTEGER NOT NULL DEFAULT 0,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL
);

CREATE TABLE producciones (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  turno TEXT NOT NULL CHECK (turno IN ('dia', 'noche')),
  corregido_por TEXT REFERENCES usuarios(id),
  corregido_en TEXT
);
CREATE INDEX producciones_sector_dia ON producciones(sector, dia);

CREATE TABLE produccion_items (
  produccion_id TEXT NOT NULL REFERENCES producciones(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  cocinado INTEGER NOT NULL DEFAULT 0 CHECK (cocinado >= 0),
  guardado INTEGER NOT NULL DEFAULT 0 CHECK (guardado >= 0),
  PRIMARY KEY (produccion_id, producto_id)
);

-- Lote propio de cada producción de Chipería (E03).
CREATE TABLE lotes_chipa (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  produccion_id TEXT REFERENCES producciones(id),
  amasada INTEGER NOT NULL,
  dia TEXT NOT NULL
);

CREATE TABLE lote_chipa_mp (
  lote_chipa_id TEXT NOT NULL REFERENCES lotes_chipa(id),
  lote_mp_id TEXT NOT NULL REFERENCES lotes_mp(id),
  PRIMARY KEY (lote_chipa_id, lote_mp_id)
);
CREATE INDEX lote_chipa_mp_mp ON lote_chipa_mp(lote_mp_id);

-- Libro de movimientos del stock en frío: el stock es la suma de `cantidad`.
CREATE TABLE movimientos (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  lote TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste')),
  cantidad INTEGER NOT NULL CHECK (cantidad <> 0),
  motivo TEXT,
  sucursal_id TEXT REFERENCES sucursales(id),
  envio_id TEXT,
  produccion_id TEXT REFERENCES producciones(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL
);
CREATE INDEX movimientos_stock ON movimientos(sector, producto_id, lote);
CREATE INDEX movimientos_dia ON movimientos(dia);
CREATE INDEX movimientos_sucursal ON movimientos(sucursal_id);

-- D04: ninguna salida puede dejar el stock negativo, ni del producto ni del lote.
-- Corre dentro de la misma transacción que el insert, así que un envío con varias líneas
-- se rechaza completo si una sola no alcanza.
CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0 AND (
  (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
     WHERE sector = NEW.sector AND producto_id = NEW.producto_id) + NEW.cantidad < 0
  OR (NEW.lote IS NOT NULL AND
     (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
        WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND lote = NEW.lote) + NEW.cantidad < 0)
)
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;

CREATE TABLE lecturas (
  id TEXT PRIMARY KEY,
  maquina_id TEXT NOT NULL REFERENCES maquinas(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  momento TEXT NOT NULL CHECK (momento IN ('inicio', 'fin', 'inicial', 'intermedia', 'otro')),
  estado TEXT NOT NULL CHECK (estado IN ('funciona', 'con_fallas', 'fuera_de_servicio')),
  temperatura REAL,
  fuera_de_rango INTEGER NOT NULL DEFAULT 0,
  observacion TEXT NOT NULL DEFAULT '',
  mantenimiento TEXT,
  mantenimiento_por TEXT,
  foto_clave TEXT
);
CREATE INDEX lecturas_maquina ON lecturas(maquina_id, fecha);
CREATE INDEX lecturas_dia ON lecturas(dia);

CREATE TABLE limpiezas (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas_limpieza(id),
  sector TEXT NOT NULL REFERENCES sectores(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  comentario TEXT NOT NULL DEFAULT '',
  controlado_por TEXT REFERENCES usuarios(id),
  controlado_en TEXT
);
CREATE INDEX limpiezas_sector_dia ON limpiezas(sector, dia);

CREATE TABLE limpieza_marcas (
  limpieza_id TEXT NOT NULL REFERENCES limpiezas(id),
  tarea_id TEXT NOT NULL REFERENCES tareas_limpieza(id),
  marca TEXT NOT NULL CHECK (marca IN ('X', 'XX', '-')),
  numero TEXT,
  PRIMARY KEY (limpieza_id, tarea_id)
);

CREATE TABLE auditoria (
  id TEXT PRIMARY KEY,
  tabla TEXT NOT NULL,
  registro_id TEXT NOT NULL,
  accion TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  antes TEXT,
  despues TEXT
);
CREATE INDEX auditoria_registro ON auditoria(tabla, registro_id);

-- Fotos y copias cuando no hay R2 (modo demo y pruebas). En Cloudflare se usa R2.
CREATE TABLE archivos (
  clave TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  datos TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  creado_en TEXT NOT NULL
);

CREATE TABLE copias (
  clave TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('automatica', 'manual'))
);

CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
