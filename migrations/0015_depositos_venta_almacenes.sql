-- Depósitos como los pidió Mati (2026-11-21, segunda vuelta):
--   - Venta directa: dos. «Venta frente» (la caja del cajero: chipas, bocaditos, bebidas) y «Venta comedor» (la caja
--     del comedor: buffet por kilo, postres y bebidas). Se registra cuánto hay y cuánto se vende; los productos «sin
--     stock» (el buffet) solo registran lo que se vende.
--   - Almacenes en frío: varios. Los crea y los borra el super-administrador. De acá se lleva a la venta o a sucursales.
--   - Sucursales: no son un depósito con stock: solo se registra lo que se les envió.
-- Los depósitos no se separan por sector: el sector es de quién produce; para mirar, los productos se agrupan por
-- categoría (Chipería, Chipitas, Bebidas, Heladería, Otros) y subcategoría (texto libre).

ALTER TABLE depositos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'almacen' CHECK (tipo IN ('venta', 'almacen'));
-- Un almacén borrado que tuvo movimientos queda en la base (por el historial) con la fecha de borrado.
ALTER TABLE depositos ADD COLUMN borrado_en TEXT;

UPDATE depositos SET tipo = 'venta', nombre = CASE WHEN nombre = 'Directo a Venta' THEN 'Venta frente' ELSE nombre END,
       descripcion = 'Lo que se vende en el frente (caja del cajero). Las ventas de esa caja descuentan de acá.'
 WHERE id = 'venta';
INSERT INTO depositos (id, nombre, descripcion, sistema, activo, orden, tipo) VALUES
  ('comedor', 'Venta comedor', 'Lo que se vende en el comedor (buffet por kilo, postres y bebidas).', 1, 1, 1, 'venta');
-- Frío es un almacén más: el super-administrador lo puede borrar (si queda al menos otro y está vacío).
UPDATE depositos SET sistema = 0, orden = 10, descripcion = 'Almacén en frío.' WHERE id = 'frio';
UPDATE depositos SET orden = 90, descripcion = 'Lo comprado para producir (queso, harina…).' WHERE id = 'materia_prima';

-- «Para sucursales» deja de existir: lo que tenía pasa a Frío con una transferencia (queda en el historial).
INSERT INTO movimientos (id, sector, producto_id, deposito_id, lote, tipo, cantidad, motivo, usuario_id, fecha, dia)
SELECT 'mig15-' || lower(hex(randomblob(8))), s.sector, s.producto_id, d.deposito_id, s.lote, 'transferencia',
       CASE WHEN d.deposito_id = 'sucursales' THEN -s.total ELSE s.total END,
       'De «Para sucursales» a «Frío» (las sucursales ya no son un depósito)',
       (SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY creado_en LIMIT 1),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), date('now', '-3 hours')
  FROM (SELECT sector, producto_id, lote, SUM(cantidad) AS total FROM movimientos WHERE deposito_id = 'sucursales'
         GROUP BY sector, producto_id, lote HAVING SUM(cantidad) > 0) s
  CROSS JOIN (SELECT 'sucursales' AS deposito_id UNION ALL SELECT 'frio') d
 ORDER BY d.deposito_id DESC;
UPDATE depositos SET activo = 0, sistema = 0, borrado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'sucursales';

-- Lo del horno va a un depósito de venta (Venta frente o Venta comedor); hasta ahora, siempre al frente.
ALTER TABLE producciones ADD COLUMN deposito_venta_id TEXT NOT NULL DEFAULT 'venta';

-- Productos: subcategoría (texto libre) y «sin stock» (solo se registran las ventas, como el buffet por kilo).
ALTER TABLE productos ADD COLUMN subcategoria TEXT NOT NULL DEFAULT '';
ALTER TABLE productos ADD COLUMN sin_stock INTEGER NOT NULL DEFAULT 0 CHECK (sin_stock IN (0, 1));
UPDATE productos SET sin_stock = 1 WHERE sector = 'cocina' AND nombre LIKE 'Menú buffet%';

-- Categorías: Chipería, Chipitas, Bebidas, Heladería y Otros (la de los que no entran en ninguna; no se desactiva).
ALTER TABLE categorias ADD COLUMN sistema INTEGER NOT NULL DEFAULT 0 CHECK (sistema IN (0, 1));
INSERT INTO categorias (id, nombre, activo, orden)
SELECT x.id, x.nombre, 1, x.orden FROM (
  SELECT 'cat-chiperia' AS id, 'Chipería' AS nombre, -5 AS orden UNION ALL
  SELECT 'cat-chipitas', 'Chipitas', -4 UNION ALL
  SELECT 'cat-bebidas', 'Bebidas', -3 UNION ALL
  SELECT 'cat-heladeria', 'Heladería', -2 UNION ALL
  SELECT 'cat-otros', 'Otros', 1000
) x WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE lower(c.nombre) = lower(x.nombre));
UPDATE categorias SET sistema = 1, activo = 1 WHERE lower(nombre) = 'otros';
UPDATE productos SET categoria_id = (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipería') LIMIT 1)
 WHERE categoria_id IS NULL AND sector = 'chiperia';
UPDATE productos SET categoria_id = (SELECT id FROM categorias WHERE lower(nombre) = 'chipitas' LIMIT 1)
 WHERE categoria_id IS NULL AND sector = 'chipitas';
UPDATE productos SET categoria_id = (SELECT id FROM categorias WHERE lower(nombre) = 'otros' LIMIT 1)
 WHERE categoria_id IS NULL;

-- Modo super-administrador (Mati, 2026-11-17): el administrador lo activa en Configuración → Ajustes avanzados con su
-- contraseña, por un rato y solo en esa sesión. Por ahora habilita crear y borrar almacenes.
ALTER TABLE sesiones ADD COLUMN super_hasta TEXT;
