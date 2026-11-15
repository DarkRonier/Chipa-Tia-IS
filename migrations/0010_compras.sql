-- Etapa 2 de la ampliación (M10): categorías de productos, proveedores, compras y pagos a proveedores.
-- Importes en guaraníes enteros. `dia` es la fecha calendario en hora de Paraguay (AAAA-MM-DD).

-- 1) Categorías de productos. El administrador las crea en Catálogos y elige qué sectores pueden comprar cada una.
CREATE TABLE categorias (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Sectores que pueden cargar compras de productos de esa categoría.
CREATE TABLE categorias_sectores (
  categoria_id TEXT NOT NULL REFERENCES categorias(id),
  sector TEXT NOT NULL REFERENCES sectores(id),
  PRIMARY KEY (categoria_id, sector)
);

ALTER TABLE productos ADD COLUMN categoria_id TEXT REFERENCES categorias(id);

-- 2) Proveedores. Los cargan el administrador y el supervisor.
CREATE TABLE proveedores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  ruc TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

-- 3) Compras. `sector` es el sector que la cargó (NULL si la cargó el administrador o el supervisor).
-- `dia_compra` es la fecha del comprobante; `vencimiento`, hasta cuándo hay que pagarla (NULL = sin vencimiento).
-- Una compra anulada deja de contar en saldos y reportes, y su stock se descuenta.
CREATE TABLE compras (
  id TEXT PRIMARY KEY,
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  sector TEXT REFERENCES sectores(id),
  comprobante TEXT NOT NULL DEFAULT '',
  dia_compra TEXT NOT NULL,
  vencimiento TEXT,
  total INTEGER NOT NULL CHECK (total >= 0),
  nota TEXT NOT NULL DEFAULT '',
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  anulada_por TEXT REFERENCES usuarios(id),
  anulada_en TEXT,
  motivo_anulacion TEXT
);
CREATE INDEX compras_proveedor ON compras(proveedor_id, dia_compra);
CREATE INDEX compras_dia ON compras(dia_compra);
CREATE INDEX compras_sector ON compras(sector, dia_compra);

-- Detalle: un producto del catálogo (suma a su stock) o un texto libre (por ejemplo, «Flete»), que no toca el stock.
CREATE TABLE compra_items (
  id TEXT PRIMARY KEY,
  compra_id TEXT NOT NULL REFERENCES compras(id),
  orden INTEGER NOT NULL DEFAULT 0,
  producto_id TEXT REFERENCES productos(id),
  detalle TEXT NOT NULL DEFAULT '',
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL CHECK (precio_unitario >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  lote TEXT
);
CREATE INDEX compra_items_compra ON compra_items(compra_id);
CREATE INDEX compra_items_producto ON compra_items(producto_id);

-- 4) Pagos a proveedores (pagos parciales incluidos). Un pago anulado deja de contar.
CREATE TABLE pagos_proveedor (
  id TEXT PRIMARY KEY,
  compra_id TEXT NOT NULL REFERENCES compras(id),
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  dia_pago TEXT NOT NULL,
  importe INTEGER NOT NULL CHECK (importe > 0),
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque')),
  nota TEXT NOT NULL DEFAULT '',
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  anulado_por TEXT REFERENCES usuarios(id),
  anulado_en TEXT,
  motivo_anulacion TEXT
);
CREATE INDEX pagos_proveedor_compra ON pagos_proveedor(compra_id);
CREATE INDEX pagos_proveedor_dia ON pagos_proveedor(dia_pago);
CREATE INDEX pagos_proveedor_proveedor ON pagos_proveedor(proveedor_id, dia_pago);

-- Lo pagado nunca supera el total de la compra, ni se paga una compra anulada (aunque dos pagos lleguen a la vez).
CREATE TRIGGER pagos_proveedor_sin_exceso
BEFORE INSERT ON pagos_proveedor
WHEN (SELECT anulada_en FROM compras WHERE id = NEW.compra_id) IS NOT NULL
  OR (SELECT COALESCE(SUM(importe), 0) FROM pagos_proveedor WHERE compra_id = NEW.compra_id AND anulado_en IS NULL) + NEW.importe
     > (SELECT total FROM compras WHERE id = NEW.compra_id)
BEGIN
  SELECT RAISE(ABORT, 'PAGO_EXCEDE_SALDO');
END;

-- 5) El libro de stock suma los tipos 'compra' (lo comprado suma al stock) y 'venta' (para la etapa 3), con la
-- compra o la venta que los originó. Igual que en 0007: SQLite no deja cambiar un CHECK y ninguna tabla apunta a
-- `movimientos`, así que se rehace con las mismas filas, en el mismo orden.
DROP TRIGGER movimientos_sin_stock_negativo;

CREATE TABLE movimientos_nueva (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  lote TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste', 'reasignacion', 'compra', 'venta')),
  cantidad INTEGER NOT NULL CHECK (cantidad <> 0),
  motivo TEXT,
  sucursal_id TEXT REFERENCES sucursales(id),
  envio_id TEXT,
  produccion_id TEXT REFERENCES producciones(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  finalidad TEXT NOT NULL DEFAULT 'reposicion' CHECK (finalidad IN ('reposicion', 'distribucion')),
  compra_id TEXT REFERENCES compras(id),
  venta_id TEXT
);

INSERT INTO movimientos_nueva
  (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia, finalidad)
SELECT id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia, finalidad
  FROM movimientos ORDER BY rowid;

DROP TABLE movimientos;
ALTER TABLE movimientos_nueva RENAME TO movimientos;

CREATE INDEX movimientos_stock ON movimientos(sector, producto_id, finalidad, lote);
CREATE INDEX movimientos_dia ON movimientos(dia);
CREATE INDEX movimientos_sucursal ON movimientos(sucursal_id);
CREATE INDEX movimientos_sector_lote ON movimientos(sector, lote);
CREATE INDEX movimientos_tipo_dia ON movimientos(tipo, dia);
CREATE INDEX movimientos_compra ON movimientos(compra_id);
CREATE INDEX movimientos_venta ON movimientos(venta_id);

-- El mismo control de 0009: con stock obligatorio, ninguna salida deja negativo el producto ni el lote.
CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0
  AND (SELECT stock_obligatorio FROM productos WHERE id = NEW.producto_id) = 1
  AND (
    (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
       WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND finalidad = NEW.finalidad) + NEW.cantidad < 0
    OR (NEW.lote IS NOT NULL AND
       (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
          WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND lote = NEW.lote AND finalidad = NEW.finalidad) + NEW.cantidad < 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;
