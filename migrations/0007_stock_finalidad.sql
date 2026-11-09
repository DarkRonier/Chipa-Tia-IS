-- C05: finalidad del stock en frío. Cada unidad guardada es para «reposicion» (reponer la venta del propio
-- sector) o para «distribucion» (enviar a sucursales). Todo lo que ya estaba cargado queda como reposición.
-- C08: stock mínimo por producto (NULL = sin aviso). Con menos que eso en frío el sistema avisa.

ALTER TABLE productos ADD COLUMN stock_minimo INTEGER CHECK (stock_minimo IS NULL OR stock_minimo >= 0);

ALTER TABLE produccion_items ADD COLUMN finalidad TEXT NOT NULL DEFAULT 'reposicion'
  CHECK (finalidad IN ('reposicion', 'distribucion'));

-- `movimientos` se rehace para agregar la columna y el tipo nuevo 'reasignacion' (cambio de finalidad: un par de
-- movimientos que se anulan en el total). SQLite no deja modificar un CHECK, y ninguna otra tabla apunta a esta.
-- Las filas pasan una por una, en el mismo orden, con finalidad 'reposicion'.
DROP TRIGGER movimientos_sin_stock_negativo;

CREATE TABLE movimientos_nueva (
  id TEXT PRIMARY KEY,
  sector TEXT NOT NULL REFERENCES sectores(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  lote TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'stock_inicial', 'salida_venta', 'envio', 'merma', 'vencimiento', 'ajuste', 'reasignacion')),
  cantidad INTEGER NOT NULL CHECK (cantidad <> 0),
  motivo TEXT,
  sucursal_id TEXT REFERENCES sucursales(id),
  envio_id TEXT,
  produccion_id TEXT REFERENCES producciones(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  dia TEXT NOT NULL,
  finalidad TEXT NOT NULL DEFAULT 'reposicion' CHECK (finalidad IN ('reposicion', 'distribucion'))
);

INSERT INTO movimientos_nueva
  (id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia, finalidad)
SELECT id, sector, producto_id, lote, tipo, cantidad, motivo, sucursal_id, envio_id, produccion_id, usuario_id, fecha, dia, 'reposicion'
  FROM movimientos ORDER BY rowid;

DROP TABLE movimientos;
ALTER TABLE movimientos_nueva RENAME TO movimientos;

CREATE INDEX movimientos_stock ON movimientos(sector, producto_id, finalidad, lote);
CREATE INDEX movimientos_dia ON movimientos(dia);
CREATE INDEX movimientos_sucursal ON movimientos(sucursal_id);
CREATE INDEX movimientos_sector_lote ON movimientos(sector, lote);
CREATE INDEX movimientos_tipo_dia ON movimientos(tipo, dia);

-- D04, ahora por finalidad: una salida no puede dejar en negativo lo guardado de ese producto (ni de ese lote)
-- para esa finalidad. Para pasar de una finalidad a otra se resta primero de la de origen.
CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0 AND (
  (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
     WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND finalidad = NEW.finalidad) + NEW.cantidad < 0
  OR (NEW.lote IS NOT NULL AND
     (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
        WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND lote = NEW.lote AND finalidad = NEW.finalidad) + NEW.cantidad < 0)
)
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;
