-- Pagos en varias partes (pagos híbridos): una factura se paga, en un mismo registro, con partes de distintos medios.
-- Ejemplo: 1.300.000 en cheque del Banco Regional + 145.000 en cheque del Continental + 115.000 en efectivo.

-- 1) Pagos a proveedores: cada parte es una fila de pagos_proveedor (así los reportes por medio siguen igual).
-- Las partes cargadas juntas comparten `registro`; el cheque guarda su banco y su número.
ALTER TABLE pagos_proveedor ADD COLUMN banco TEXT NOT NULL DEFAULT '';
ALTER TABLE pagos_proveedor ADD COLUMN cheque_numero TEXT NOT NULL DEFAULT '';
ALTER TABLE pagos_proveedor ADD COLUMN registro TEXT;
UPDATE pagos_proveedor SET registro = id WHERE registro IS NULL;
CREATE INDEX pagos_proveedor_registro ON pagos_proveedor(registro);

-- 2) Ventas: cómo se cobró cada venta, parte por parte. `ventas.medio` queda como el medio principal (la parte más
-- grande) para lo que ya lo muestra; los totales por medio salen de esta tabla.
CREATE TABLE venta_pagos (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  orden INTEGER NOT NULL DEFAULT 0,
  medio TEXT NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'tarjeta', 'qr', 'cheque')),
  importe INTEGER NOT NULL CHECK (importe > 0),
  banco TEXT NOT NULL DEFAULT '',
  cheque_numero TEXT NOT NULL DEFAULT ''
);
CREATE INDEX venta_pagos_venta ON venta_pagos(venta_id);

-- Las ventas que ya existen se cobraron con un solo medio: una parte por el total.
INSERT INTO venta_pagos (id, venta_id, orden, medio, importe)
SELECT id || '-p0', id, 0, medio, total FROM ventas WHERE total > 0;
