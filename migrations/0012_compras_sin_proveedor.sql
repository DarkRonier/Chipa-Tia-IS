-- Compras sin proveedor y código de producto.
-- 1) Proveedor fijo «Sin nombre», para las compras a proveedores locales que no dan nombre ni factura (huevo, queso).
--    No se edita ni se lista entre los proveedores; sus compras y pagos funcionan igual que los demás.
INSERT INTO proveedores (id, nombre, ruc, telefono, notas, activo, creado_en)
VALUES ('prov-sin-nombre', 'Sin nombre', '', '', 'Compras sin proveedor identificado', 1, '2026-11-15T00:00:00.000Z');

-- 2) Código del producto (opcional), para buscarlo por código además de por nombre.
ALTER TABLE productos ADD COLUMN codigo TEXT NOT NULL DEFAULT '';
CREATE INDEX productos_codigo ON productos(codigo) WHERE codigo <> '';
