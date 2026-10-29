-- E03: cantidad que cada lote de chipa consumió de cada lote de materia prima, en la unidad del lote de materia prima
-- (kg, l, unidades…). Las filas anteriores quedan en NULL = "sin dato" y no descuentan saldo.
ALTER TABLE lote_chipa_mp ADD COLUMN cantidad REAL;

-- El saldo de un lote de materia prima (lotes_mp.cantidad menos lo consumido) no puede quedar negativo, ni siquiera
-- si dos cargas simultáneas pasan el control de la API a la vez. Misma idea que el trigger del stock en frío.
CREATE TRIGGER lote_chipa_mp_sin_saldo_negativo
BEFORE INSERT ON lote_chipa_mp
WHEN NEW.cantidad IS NOT NULL AND (
  (SELECT cantidad FROM lotes_mp WHERE id = NEW.lote_mp_id)
  - (SELECT COALESCE(SUM(cantidad), 0) FROM lote_chipa_mp WHERE lote_mp_id = NEW.lote_mp_id)
  - NEW.cantidad
) < -0.0005
BEGIN
  SELECT RAISE(ABORT, 'SALDO_LOTE_INSUFICIENTE');
END;
