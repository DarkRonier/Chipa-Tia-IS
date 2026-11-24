-- Tres talonarios de factura (Mati, 2026-11-24): Chipa Tía (frente), Chipa Tía Comedor y ChipaSticks, cada uno con su
-- timbrado y su numeración; y factura también para los envíos a sucursal. SQLite no deja cambiar un UNIQUE ni hacer
-- NULL una columna: `facturas` se rehace (igual que `usuarios` en 0022). Lo ya facturado era del talonario Comedor
-- (timbrado 18980642, 001-002), el único que había.
PRAGMA defer_foreign_keys = true;

CREATE TABLE facturas_copia AS SELECT rowid AS fila, * FROM facturas;

DROP TABLE facturas;

CREATE TABLE facturas (
  id TEXT PRIMARY KEY,
  talonario TEXT NOT NULL DEFAULT 'comedor' CHECK (talonario IN ('frente', 'comedor', 'chipasticks')),
  -- Una factura es de una venta o de un envío a sucursal (los movimientos con ese envio_id), nunca de los dos.
  venta_id TEXT UNIQUE REFERENCES ventas(id),
  envio_id TEXT UNIQUE,
  prefijo TEXT NOT NULL,
  numero INTEGER NOT NULL,
  timbrado TEXT NOT NULL DEFAULT '',
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,
  impresiones INTEGER NOT NULL DEFAULT 1,
  anulada_en TEXT,
  CHECK ((venta_id IS NULL) <> (envio_id IS NULL)),
  UNIQUE (talonario, prefijo, numero)
);

INSERT INTO facturas (id, talonario, venta_id, envio_id, prefijo, numero, timbrado, usuario_id, fecha, impresiones, anulada_en)
SELECT id, 'comedor', venta_id, NULL, prefijo, numero, timbrado, usuario_id, fecha, impresiones, anulada_en FROM facturas_copia ORDER BY fila;

DROP TABLE facturas_copia;
