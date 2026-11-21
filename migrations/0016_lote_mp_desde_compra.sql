-- La materia prima de Chipería que entra con una compra crea su lote de materia prima (E01) sola, sin cargarlo dos
-- veces. El lote recuerda de qué producto y de qué compra vino; cuando una amasada lo usa, lo usado sale del depósito
-- Materia prima.
ALTER TABLE lotes_mp ADD COLUMN producto_id TEXT REFERENCES productos(id);
ALTER TABLE lotes_mp ADD COLUMN compra_id TEXT REFERENCES compras(id);
CREATE INDEX lotes_mp_compra ON lotes_mp(compra_id);

-- Vencimiento del producto comprado (el del envase), para el lote de materia prima.
ALTER TABLE compra_items ADD COLUMN vencimiento TEXT;

-- Lo que una amasada usa de la materia prima (tipo 'produccion', en Materia prima, con cantidad negativa) no se frena
-- aunque el depósito no alcance, igual que las ventas de caja: lo que se usó ya se usó. El saldo del lote ya lo controla
-- lote_chipa_mp_sin_saldo_negativo.
DROP TRIGGER movimientos_sin_stock_negativo;
CREATE TRIGGER movimientos_sin_stock_negativo
BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0 AND NEW.tipo <> 'venta' AND NOT (NEW.tipo = 'produccion' AND NEW.deposito_id = 'materia_prima') AND (
  (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
     WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND deposito_id = NEW.deposito_id) + NEW.cantidad < 0
  OR (NEW.lote IS NOT NULL AND
     (SELECT COALESCE(SUM(cantidad), 0) FROM movimientos
        WHERE sector = NEW.sector AND producto_id = NEW.producto_id AND deposito_id = NEW.deposito_id AND lote = NEW.lote) + NEW.cantidad < 0)
)
BEGIN
  SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE');
END;
