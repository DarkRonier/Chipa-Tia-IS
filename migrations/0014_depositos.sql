-- Stock por depósitos (Mati, 2026-11-21). El stock deja de tener «finalidad» (reponer venta / sucursales) y pasa a
-- estar en depósitos. Los productos ya no tienen campos de stock (stock mínimo, stock obligatorio, «la venta descuenta
-- stock»): todo lo que se vende en caja descuenta del depósito «Directo a Venta».
--
-- Depósitos del sistema (se pueden renombrar, no desactivar):
--   venta          Directo a Venta: lo que está listo para vender. Las ventas de caja descuentan de acá. Las compras
--                  de productos de venta directa (gaseosas, agua) entran acá. «Sacar para la venta» pasa cosas acá.
--   frio           Frío: lo guardado para reponer la venta (lo que antes era la finalidad «Reponer venta»).
--   sucursales     Para sucursales: lo guardado para enviar (antes, la finalidad «Sucursales»). Los envíos salen de acá.
--   materia_prima  Materia prima: lo comprado para producir (queso, harina).
-- El administrador puede agregar otros depósitos (por ejemplo, «Cámara 2»).

CREATE TABLE depositos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  sistema INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0, 1)),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0
);

INSERT INTO depositos (id, nombre, descripcion, sistema, activo, orden) VALUES
  ('venta', 'Directo a Venta', 'Lo que está listo para vender. Las ventas de caja descuentan de acá.', 1, 1, 0),
  ('frio', 'Frío', 'Lo guardado en frío para reponer la venta.', 1, 1, 1),
  ('sucursales', 'Para sucursales', 'Lo guardado para enviar a sucursales. Los envíos salen de acá.', 1, 1, 2),
  ('materia_prima', 'Materia prima', 'Lo comprado para producir (queso, harina…).', 1, 1, 3);

-- `movimientos` se rehace (como en 0007 y 0010: SQLite no deja cambiar un CHECK) con `deposito_id` en lugar de
-- `finalidad`, y el tipo nuevo 'transferencia' (pasar de un depósito a otro: un par que se anula en el total).
-- Lo de antes pasa así:
--   - finalidad 'distribucion'                              → Para sucursales
--   - ventas de caja (tipo 'venta')                         → Directo a Venta
--   - compras de productos de venta directa (reventa)       → Directo a Venta
--   - compras de materia prima                              → Materia prima
--   - todo lo demás con finalidad 'reposicion'              → Frío
--   - los cambios de finalidad ('reasignacion') quedan como transferencias entre Frío y Para sucursales.
DROP TRIGGER movimientos_sin_stock_negativo;

CREATE TABLE movimientos_nueva (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  -- Sin indicarlo, Frío (como antes la finalidad «reposicion»).
  deposito_id TEXT NOT NULL DEFAULT 'frio' REFERENCES depositos(id),
  lote TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste', 'transferencia', 'compra', 'venta')),
  cantidad INTEGER NOT NULL CHECK (cantidad <> 0),
  motivo TEXT,
  sucursal_id TEXT REFERENCES sucursales(id),
  envio_id TEXT,
  produccion_id TEXT REFERENCES producciones(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  compra_id TEXT REFERENCES compras(id),
  venta_id TEXT
);

INSERT INTO movimientos_nueva
  (id, sector, producto_id, deposito_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia, compra_id, venta_id)
SELECT m.id, m.sector, m.producto_id,
       CASE
         WHEN m.finalidad = 'distribucion' THEN 'sucursales'
         WHEN m.tipo = 'venta' THEN 'venta'
         WHEN m.tipo = 'compra' AND p.tipo = 'reventa' THEN 'venta'
         WHEN m.tipo = 'compra' AND p.tipo = 'materia_prima' THEN 'materia_prima'
         ELSE 'frio'
       END,
       m.lote,
       CASE WHEN m.tipo = 'reasignacion' THEN 'transferencia' ELSE m.tipo END,
       m.cantidad, m.motivo, m.sucursal_id, m.envio_id, m.produccion_id, m.usuario_id, m.fecha, m.dia, m.compra_id, m.venta_id
  FROM movimientos m JOIN productos p ON p.id = m.producto_id
 ORDER BY m.rowid;

DROP TABLE movimientos;
ALTER TABLE movimientos_nueva RENAME TO movimientos;

CREATE INDEX movimientos_stock ON movimientos(sector, producto_id, deposito_id, lote);
CREATE INDEX movimientos_deposito ON movimientos(deposito_id, producto_id);
CREATE INDEX movimientos_dia ON movimientos(dia);
CREATE INDEX movimientos_sucursal ON movimientos(sucursal_id);
CREATE INDEX movimientos_sector_lote ON movimientos(sector, lote);
CREATE INDEX movimientos_tipo_dia ON movimientos(tipo, dia);
CREATE INDEX movimientos_compra ON movimientos(compra_id);
CREATE INDEX movimientos_venta ON movimientos(venta_id);

-- Ninguna salida deja negativo un producto (ni un lote) en un depósito. La única excepción son las ventas de caja:
-- si se vende algo que no se cargó en «Directo a Venta», la venta no se frena (el cliente ya lo tiene en la mano) y el
-- depósito queda en negativo, a la vista, hasta que se corrija.
CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0 AND NEW.tipo <> 'venta' AND (
  (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
     WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND deposito_id = NEW.deposito_id) + NEW.cantidad < 0
  OR (NEW.lote IS NOT NULL AND
     (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
        WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND deposito_id = NEW.deposito_id AND lote = NEW.lote) + NEW.cantidad < 0)
)
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;

-- Producción: lo guardado va a un depósito (antes, una finalidad).
ALTER TABLE produccion_items ADD COLUMN deposito_id TEXT NOT NULL DEFAULT 'frio';
UPDATE produccion_items SET deposito_id = CASE WHEN finalidad = 'distribucion' THEN 'sucursales' ELSE 'frio' END;
ALTER TABLE produccion_items DROP COLUMN finalidad;

-- Productos: sin campos de stock.
ALTER TABLE productos DROP COLUMN stock_minimo;
ALTER TABLE productos DROP COLUMN stock_obligatorio;
ALTER TABLE productos DROP COLUMN venta_descuenta_stock;
