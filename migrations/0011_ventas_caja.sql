-- Etapa 3 de la ampliación (M11–M14): precios de venta, caja, ventas, factura preimpresa e ingresos y egresos.
-- Importes en guaraníes enteros. `dia` es la fecha calendario en hora de Paraguay (AAAA-MM-DD).

-- 1) Productos: precio de venta (NULL = no se vende en caja), IVA de la factura y si la venta descuenta stock.
-- La venta descuenta stock solo en los productos marcados (por ejemplo, una gaseosa comprada para revender). La chipa
-- y lo demás que sale del frío no se marca: su stock ya baja con «Sacar para la venta», así nada se descuenta dos veces.
ALTER TABLE productos ADD COLUMN precio_venta INTEGER CHECK (precio_venta IS NULL OR precio_venta >= 0);
ALTER TABLE productos ADD COLUMN iva INTEGER NOT NULL DEFAULT 10 CHECK (iva IN (0, 5, 10));
ALTER TABLE productos ADD COLUMN venta_descuenta_stock INTEGER NOT NULL DEFAULT 0 CHECK (venta_descuenta_stock IN (0, 1));

-- 2) Caja (M13). Una sola caja operativa: como mucho una abierta a la vez.
CREATE TABLE cajas (
  id TEXT PRIMARY KEY,
  abierta_por TEXT NOT NULL REFERENCES usuarios(id),
  abierta_en TEXT NOT NULL,
  dia TEXT NOT NULL,
  fondo_inicial INTEGER NOT NULL CHECK (fondo_inicial >= 0),
  cerrada_por TEXT REFERENCES usuarios(id),
  cerrada_en TEXT,
  -- Al cerrar: efectivo esperado y contado, y el resumen completo (por medio de pago) en JSON.
  esperado_efectivo INTEGER,
  contado_efectivo INTEGER,
  diferencia INTEGER,
  resumen_cierre TEXT,
  nota_cierre TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX cajas_una_abierta ON cajas((1)) WHERE cerrada_en IS NULL;
CREATE INDEX cajas_dia ON cajas(dia);

-- Ingresos y retiros manuales de la caja (cambio, depósito al banco…) y los automáticos de otros módulos
-- (gasto pagado con efectivo de la caja, pago a proveedor desde la caja): `origen` dice de dónde vienen.
CREATE TABLE caja_movimientos (
  id TEXT PRIMARY KEY,
  caja_id TEXT NOT NULL REFERENCES cajas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'retiro')),
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque')),
  importe INTEGER NOT NULL CHECK (importe > 0),
  concepto TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'ie', 'proveedor')),
  origen_id TEXT,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  anulado_por TEXT REFERENCES usuarios(id),
  anulado_en TEXT
);
CREATE INDEX caja_movimientos_caja ON caja_movimientos(caja_id);

-- Arqueos: conteo del efectivo en cualquier momento (y al cerrar), contra lo que el sistema espera.
CREATE TABLE arqueos (
  id TEXT PRIMARY KEY,
  caja_id TEXT NOT NULL REFERENCES cajas(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  esperado INTEGER NOT NULL,
  contado INTEGER NOT NULL CHECK (contado >= 0),
  diferencia INTEGER NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  es_cierre INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX arqueos_caja ON arqueos(caja_id);

-- Un movimiento de caja, una venta o un arqueo solo se cargan con la caja abierta.
CREATE TRIGGER caja_movimientos_caja_abierta BEFORE INSERT ON caja_movimientos
WHEN (SELECT cerrada_en FROM cajas WHERE id = NEW.caja_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'CAJA_CERRADA'); END;

CREATE TRIGGER arqueos_caja_abierta BEFORE INSERT ON arqueos
WHEN (SELECT cerrada_en FROM cajas WHERE id = NEW.caja_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'CAJA_CERRADA'); END;

-- 3) Ventas (M11). Al contado (sin crédito). `numero` es correlativo interno; la factura tiene su propia numeración.
CREATE TABLE ventas (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  caja_id TEXT NOT NULL REFERENCES cajas(id),
  cliente_nombre TEXT NOT NULL DEFAULT '',
  cliente_ruc TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  descuento INTEGER NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque')),
  -- Efectivo: con cuánto pagó el cliente (para el vuelto). Solo informativo.
  recibido INTEGER,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  anulada_por TEXT REFERENCES usuarios(id),
  anulada_en TEXT,
  motivo_anulacion TEXT
);
CREATE INDEX ventas_caja ON ventas(caja_id);
CREATE INDEX ventas_dia ON ventas(dia);

CREATE TRIGGER ventas_caja_abierta BEFORE INSERT ON ventas
WHEN (SELECT cerrada_en FROM cajas WHERE id = NEW.caja_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'CAJA_CERRADA'); END;

-- El nombre, el precio y el IVA quedan copiados: si después cambia el catálogo, la venta no cambia.
CREATE TABLE venta_items (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  orden INTEGER NOT NULL DEFAULT 0,
  producto_id TEXT NOT NULL REFERENCES productos(id),
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL CHECK (precio_unitario >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  iva INTEGER NOT NULL CHECK (iva IN (0, 5, 10))
);
CREATE INDEX venta_items_venta ON venta_items(venta_id);
CREATE INDEX venta_items_producto ON venta_items(producto_id);

-- 4) Factura preimpresa (M12): numeración propia (prefijo 001-001 y número), una por venta.
CREATE TABLE facturas (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL UNIQUE REFERENCES ventas(id),
  prefijo TEXT NOT NULL,
  numero INTEGER NOT NULL,
  timbrado TEXT NOT NULL DEFAULT '',
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  impresiones INTEGER NOT NULL DEFAULT 1,
  anulada_en TEXT,
  UNIQUE (prefijo, numero)
);

-- 5) Ingresos y egresos (M14): lo que no sale de compras ni ventas (que se suman solos, sin cargarlos dos veces).
-- Los gastos fijos (alquiler, luz, sueldos…) los define el administrador; cada mes se marca su pago, que queda como
-- un egreso más con `gasto_fijo_id` y `periodo` (AAAA-MM).
CREATE TABLE gastos_fijos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  importe INTEGER NOT NULL CHECK (importe >= 0),
  dia_del_mes INTEGER NOT NULL DEFAULT 1 CHECK (dia_del_mes BETWEEN 1 AND 31),
  es_sueldo INTEGER NOT NULL DEFAULT 0 CHECK (es_sueldo IN (0, 1)),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE ie_movimientos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  dia_mov TEXT NOT NULL,
  concepto TEXT NOT NULL,
  categoria TEXT NOT NULL,
  importe INTEGER NOT NULL CHECK (importe > 0),
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque')),
  gasto_fijo_id TEXT REFERENCES gastos_fijos(id),
  periodo TEXT,
  caja_movimiento_id TEXT REFERENCES caja_movimientos(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  anulado_por TEXT REFERENCES usuarios(id),
  anulado_en TEXT,
  motivo_anulacion TEXT
);
CREATE INDEX ie_movimientos_dia ON ie_movimientos(dia_mov);
CREATE UNIQUE INDEX ie_gasto_fijo_periodo ON ie_movimientos(gasto_fijo_id, periodo) WHERE gasto_fijo_id IS NOT NULL AND anulado_en IS NULL;

-- 6) Pago a proveedor en efectivo que sale de la caja abierta: queda como retiro en esa caja (un solo registro).
ALTER TABLE pagos_proveedor ADD COLUMN caja_movimiento_id TEXT REFERENCES caja_movimientos(id);
