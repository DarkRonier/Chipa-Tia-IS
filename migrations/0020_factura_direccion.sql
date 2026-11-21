-- Factura preimpresa de Chipa Tía (M12): la hoja trae «Dirección» del cliente.
ALTER TABLE ventas ADD COLUMN cliente_direccion TEXT NOT NULL DEFAULT '';
