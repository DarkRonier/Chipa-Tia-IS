-- Tipo de producto. Las compras son solo de materias primas (queso Paraguay, carne fileteada, harina 000) y de productos
-- de venta directa (gaseosas, cerveza, agua); lo que se elabora (chipa, sopa, marinera) no se compra.
-- Todos los productos que ya había son elaborados.
ALTER TABLE productos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'elaborado' CHECK (tipo IN ('elaborado', 'materia_prima', 'reventa'));
